import logging
import sys
import threading
import time
from typing import Optional

import cv2
import numpy as np

from config import config

logger = logging.getLogger("camerapi.camera")

try:
    from picamera2 import Picamera2

    _HAS_PICAMERA2 = True
    _PICAMERA2_IMPORT_ERROR: Optional[str] = None
except ImportError as _exc:
    _HAS_PICAMERA2 = False
    _PICAMERA2_IMPORT_ERROR: Optional[str] = str(_exc)


class CameraStream:
    def __init__(self):
        self.lock = threading.Lock()
        self.frame_cond = threading.Condition(self.lock)
        self.frame = None
        self.jpeg_frame: Optional[bytes] = None
        self.frame_seq = 0
        self.running = False
        self.thread: Optional[threading.Thread] = None
        self.last_frame_time = 0.0
        self.retry_delay_sec = 2.0
        self.max_open_retries = 5
        self.capture_fps = 0.0
        self._fps_tick_perf = time.perf_counter()
        self._fps_counter = 0
        self._jpeg_clients = 0

        self._use_picamera2 = _HAS_PICAMERA2 and sys.platform == "linux"

        # OpenCV backend
        self.cap: Optional[cv2.VideoCapture] = None

        # Picamera2 backend
        self._picam: Optional["Picamera2"] = None
        self._picam_started = False
        self._consecutive_read_failures = 0

        if self._use_picamera2:
            logger.info("camera_backend=picamera2")
        else:
            if _PICAMERA2_IMPORT_ERROR:
                logger.info("camera_backend=opencv picamera2_unavailable reason=%s", _PICAMERA2_IMPORT_ERROR)
            else:
                logger.info("camera_backend=opencv")
        logger.info("camera_orientation flip_horizontal=%s", config.camera_flip_horizontal)

    # ── Picamera2 backend ────────────────────────────────────────────

    @staticmethod
    def _target_frame_duration_us() -> int:
        return int(round(1_000_000 / float(max(1, config.max_fps))))

    def _configure_picamera2_controls(self, picam: "Picamera2") -> None:
        target_fps = float(max(1, config.max_fps))
        frame_duration_us = self._target_frame_duration_us()
        controls = (
            {"FrameDurationLimits": (frame_duration_us, frame_duration_us)},
            {"FrameRate": target_fps},
        )
        for control in controls:
            try:
                picam.set_controls(control)
            except Exception:
                key = next(iter(control.keys()))
                logger.debug("picamera2_control_unsupported control=%s", key)

    @staticmethod
    def _select_full_fov_raw_size(picam: "Picamera2") -> Optional[tuple]:
        """Return the smallest sensor mode that covers the full sensor FOV.

        Modes with crop_limits starting at (0, 0) use the entire sensor area,
        avoiding the centre-crop zoom effect that lower-resolution modes produce.
        """
        try:
            modes = picam.sensor_modes
            full_fov = [
                m for m in modes
                if len(m.get("crop_limits", ())) >= 2
                and m["crop_limits"][0] == 0
                and m["crop_limits"][1] == 0
            ]
            if full_fov:
                return min(full_fov, key=lambda m: m["size"][0] * m["size"][1])["size"]
        except Exception:
            pass
        return None

    def _open_picamera2(self) -> bool:
        for attempt in range(1, self.max_open_retries + 1):
            try:
                self._release_picamera2()
                picam = Picamera2()
                raw_size = self._select_full_fov_raw_size(picam)
                video_cfg = picam.create_video_configuration(
                    main={
                        "format": "BGR888",
                        "size": (config.frame_width, config.frame_height),
                    },
                    **({"raw": {"size": raw_size}} if raw_size else {}),
                )
                picam.configure(video_cfg)
                picam.start()
                try:
                    for _ in range(3):
                        picam.capture_array("main")
                        time.sleep(0.1)
                except Exception:
                    logger.debug("picamera2_warmup_skipped attempt=%s", attempt, exc_info=True)
                self._configure_picamera2_controls(picam)
                time.sleep(1.0)
                self._picam = picam
                self._picam_started = True
                logger.info(
                    "picamera2_open_ok attempt=%s size=%sx%s fps=%s full_fov_raw=%s",
                    attempt,
                    config.frame_width,
                    config.frame_height,
                    config.max_fps,
                    raw_size,
                )
                return True
            except Exception:
                logger.exception("picamera2_open_failed attempt=%s", attempt)
                time.sleep(self.retry_delay_sec)
        return False

    def _release_picamera2(self) -> None:
        if self._picam is not None:
            try:
                if self._picam_started:
                    self._picam.stop()
                self._picam.close()
            except Exception:
                logger.exception("picamera2_release_failed")
        self._picam = None
        self._picam_started = False

    def _read_picamera2(self):
        if self._picam is None:
            return False, None
        try:
            frame = self._picam.capture_array("main")
            if frame is None or frame.size == 0:
                return False, None
            # Picamera2 puede reutilizar el buffer del request; trabajamos sobre una
            # copia contigua para evitar artefactos visuales durante el encode/render.
            frame = np.ascontiguousarray(frame.copy())
            if len(frame.shape) == 3:
                if frame.shape[2] == 4:
                    frame = cv2.cvtColor(frame, cv2.COLOR_RGBA2BGR)
                elif frame.shape[2] == 3:
                    frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
            return True, frame
        except Exception:
            logger.exception("picamera2_capture_failed")
            return False, None

    # ── OpenCV backend ───────────────────────────────────────────────

    def _preferred_backends(self) -> list[tuple[str, Optional[int]]]:
        if sys.platform == "darwin" and hasattr(cv2, "CAP_AVFOUNDATION"):
            return [("AVFOUNDATION", int(cv2.CAP_AVFOUNDATION)), ("DEFAULT", None)]
        if sys.platform.startswith("linux"):
            backends: list[tuple[str, Optional[int]]] = []
            if hasattr(cv2, "CAP_V4L2"):
                backends.append(("V4L2", int(cv2.CAP_V4L2)))
            if hasattr(cv2, "CAP_GSTREAMER"):
                backends.append(("GSTREAMER", int(cv2.CAP_GSTREAMER)))
            backends.append(("DEFAULT", None))
            return backends
        return [("DEFAULT", None)]

    def _configure_capture(self, cap: cv2.VideoCapture) -> None:
        if hasattr(cv2, "CAP_PROP_FOURCC"):
            try:
                cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
            except Exception:
                logger.debug("camera_fourcc_mjpg_unsupported")
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, config.frame_width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, config.frame_height)
        cap.set(cv2.CAP_PROP_FPS, config.max_fps)
        if hasattr(cv2, "CAP_PROP_BUFFERSIZE"):
            try:
                cap.set(cv2.CAP_PROP_BUFFERSIZE, config.camera_buffer_size)
            except Exception:
                logger.debug("camera_buffer_size_unsupported")

    def _open_single(self, backend: Optional[int]) -> Optional[cv2.VideoCapture]:
        if backend is None:
            cap = cv2.VideoCapture(config.camera_index)
        else:
            cap = cv2.VideoCapture(config.camera_index, backend)
        self._configure_capture(cap)
        return cap

    def _warmup_opencv_capture(self, cap: cv2.VideoCapture, *, attempt: int, backend_name: str) -> None:
        try:
            for _ in range(3):
                ok, _frame = cap.read()
                if ok:
                    break
                time.sleep(0.1)
        except Exception:
            logger.debug(
                "camera_warmup_skipped attempt=%s backend=%s",
                attempt,
                backend_name,
                exc_info=True,
            )

    def _open_opencv(self) -> bool:
        for attempt in range(1, self.max_open_retries + 1):
            for backend_name, backend in self._preferred_backends():
                cap: Optional[cv2.VideoCapture] = None
                try:
                    cap = self._open_single(backend)
                    if cap.isOpened():
                        self._warmup_opencv_capture(cap, attempt=attempt, backend_name=backend_name)
                        self._release_opencv()
                        self.cap = cap
                        self._consecutive_read_failures = 0
                        logger.info(
                            "camera_open_ok attempt=%s index=%s backend=%s",
                            attempt,
                            config.camera_index,
                            backend_name,
                        )
                        return True
                except Exception:
                    logger.exception(
                        "camera_open_exception attempt=%s backend=%s",
                        attempt,
                        backend_name,
                    )
                finally:
                    if cap is not None and self.cap is not cap:
                        try:
                            cap.release()
                        except Exception:
                            logger.debug("camera_open_temp_release_failed")
            logger.error(
                "camera_open_failed attempt=%s retry_in=%ss",
                attempt,
                self.retry_delay_sec,
            )
            time.sleep(self.retry_delay_sec)
        return False

    def _release_opencv(self) -> None:
        if self.cap is not None:
            try:
                self.cap.release()
            except Exception:
                logger.exception("camera_release_failed")
        self.cap = None
        self._consecutive_read_failures = 0

    # ── Unified interface ────────────────────────────────────────────

    def _open_camera(self) -> bool:
        if self._use_picamera2:
            return self._open_picamera2()
        return self._open_opencv()

    def _release_capture(self) -> None:
        if self._use_picamera2:
            self._release_picamera2()
        else:
            self._release_opencv()

    def _camera_lost(self) -> bool:
        if self._use_picamera2:
            return self._picam is None or not self._picam_started
        return self.cap is None or not self.cap.isOpened()

    def _apply_frame_orientation(self, frame):
        if frame is None:
            return None
        if config.camera_flip_horizontal and config.camera_flip_vertical:
            return cv2.flip(frame, -1)
        if config.camera_flip_horizontal:
            return cv2.flip(frame, 1)
        if config.camera_flip_vertical:
            return cv2.flip(frame, 0)
        return frame

    def _read_frame(self):
        if self._use_picamera2:
            ok, frame = self._read_picamera2()
        elif self.cap is not None:
            ok, frame = self.cap.read()
        else:
            return False, None

        if not ok or frame is None:
            return ok, frame

        return True, self._apply_frame_orientation(frame)

    # ── Lifecycle ────────────────────────────────────────────────────

    def start(self) -> None:
        if self.running:
            return
        if not self._open_camera():
            raise RuntimeError("No se pudo inicializar la cámara")
        self.running = True
        self.thread = threading.Thread(target=self._capture_loop, daemon=True)
        self.thread.start()

    def _capture_loop(self) -> None:
        min_interval = 1.0 / max(1, config.max_fps)
        next_tick = time.perf_counter()
        while self.running:
            now_perf = time.perf_counter()
            sleep_s = next_tick - now_perf
            if sleep_s > 0:
                time.sleep(sleep_s)
                continue
            next_tick = now_perf + min_interval

            if self._camera_lost():
                logger.error("camera_stream_lost reopening=true")
                if not self._open_camera():
                    time.sleep(self.retry_delay_sec)
                    next_tick = time.perf_counter() + min_interval
                    continue

            ok, raw = self._read_frame()
            if ok:
                self._consecutive_read_failures = 0
                with self.lock:
                    encode_jpeg = self._jpeg_clients > 0

                jpeg = None
                if encode_jpeg:
                    encoded_ok, encoded = cv2.imencode(
                        ".jpg",
                        raw,
                        [cv2.IMWRITE_JPEG_QUALITY, config.camera_jpeg_quality],
                    )
                    if encoded_ok:
                        jpeg = encoded.tobytes()
                with self.frame_cond:
                    self.frame = raw.copy()
                    self.jpeg_frame = jpeg if encode_jpeg else None
                    self.frame_seq += 1
                    self.last_frame_time = time.time()
                    self._fps_counter += 1
                    frame_tick_perf = time.perf_counter()
                    elapsed = frame_tick_perf - self._fps_tick_perf
                    if elapsed >= 1.0:
                        self.capture_fps = self._fps_counter / elapsed
                        self._fps_counter = 0
                        self._fps_tick_perf = frame_tick_perf
                    self.frame_cond.notify_all()
            else:
                self._consecutive_read_failures += 1
                logger.error(
                    "camera_frame_read_failed consecutive_failures=%s",
                    self._consecutive_read_failures,
                )
                if self._consecutive_read_failures >= 3:
                    self._release_capture()
                time.sleep(self.retry_delay_sec)
                next_tick = time.perf_counter() + min_interval

    def get_frame(self, copy: bool = True):
        with self.lock:
            if self.frame is None:
                return None
            return self.frame.copy() if copy else self.frame

    def get_capture_fps(self) -> float:
        with self.lock:
            return float(self.capture_fps)

    def register_jpeg_client(self) -> None:
        with self.lock:
            self._jpeg_clients += 1

    def unregister_jpeg_client(self) -> None:
        with self.lock:
            self._jpeg_clients = max(0, self._jpeg_clients - 1)

    def get_jpeg(self, last_seq: int = 0, timeout: float = 0.5) -> tuple[Optional[bytes], int]:
        deadline = time.monotonic() + max(0.0, timeout)
        with self.frame_cond:
            while self.running and self.frame_seq <= last_seq:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                self.frame_cond.wait(timeout=remaining)
            return self.jpeg_frame, self.frame_seq

    def stop(self) -> None:
        self.running = False
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=1.0)
        self._release_capture()
        with self.frame_cond:
            self.frame = None
            self.jpeg_frame = None
            self.frame_cond.notify_all()
        with self.lock:
            self.capture_fps = 0.0
            self._fps_tick_perf = time.perf_counter()
            self._fps_counter = 0
            self._jpeg_clients = 0

    def is_active(self) -> bool:
        recent = (time.time() - self.last_frame_time) < 3.0
        thread_alive = self.thread is not None and self.thread.is_alive()
        cam_ok = not self._camera_lost()
        return bool(self.running and thread_alive and cam_ok and recent)

    def ensure_running(self) -> bool:
        if not self.running:
            return False
        if self.thread is None or not self.thread.is_alive():
            logger.critical("camera_capture_thread_dead restarting=true")
            try:
                self.thread = threading.Thread(target=self._capture_loop, daemon=True)
                self.thread.start()
                return True
            except Exception:
                logger.exception("camera_thread_restart_failed")
                return False
        return True
