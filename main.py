import logging
import threading
import time
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Optional

import cv2
import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from api.routes import router
from config import config
from database.db import db
from hardware.gpio_control import ServoController
from rate_limit import limiter
from vision.camera import CameraStream
from vision.detector import FaceDetection, YuNetFaceDetector
from vision.enrollment import ENROLLMENT_STEPS, EnrollmentSession
from vision.face_guidance import FaceGuidanceEngine
from vision.pose_heuristic import PoseHeuristic
from vision.recognizer import SFaceRecognizer
from vision.secure_storage import storage as _storage
from vision.trainer import FaceTrainer


logger = logging.getLogger("camerapi.main")


class AccessService:
    def __init__(self):
        self.camera = CameraStream()
        self.detector = YuNetFaceDetector()
        self.recognizer = SFaceRecognizer()
        self.trainer = FaceTrainer(self.recognizer)
        self.relay = ServoController()
        self.guidance = FaceGuidanceEngine()
        self.pose_heuristic = PoseHeuristic()
        self.enrollment_session: Optional[EnrollmentSession] = None
        self.enrollment_lock = threading.RLock()

        self.running = False
        self.thread: Optional[threading.Thread] = None
        self.watchdog_thread: Optional[threading.Thread] = None
        self.last_process_ts = 0.0
        self.lock = threading.Lock()
        self.analysis_lock = threading.Lock()
        self.backend_sleep = False

        self.system_status: dict[str, Any] = {
            "camera": "offline",
            "model": "not_loaded",
            "gpio": "ready" if self.relay.available else "mock",
            "fps": 0,
            "camera_fps": 0.0,
            "analysis_fps": 0.0,
            "last_user": "-",
            "last_result": "INICIALIZANDO",
            "last_confidence": None,
            "timestamp": int(time.time()),
            "avg_recognition_ms": 0.0,
            "avg_pipeline_ms": 0.0,
            "failed_attempts_consecutive": 0,
            "processing_errors": 0,
            "attempts_processed": 0,
            "gpio_activations": 0,
            "analysis_mode": "manual_trigger",
            "analysis_busy": False,
            "analysis_state": "idle",
            "sleep_mode": False,
            "face_detected": False,
            "face_bbox": None,
            "faces_count": 0,
            "primary_face_bbox": None,
            "recognition_score": None,
            "recognition_metric": self.recognizer.recognition_metric,
            "recognition_variant": None,
            "face_updated_ts": 0,
            "camera_frame_width": config.frame_width,
            "camera_frame_height": config.frame_height,
            "camera_restarts": 0,
            "face_guidance": None,
        }
        self.consecutive_denied = 0
        self.last_frame_counter = 0
        self.last_fps_tick = time.time()
        self.recognition_time_total_ms = 0.0
        self.recognition_count = 0
        self.pipeline_time_total_ms = 0.0
        self.pipeline_count = 0
        self.attempts_processed = 0
        self.last_watchdog_log_ts = 0.0
        self.gpio_activation_count = 0
        self.last_perf_log_ts = 0.0

        self.detector_params = {
            "scoreThreshold": config.yunet_score_threshold,
            "nmsThreshold": config.yunet_nms_threshold,
            "topK": config.yunet_top_k,
        }

    def start(self):
        Path(config.dataset_dir).mkdir(parents=True, exist_ok=True)
        Path("models").mkdir(parents=True, exist_ok=True)
        try:
            cv2.setNumThreads(max(1, int(config.cv_threads)))
            logger.info("opencv_threads_configured threads=%s", cv2.getNumThreads())
        except Exception:
            logger.exception("opencv_threads_configuration_failed")

        try:
            self.camera.start()
            self.system_status["camera"] = "online"
        except Exception:
            self.system_status["camera"] = "error"
            logger.critical("camera_start_failed", exc_info=True)

        try:
            self.system_status["model"] = "loaded" if self.recognizer.load_model(config.model_path, _storage) else "not_loaded"
        except Exception:
            self.system_status["model"] = "error"
            logger.critical("model_load_failed path=%s", config.model_path, exc_info=True)

        self.running = True
        self.thread = threading.Thread(target=self._process_loop, daemon=True)
        self.thread.start()
        self.watchdog_thread = threading.Thread(target=self._watchdog_loop, daemon=True)
        self.watchdog_thread.start()
        logger.info("service_start_ok")

    def stop(self):
        self.running = False
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=1.0)
        if self.watchdog_thread and self.watchdog_thread.is_alive():
            self.watchdog_thread.join(timeout=1.0)
        self.camera.stop()
        self.relay.cleanup()
        logger.info("service_stop_ok")

    def _watchdog_loop(self):
        while self.running:
            try:
                if self.backend_sleep:
                    with self.lock:
                        self.system_status["camera"] = "online" if self.camera.is_active() else "degraded"
                        self.system_status["camera_restarts"] = getattr(self.camera, "restart_count", 0)
                    time.sleep(2.0)
                    continue
                camera_ready = self.camera.ensure_running()
                if not camera_ready:
                    logger.critical("watchdog_camera_not_running")
                cam_active = self.camera.is_active() if camera_ready else False
                camera_state = "online" if cam_active else "degraded" if camera_ready else "error"
                with self.lock:
                    self.system_status["camera"] = camera_state
                    self.system_status["camera_restarts"] = getattr(self.camera, "restart_count", 0)
                if not cam_active:
                    logger.critical("watchdog_camera_inactive state=%s", camera_state)
                now = time.time()
                if now - self.last_watchdog_log_ts >= 60:
                    capture_alive = self.camera.thread is not None and self.camera.thread.is_alive()
                    logger.info("capture_thread_status alive=%s camera_active=%s", capture_alive, cam_active)
                    self.last_watchdog_log_ts = now
            except Exception:
                logger.exception("watchdog_loop_failed")
            time.sleep(2.0)

    def _process_loop(self):
        interval = max(0.001, config.process_interval_ms / 1000.0)
        next_tick = time.perf_counter()
        while self.running:
            now_perf = time.perf_counter()
            sleep_s = next_tick - now_perf
            if sleep_s > 0:
                time.sleep(sleep_s)
                continue
            next_tick = now_perf + interval

            now = time.time()
            self.last_process_ts = now
            if self.backend_sleep:
                with self.lock:
                    self.system_status["camera_fps"] = 0.0
                    self.system_status["analysis_fps"] = 0.0
                    self.system_status["fps"] = 0
                    self.system_status["face_detected"] = False
                    self.system_status["face_bbox"] = None
                    self.system_status["faces_count"] = 0
                    self.system_status["primary_face_bbox"] = None
                    self.system_status["analysis_state"] = "sleep"
                continue
            camera_fps = self.camera.get_capture_fps()
            with self.lock:
                self.system_status["camera_fps"] = round(camera_fps, 2)
                self.system_status["fps"] = int(round(camera_fps))

            frame = self.camera.get_frame(copy=False)
            if frame is None:
                with self.lock:
                    self.system_status["face_detected"] = False
                    self.system_status["face_bbox"] = None
                    self.system_status["faces_count"] = 0
                    self.system_status["primary_face_bbox"] = None
                continue

            self.last_frame_counter += 1
            elapsed = now - self.last_fps_tick
            if elapsed >= 1.0:
                analysis_fps = self.last_frame_counter / elapsed
                with self.lock:
                    self.system_status["analysis_fps"] = round(analysis_fps, 2)
                self.last_frame_counter = 0
                self.last_fps_tick = now

            frame_t0 = time.perf_counter()
            try:
                self._run_detection_pipeline(frame)
            except Exception:
                with self.lock:
                    self.system_status["processing_errors"] = int(self.system_status["processing_errors"]) + 1
                logger.exception("process_frame_failed")
            finally:
                frame_ms = (time.perf_counter() - frame_t0) * 1000.0
                self.pipeline_time_total_ms += frame_ms
                self.pipeline_count += 1
                avg_pipeline_ms = self.pipeline_time_total_ms / max(1, self.pipeline_count)
                with self.lock:
                    self.system_status["avg_pipeline_ms"] = round(avg_pipeline_ms, 2)
                if now - self.last_perf_log_ts >= 5.0:
                    logger.info(
                        "processing_perf camera_fps=%.2f analysis_fps=%.2f avg_pipeline_ms=%.2f",
                        camera_fps,
                        float(self.system_status.get("analysis_fps", 0.0)),
                        float(self.system_status.get("avg_pipeline_ms", 0.0)),
                    )
                    self.last_perf_log_ts = now

    @staticmethod
    def _to_gray(frame):
        return cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    def _detect_faces(self, frame):
        """Detecta rostros y retorna (rostro principal, total de rostros)."""
        faces = self.detector.detect(frame, self.detector_params)
        count = len(faces)
        if count == 0:
            return None, 0
        primary = max(faces, key=self._face_area)
        return primary, count

    @staticmethod
    def _face_bbox_tuple(face) -> tuple[int, int, int, int]:
        if isinstance(face, FaceDetection):
            return face.bbox
        return tuple(int(v) for v in face[:4])

    @staticmethod
    def _face_area(face) -> int:
        if isinstance(face, FaceDetection):
            return face.area
        x, y, w, h = [int(v) for v in face[:4]]
        return max(1, w) * max(1, h)

    @staticmethod
    def _normalize_roi(frame, face, size: tuple[int, int] = (112, 112)):
        x, y, w, h = AccessService._face_bbox_tuple(face)
        x = max(0, x)
        y = max(0, y)
        w = max(1, w)
        h = max(1, h)
        roi = frame[y : y + h, x : x + w]
        if roi.size == 0:
            return None
        return cv2.resize(roi, size)

    @staticmethod
    def _normalize_face_bbox(face, frame_width: int, frame_height: int) -> dict[str, float]:
        x, y, w, h = AccessService._face_bbox_tuple(face)
        x = max(0, min(x, frame_width - 1))
        y = max(0, min(y, frame_height - 1))
        w = max(1, min(w, frame_width - x))
        h = max(1, min(h, frame_height - y))
        return {
            "x": round(x / max(1, frame_width), 6),
            "y": round(y / max(1, frame_height), 6),
            "w": round(w / max(1, frame_width), 6),
            "h": round(h / max(1, frame_height), 6),
        }

    def _run_detection_pipeline(self, frame) -> None:
        gray = self._to_gray(frame)
        frame_height, frame_width = gray.shape[:2]
        face, faces_count = self._detect_faces(frame)
        now_ts = int(time.time())
        bbox = None
        detected = False

        if face is not None:
            bbox = self._normalize_face_bbox(face, frame_width, frame_height)
            detected = True

        # ── Face guidance engine ──
        camera_ok = self.system_status.get("camera") in ("online", "degraded")
        model_loaded = self.system_status.get("model") == "loaded"
        guidance = self.guidance.update(
            face_detected=detected,
            face_bbox=bbox,
            faces_count=faces_count,
            camera_ok=camera_ok,
            model_loaded=model_loaded,
        )

        # ── Enrollment session update ──
        if self.enrollment_session is not None:
            try:
                self.enrollment_session.update(frame, gray, face, faces_count)
            except Exception:
                logger.exception("enrollment_update_failed")
                self.enrollment_session.fail("Se interrumpio la sesion de captura")

        with self.lock:
            self.system_status["face_detected"] = detected
            self.system_status["face_bbox"] = bbox
            self.system_status["faces_count"] = faces_count
            self.system_status["primary_face_bbox"] = bbox
            self.system_status["face_updated_ts"] = now_ts
            self.system_status["camera_frame_width"] = frame_width
            self.system_status["camera_frame_height"] = frame_height
            self.system_status["face_guidance"] = guidance

    def _apply_access_decision(
        self,
        label: Optional[int],
        score: Optional[float],
        conf: dict[str, Any],
    ) -> tuple[Optional[int], str, str]:
        threshold = float(conf["umbral_confianza"])
        open_sec = int(conf["tiempo_apertura_seg"])

        user_id = None
        user_name = "Desconocido"
        result = "DENEGADO"

        if label is not None and score is not None and score >= threshold:
            user = db.get_user(label)
            if user and int(user["activo"]) == 1:
                user_id = int(user["id"])
                user_name = str(user["nombre"])
                result = "AUTORIZADO"
                self.consecutive_denied = 0
                logger.info("gpio_activation_start seconds=%s", open_sec)
                self.relay.open_for(open_sec)
                self.gpio_activation_count += 1
        else:
            self.consecutive_denied += 1

        return user_id, user_name, result

    @staticmethod
    def _event_from_result(result: str) -> str:
        if result.startswith("AUTORIZADO"):
            return "authorized"
        return "denied"

    def _build_analysis_payload(
        self,
        *,
        ok: bool,
        event: str,
        result: str,
        user_id: Optional[int],
        user_name: Optional[str],
        confidence: Optional[float],
        timestamp: int,
        analysis_busy: bool = False,
    ) -> dict[str, Any]:
        with self.lock:
            face_detected = bool(self.system_status.get("face_detected", False))
            face_bbox = self.system_status.get("face_bbox")
            faces_count = int(self.system_status.get("faces_count", 0) or 0)
            primary_face_bbox = self.system_status.get("primary_face_bbox")
            recognition_score = self.system_status.get("recognition_score")
            recognition_metric = self.system_status.get("recognition_metric")
            recognition_variant = self.system_status.get("recognition_variant")
            analysis_state = str(self.system_status.get("analysis_state", "idle"))
        return {
            "ok": ok,
            "event": event,
            "result": result,
            "user_id": user_id,
            "user_name": user_name,
            "confidence": confidence,
            "timestamp": timestamp,
            "analysis_busy": analysis_busy,
            "analysis_state": analysis_state,
            "face_detected": face_detected,
            "face_bbox": face_bbox,
            "faces_count": faces_count,
            "primary_face_bbox": primary_face_bbox,
            "recognition_score": recognition_score,
            "recognition_metric": recognition_metric,
            "recognition_variant": recognition_variant,
        }

    def analyze_once(self) -> tuple[dict[str, Any], int]:
        if self.backend_sleep:
            ts = int(time.time())
            payload = self._build_analysis_payload(
                ok=False,
                event="sleeping",
                result="SLEEP_MODE",
                user_id=None,
                user_name=None,
                confidence=None,
                timestamp=ts,
            )
            return payload, 423

        if not self.analysis_lock.acquire(blocking=False):
            with self.lock:
                ts = int(time.time())
            payload = self._build_analysis_payload(
                ok=False,
                event="busy",
                result="BUSY",
                user_id=None,
                user_name=None,
                confidence=None,
                timestamp=ts,
                analysis_busy=True,
            )
            return payload, 409

        try:
            with self.lock:
                self.system_status["analysis_busy"] = True
                self.system_status["analysis_state"] = "scanning"

            self.attempts_processed += 1
            attempt_id = self.attempts_processed
            with self.lock:
                self.system_status["attempts_processed"] = self.attempts_processed

            logger.info("recognition_cycle_start attempt_id=%s mode=manual", attempt_id)

            frame = self.camera.get_frame()
            if frame is None:
                ts = int(time.time())
                with self.lock:
                    self.system_status["analysis_state"] = "error"
                payload = self._build_analysis_payload(
                    ok=False,
                    event="camera_error",
                    result="CAMERA_UNAVAILABLE",
                    user_id=None,
                    user_name=None,
                    confidence=None,
                    timestamp=ts,
                )
                return payload, 503

            frame_height, frame_width = frame.shape[:2]
            with self.lock:
                self.system_status["camera_frame_width"] = frame_width
                self.system_status["camera_frame_height"] = frame_height

            model_exists = Path(config.model_path).exists()
            if not model_exists:
                ts = int(time.time())
                with self.lock:
                    self.system_status["model"] = "not_loaded"
                    self.system_status["recognition_score"] = None
                    self.system_status["recognition_variant"] = None
                    self.system_status["analysis_state"] = "error"
                payload = self._build_analysis_payload(
                    ok=False,
                    event="model_not_loaded",
                    result="MODEL_MISSING",
                    user_id=None,
                    user_name=None,
                    confidence=None,
                    timestamp=ts,
                )
                logger.error("recognition_cycle_end attempt_id=%s result=model_missing", attempt_id)
                return payload, 503

            if not self.recognizer.loaded:
                loaded = self.recognizer.load_model(config.model_path, _storage)
                with self.lock:
                    self.system_status["model"] = "loaded" if loaded else "not_loaded"
                if not loaded:
                    ts = int(time.time())
                    with self.lock:
                        self.system_status["recognition_score"] = None
                        self.system_status["recognition_variant"] = None
                        self.system_status["analysis_state"] = "error"
                    payload = self._build_analysis_payload(
                        ok=False,
                        event="model_not_loaded",
                        result="MODEL_NOT_LOADED",
                        user_id=None,
                        user_name=None,
                        confidence=None,
                        timestamp=ts,
                    )
                    logger.error("recognition_cycle_end attempt_id=%s result=model_not_loaded", attempt_id)
                    return payload, 503

            face, faces_count = self._detect_faces(frame)
            if face is None:
                ts = int(time.time())
                with self.lock:
                    self.system_status["face_detected"] = False
                    self.system_status["face_bbox"] = None
                    self.system_status["faces_count"] = 0
                    self.system_status["primary_face_bbox"] = None
                    self.system_status["recognition_score"] = None
                    self.system_status["recognition_variant"] = None
                    self.system_status["face_updated_ts"] = ts
                    self.system_status["analysis_state"] = "error"
                payload = self._build_analysis_payload(
                    ok=False,
                    event="no_face",
                    result="NO_FACE",
                    user_id=None,
                    user_name=None,
                    confidence=None,
                    timestamp=ts,
                )
                logger.info("recognition_cycle_end attempt_id=%s result=no_face", attempt_id)
                return payload, 200

            face_bbox = self._normalize_face_bbox(face, frame_width, frame_height)
            with self.lock:
                self.system_status["face_detected"] = True
                self.system_status["face_bbox"] = face_bbox
                self.system_status["faces_count"] = faces_count
                self.system_status["primary_face_bbox"] = face_bbox
                self.system_status["face_updated_ts"] = int(time.time())

            if faces_count > 1:
                ts = int(time.time())
                with self.lock:
                    self.system_status["last_user"] = "-"
                    self.system_status["last_result"] = "MULTIPLE_FACES"
                    self.system_status["recognition_score"] = None
                    self.system_status["recognition_variant"] = None
                    self.system_status["timestamp"] = ts
                    self.system_status["analysis_state"] = "error"
                payload = self._build_analysis_payload(
                    ok=False,
                    event="multiple_faces",
                    result="MULTIPLE_FACES",
                    user_id=None,
                    user_name=None,
                    confidence=None,
                    timestamp=ts,
                )
                logger.warning("recognition_cycle_end attempt_id=%s result=multiple_faces faces=%s", attempt_id, faces_count)
                return payload, 200

            align_crop = getattr(self.recognizer, "align_crop", None)
            roi = align_crop(frame, face) if callable(align_crop) else None
            if roi is None:
                ts = int(time.time())
                with self.lock:
                    self.system_status["recognition_score"] = None
                    self.system_status["recognition_variant"] = None
                    self.system_status["face_updated_ts"] = ts
                    self.system_status["analysis_state"] = "error"
                payload = self._build_analysis_payload(
                    ok=False,
                    event="no_face",
                    result="NO_FACE",
                    user_id=None,
                    user_name=None,
                    confidence=None,
                    timestamp=ts,
                )
                logger.info("recognition_cycle_end attempt_id=%s result=no_face_crop", attempt_id)
                return payload, 200

            conf = db.get_config()
            predict_t0 = time.perf_counter()
            label, score = self.recognizer.predict(roi)
            predict_ms = (time.perf_counter() - predict_t0) * 1000.0
            self.recognition_time_total_ms += predict_ms
            self.recognition_count += 1
            avg_ms = self.recognition_time_total_ms / max(1, self.recognition_count)

            user_id, user_name, result = self._apply_access_decision(label, score, conf)
            db.insert_access(user_id=user_id, confianza=score, resultado=result)

            ts = int(time.time())
            event = self._event_from_result(result)
            analysis_state = "success" if event == "authorized" else "error"
            with self.lock:
                self.system_status["last_user"] = user_name
                self.system_status["last_result"] = result
                self.system_status["last_confidence"] = score
                self.system_status["recognition_score"] = score
                self.system_status["recognition_metric"] = self.recognizer.recognition_metric
                self.system_status["recognition_variant"] = getattr(self.recognizer, "last_match_variant", None)
                self.system_status["timestamp"] = ts
                self.system_status["avg_recognition_ms"] = round(avg_ms, 2)
                self.system_status["failed_attempts_consecutive"] = self.consecutive_denied
                self.system_status["attempts_processed"] = self.attempts_processed
                self.system_status["gpio_activations"] = self.gpio_activation_count
                self.system_status["analysis_state"] = analysis_state

            logger.info(
                "recognition_cycle_end attempt_id=%s result=%s score=%s avg_recognition_ms=%.2f",
                attempt_id,
                result,
                score,
                avg_ms,
            )

            payload = self._build_analysis_payload(
                ok=True,
                event=event,
                result=result,
                user_id=user_id,
                user_name=user_name,
                confidence=score,
                timestamp=ts,
            )
            return payload, 200
        except Exception:
            ts = int(time.time())
            with self.lock:
                self.system_status["processing_errors"] = int(self.system_status["processing_errors"]) + 1
                self.system_status["analysis_state"] = "error"
            logger.exception("recognize_once_failed")
            payload = self._build_analysis_payload(
                ok=False,
                event="camera_error",
                result="PROCESSING_ERROR",
                user_id=None,
                user_name=None,
                confidence=None,
                timestamp=ts,
            )
            return payload, 503
        finally:
            with self.lock:
                self.system_status["analysis_busy"] = False
            self.analysis_lock.release()

    def capture_sample(self, user_id: int, sample_index: int) -> Optional[str]:
        frame = self.camera.get_frame()
        if frame is None:
            return None
        face, faces_count = self._detect_faces(frame)
        if face is None or faces_count != 1:
            return None
        align_crop = getattr(self.recognizer, "align_crop", None)
        roi = align_crop(frame, face) if callable(align_crop) else None
        if roi is None:
            return None

        user_dir = Path(config.dataset_dir) / f"user_{user_id}"
        user_dir.mkdir(parents=True, exist_ok=True)
        relative_path = f"{config.dataset_dir}/user_{user_id}/sample_{sample_index:03d}.jpg"
        full_path = user_dir / f"sample_{sample_index:03d}.jpg"
        _storage.write_image(full_path, roi)
        return relative_path

    # ── Enrollment management ─────────────────────────────────────

    def start_enrollment(self, user_id: int) -> dict[str, Any]:
        with self.enrollment_lock:
            if self.enrollment_session is not None:
                return {
                    **self.enrollment_session.get_status(),
                    "ok": False,
                    "error": "enrollment_already_active",
                }
            user = db.get_user(user_id)
            user_name = str(user["nombre"]) if user else f"Usuario {user_id}"
            self.enrollment_session = EnrollmentSession(
                user_id=user_id,
                pose=self.pose_heuristic,
                user_name=user_name,
                face_aligner=getattr(self.recognizer, "align_crop", None),
            )
            logger.info("enrollment_started user_id=%s", user_id)
            return {
                **self.enrollment_session.get_status(),
                "ok": True,
            }

    def get_enrollment_status(self) -> dict[str, Any]:
        session = self.enrollment_session
        if session is None:
            return self._build_idle_enrollment_status()
        return session.get_status()

    def abort_enrollment(self) -> dict[str, Any]:
        with self.enrollment_lock:
            session = self.enrollment_session
            if session is None:
                return {
                    **self._build_idle_enrollment_status(),
                    "ok": False,
                    "error": "no_active_session",
                }
            should_cleanup_files = not session.samples_persisted
            if should_cleanup_files:
                session.abort()
                session.clear_all_files()
            self.enrollment_session = None
            self.pose_heuristic.clear_baseline()
            logger.info("enrollment_aborted user_id=%s", session.user_id)
            return {
                **self._build_idle_enrollment_status(),
                "ok": True,
            }

    def retry_enrollment_step(self) -> dict[str, Any]:
        session = self.enrollment_session
        if session is None:
            return {
                **self._build_idle_enrollment_status(),
                "ok": False,
                "error": "no_active_session",
            }
        if session.is_terminal:
            return {
                **session.get_status(),
                "ok": False,
                "error": "enrollment_not_retryable",
            }
        session.retry_step()
        return {
            **session.get_status(),
            "ok": True,
        }

    def continue_enrollment(self) -> dict[str, Any]:
        session = self.enrollment_session
        if session is None:
            return {
                **self._build_idle_enrollment_status(),
                "ok": False,
                "error": "no_active_session",
            }
        if session.is_terminal:
            return {
                **session.get_status(),
                "ok": False,
                "error": "enrollment_not_continuable",
            }
        if not session.continue_capture():
            return {
                **session.get_status(),
                "ok": False,
                "error": "enrollment_not_waiting",
            }
        return {
            **session.get_status(),
            "ok": True,
        }

    def finish_enrollment(self) -> dict[str, Any]:
        with self.enrollment_lock:
            session = self.enrollment_session
            if session is None:
                return {
                    **self._build_idle_enrollment_status(),
                    "ok": False,
                    "error": "no_active_session",
                }
            if session.state not in ("completed", "error"):
                return {
                    **session.get_status(),
                    "ok": False,
                    "error": "enrollment_not_finishable",
                }
            if session.state == "completed" and not session.samples_persisted:
                self._persist_completed_enrollment(session)
            self.enrollment_session = None
            self.pose_heuristic.clear_baseline()
            logger.info("enrollment_finished user_id=%s state=%s", session.user_id, session.state)
            return {
                **self._build_idle_enrollment_status(),
                "ok": True,
                "finished": True,
            }

    def _persist_completed_enrollment(self, session: EnrollmentSession) -> None:
        """Persist completed samples without destroying the session snapshot."""
        with self.enrollment_lock:
            if self.enrollment_session is not session or session.samples_persisted:
                return
            try:
                db.replace_user_face_samples(
                    session.user_id,
                    session.all_sample_paths,
                    preprocess_mode=config.sface_preprocess_mode,
                    dataset_dir=config.dataset_dir,
                )
            except Exception:
                logger.exception("enrollment_db_insert_failed user_id=%s", session.user_id)
                raise
            session.mark_persisted()
            self.pose_heuristic.clear_baseline()
            logger.info(
                "enrollment_finalized user_id=%s samples=%s",
                session.user_id,
                session.total_captured,
            )

    def purge_legacy_face_samples(self) -> dict[str, Any]:
        with self.analysis_lock:
            result = db.purge_face_samples(
                dataset_dir=config.dataset_dir,
                model_path=config.model_path,
            )
            self.recognizer.loaded = False
            with self.lock:
                self.system_status["model"] = "not_loaded"
                self.system_status["last_user"] = "-"
                self.system_status["last_result"] = "MUESTRAS_PURGADAS"
                self.system_status["last_confidence"] = None
                self.system_status["recognition_score"] = None
                self.system_status["recognition_variant"] = None
                self.system_status["timestamp"] = int(time.time())
            return result

    def _build_idle_enrollment_status(self) -> dict[str, Any]:
        steps_summary = [
            {
                "name": step["name"],
                "label": step["label"],
                "icon": step["icon"],
                "appearance_variant": step.get("appearance_variant", "normal"),
                "status": "pending",
                "samples": 0,
                "needed": config.enrollment_samples_per_step,
            }
            for step in ENROLLMENT_STEPS
        ]

        return {
            "phase": "preflight",
            "state": "idle",
            "user_id": None,
            "user_name": None,
            "current_step": None,
            "total_steps": len(ENROLLMENT_STEPS),
            "step_name": None,
            "step_label": None,
            "step_icon": None,
            "appearance_variant": None,
            "samples_this_step": 0,
            "samples_needed": config.enrollment_samples_per_step,
            "total_captured": 0,
            "total_needed": config.enrollment_samples_per_step * len(ENROLLMENT_STEPS),
            "awaiting_continue": False,
            "continue_title": None,
            "continue_hint": None,
            "continue_action_label": "Continuar",
            "steps_summary": steps_summary,
            "guidance": {
                "instruction": "Selecciona una persona para iniciar",
                "hint": "Prepara la iluminacion y deja el rostro visible antes de comenzar.",
                "arrow": None,
                "hold_progress": 0.0,
                "pose_matched": False,
                "face_detected": False,
                "brightness_ok": True,
                "multiple_faces": False,
                "glasses_detected": False,
                "face_bbox": None,
            },
            "actions": {
                "can_retry": False,
                "can_abort": False,
                "can_finish": False,
                "can_train": False,
            },
            "started_at": None,
            "updated_at": int(time.time() * 1000),
        }

    def manual_open(self):
        conf = db.get_config()
        self.relay.open_for(int(conf["tiempo_apertura_seg"]))
        self.gpio_activation_count += 1
        with self.lock:
            self.system_status["gpio_activations"] = self.gpio_activation_count
        db.insert_access(user_id=None, confianza=None, resultado="MANUAL")

    def get_status(self) -> dict[str, Any]:
        with self.lock:
            return dict(self.system_status)

    def set_backend_sleep(self, enabled: bool) -> dict[str, Any]:
        enabled = bool(enabled)
        if enabled == self.backend_sleep:
            with self.lock:
                self.system_status["sleep_mode"] = enabled
            return {"ok": True, "sleep_mode": enabled}

        self.backend_sleep = enabled
        if enabled:
            cam_active = self.camera.is_active()
            with self.lock:
                self.system_status["sleep_mode"] = True
                self.system_status["camera"] = "online" if cam_active else "degraded"
                self.system_status["camera_restarts"] = getattr(self.camera, "restart_count", 0)
                self.system_status["camera_fps"] = 0.0
                self.system_status["analysis_fps"] = 0.0
                self.system_status["fps"] = 0
                self.system_status["analysis_state"] = "sleep"
                self.system_status["analysis_busy"] = False
                self.system_status["face_detected"] = False
                self.system_status["face_bbox"] = None
                self.system_status["faces_count"] = 0
                self.system_status["primary_face_bbox"] = None
                self.system_status["recognition_score"] = None
                self.system_status["recognition_variant"] = None
            logger.info("backend_sleep_enabled camera_kept_running=true camera_active=%s", cam_active)
            return {"ok": True, "sleep_mode": True}

        try:
            if not self.camera.running:
                self.camera.start()
            cam_active = self.camera.is_active()
            with self.lock:
                self.system_status["sleep_mode"] = False
                self.system_status["camera"] = "online" if cam_active else "degraded"
                self.system_status["camera_restarts"] = getattr(self.camera, "restart_count", 0)
                self.system_status["analysis_state"] = "idle"
                self.system_status["analysis_busy"] = False
            logger.info("backend_sleep_disabled camera_active=%s", cam_active)
            return {"ok": True, "sleep_mode": False}
        except Exception:
            with self.lock:
                self.system_status["sleep_mode"] = False
                self.system_status["camera"] = "error"
                self.system_status["camera_restarts"] = getattr(self.camera, "restart_count", 0)
                self.system_status["analysis_state"] = "error"
            logger.exception("backend_wake_failed")
            return {"ok": False, "sleep_mode": False, "error": "camera_start_failed"}

    def _health_components(self) -> tuple[bool, bool, bool, bool]:
        camera_ok = True if self.backend_sleep else self.camera.is_active()
        model_ok = Path(config.model_path).exists() and self.recognizer.loaded
        db_ok = db.health_check()
        gpio_ok = self.relay.is_healthy()
        return camera_ok, model_ok, db_ok, gpio_ok

    def health_liveness(self) -> dict[str, Any]:
        camera_ok, model_ok, db_ok, gpio_ok = self._health_components()
        healthy = bool(camera_ok and model_ok and db_ok and gpio_ok)
        return {"healthy": healthy}

    def health_detail(self) -> dict[str, Any]:
        camera_ok, model_ok, db_ok, gpio_ok = self._health_components()
        healthy = bool(camera_ok and model_ok and db_ok and gpio_ok)
        return {
            "healthy": healthy,
            "camera_active": camera_ok,
            "model_loaded": model_ok,
            "db_accessible": db_ok,
            "gpio_initialized": gpio_ok,
            "metrics": {
                "avg_recognition_ms": self.system_status.get("avg_recognition_ms", 0.0),
                "avg_pipeline_ms": self.system_status.get("avg_pipeline_ms", 0.0),
                "fps": self.system_status.get("fps", 0),
                "camera_fps": self.system_status.get("camera_fps", 0.0),
                "analysis_fps": self.system_status.get("analysis_fps", 0.0),
                "failed_attempts_consecutive": self.consecutive_denied,
                "attempts_processed": self.attempts_processed,
                "gpio_activations": self.gpio_activation_count,
            },
        }

    def simulate_access_attempt(self, is_valid: bool, confidence: Optional[float] = None) -> dict[str, Any]:
        conf = db.get_config()
        threshold = float(conf["umbral_confianza"])
        open_sec = int(conf["tiempo_apertura_seg"])

        user_id = None
        user_name = "Desconocido"
        result = "DENEGADO"

        if is_valid:
            active_user = db.fetch_one("SELECT id, nombre FROM usuarios WHERE activo=1 ORDER BY id ASC LIMIT 1")
            if active_user:
                user_id = int(active_user["id"])
                user_name = str(active_user["nombre"])
                result = "AUTORIZADO"
                self.consecutive_denied = 0
                confidence_value = float(confidence if confidence is not None else min(100.0, threshold + 10.0))
                self.relay.open_for(open_sec)
                self.gpio_activation_count += 1
            else:
                confidence_value = float(confidence if confidence is not None else max(0.0, threshold - 10.0))
                result = "DENEGADO"
                self.consecutive_denied += 1
        else:
            confidence_value = float(confidence if confidence is not None else max(0.0, threshold - 10.0))
            self.consecutive_denied += 1

        self.attempts_processed += 1
        db.insert_access(user_id=user_id, confianza=confidence_value, resultado=result)

        with self.lock:
            self.system_status["last_user"] = user_name
            self.system_status["last_result"] = result
            self.system_status["last_confidence"] = confidence_value
            self.system_status["recognition_score"] = confidence_value
            self.system_status["recognition_metric"] = self.recognizer.recognition_metric
            self.system_status["recognition_variant"] = None
            self.system_status["timestamp"] = int(time.time())
            self.system_status["failed_attempts_consecutive"] = self.consecutive_denied
            self.system_status["attempts_processed"] = self.attempts_processed
            self.system_status["gpio_activations"] = self.gpio_activation_count

        return {
            "result": result,
            "user_id": user_id,
            "confidence": confidence_value,
            "failed_attempts_consecutive": self.consecutive_denied,
            "gpio_activations": self.gpio_activation_count,
        }


def setup_logging() -> None:
    Path("logs").mkdir(parents=True, exist_ok=True)
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers.clear()

    formatter = logging.Formatter(
        "%(asctime)s level=%(levelname)s logger=%(name)s msg=%(message)s"
    )

    file_handler = RotatingFileHandler(
        config.logs_path,
        maxBytes=5 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)

    root.addHandler(file_handler)
    root.addHandler(console_handler)


def create_app() -> FastAPI:
    setup_logging()
    try:
        db.init_db()
    except Exception:
        logger.critical("startup_db_init_failed", exc_info=True)
        raise

    if not config.debug and not config.secret_key:
        raise RuntimeError("CAMERAPI_SECRET es obligatorio cuando CAMERAPI_DEBUG=false")
    if config.debug and config.secret_key == "camerapi-local-secret":
        logger.warning("using_development_secret_key debug=true")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.service.start()
        try:
            yield
        finally:
            app.state.service.stop()

    app = FastAPI(title=config.app_name, lifespan=lifespan)
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)
    if config.cors_origins:
        allow_credentials = config.cors_origins != ["*"]
        app.add_middleware(
            CORSMiddleware,
            allow_origins=config.cors_origins,
            allow_credentials=allow_credentials,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=["*"],
        )
    app.add_middleware(
        SessionMiddleware,
        secret_key=config.secret_key,
        same_site="lax",
        https_only=config.session_https_only,
        max_age=config.session_max_age_seconds,
    )

    app.mount("/static", StaticFiles(directory="frontend/static"), name="static")
    app.state.templates = Jinja2Templates(directory="frontend/templates")
    app.state.asset_version = str(int(time.time()))
    app.state.service = AccessService()

    app.include_router(router)
    return app


_app_instance: Optional[FastAPI] = None


def get_app() -> FastAPI:
    global _app_instance
    if _app_instance is None:
        _app_instance = create_app()
    return _app_instance


app = get_app()


if __name__ == "__main__":
    try:
        uvicorn.run(app, host=config.host, port=config.port, reload=False)
    except KeyboardInterrupt:
        logger.info("keyboard_interrupt_received shutting_down=true")
    except Exception:
        logger.critical("fatal_runtime_error", exc_info=True)
        raise
