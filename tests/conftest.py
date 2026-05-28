from fastapi import FastAPI
from fastapi.templating import Jinja2Templates
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.middleware.sessions import SessionMiddleware

import api.routes as routes_module
from api.routes import router
from rate_limit import limiter


class _DummyCamera:
    def __init__(self):
        self.active = True
        self.snapshot_payload = b"\xff\xd8fake"
        self.snapshot_content_type = "image/jpeg"
        self.stream_seq = 0

    def get_jpeg(self, last_seq=0, timeout=0.5):
        self.stream_seq = int(last_seq) + 1
        return b"\xff\xd8jpeg-bytes", self.stream_seq

    def get_stream_frame_seq(self):
        return self.stream_seq

    def is_active(self):
        return self.active

    def get_snapshot_frame(self):
        if self.snapshot_payload is None:
            return None, self.snapshot_content_type
        return self.snapshot_payload, self.snapshot_content_type


class _DummyService:
    def __init__(self):
        self.camera = _DummyCamera()
        self.running = True
        self._sleep_mode = False
        self._enrollment_status = None

    def _idle_enrollment_status(self):
        return {
            "phase": "preflight",
            "state": "idle",
            "user_id": None,
            "user_name": None,
            "current_step": None,
            "total_steps": 7,
            "step_name": None,
            "step_label": None,
            "step_icon": None,
            "samples_this_step": 0,
            "samples_needed": 5,
            "total_captured": 0,
            "total_needed": 35,
            "steps_summary": [],
            "guidance": {
                "instruction": "Selecciona una persona para iniciar",
                "hint": "Prepara la iluminacion y centra el rostro antes de comenzar.",
                "arrow": None,
                "hold_progress": 0.0,
                "pose_matched": False,
                "face_detected": False,
                "brightness_ok": True,
                "multiple_faces": False,
            },
            "actions": {
                "can_retry": False,
                "can_abort": False,
                "can_finish": False,
                "can_train": False,
            },
            "started_at": None,
            "updated_at": 1,
        }

    def _active_enrollment_status(self, user_id: int):
        return {
            "phase": "active",
            "state": "step_active",
            "user_id": user_id,
            "user_name": f"Usuario {user_id}",
            "current_step": 0,
            "total_steps": 7,
            "step_name": "center",
            "step_label": "Mira de frente",
            "step_icon": "circle-dot",
            "samples_this_step": 0,
            "samples_needed": 5,
            "total_captured": 0,
            "total_needed": 35,
            "steps_summary": [
                {
                    "name": "center",
                    "label": "Mira de frente",
                    "icon": "circle-dot",
                    "status": "active",
                    "samples": 0,
                    "needed": 5,
                }
            ],
            "guidance": {
                "instruction": "Mira de frente",
                "hint": "Sigue la guia en pantalla",
                "arrow": None,
                "hold_progress": 0.0,
                "pose_matched": False,
                "face_detected": False,
                "brightness_ok": True,
                "multiple_faces": False,
            },
            "actions": {
                "can_retry": False,
                "can_abort": True,
                "can_finish": False,
                "can_train": False,
            },
            "started_at": 10,
            "updated_at": 10,
        }

    def analyze_once(self):
        return {"ok": True, "event": "authorized", "result": "AUTORIZADO"}, 200

    def get_status(self):
        return {
            "status": "ok",
            "camera": "online",
            "model": "loaded",
            "face_detected": False,
            "face_bbox": None,
            "analysis_busy": False,
            "face_guidance": {
                "state": "idle",
                "message": "Coloca tu rostro dentro de la guía",
                "is_aligned": False,
                "is_stable": False,
                "ready": False,
                "faces_count": 0,
                "offset_x": 0.0,
                "offset_y": 0.0,
                "scale_ratio": 0.0,
                "stability_score": 0.0,
                "steady_ms": 0,
            },
        }

    def health_liveness(self):
        return {"healthy": True}

    def health_detail(self):
        return {
            "healthy": True,
            "camera_active": True,
            "model_loaded": True,
            "db_accessible": True,
            "gpio_initialized": True,
            "metrics": {"fps": 10},
        }

    def simulate_access_attempt(self, is_valid, confidence=None):
        return {"result": "AUTORIZADO" if is_valid else "DENEGADO", "confidence": confidence}

    def set_backend_sleep(self, enabled: bool):
        self._sleep_mode = bool(enabled)
        return {"ok": True, "sleep_mode": self._sleep_mode}

    def start_enrollment(self, user_id: int):
        if self._enrollment_status and self._enrollment_status.get("state") != "idle":
            return {**self._enrollment_status, "ok": False, "error": "enrollment_already_active"}
        self._enrollment_status = self._active_enrollment_status(user_id)
        return {**self._enrollment_status, "ok": True}

    def get_enrollment_status(self):
        return self._enrollment_status or self._idle_enrollment_status()

    def abort_enrollment(self):
        if not self._enrollment_status:
            return {**self._idle_enrollment_status(), "ok": False, "error": "no_active_session"}
        self._enrollment_status = None
        return {**self._idle_enrollment_status(), "ok": True}

    def retry_enrollment_step(self):
        if not self._enrollment_status:
            return {**self._idle_enrollment_status(), "ok": False, "error": "no_active_session"}
        return {**self._enrollment_status, "ok": True}

    def finish_enrollment(self):
        if not self._enrollment_status:
            return {**self._idle_enrollment_status(), "ok": False, "error": "no_active_session"}
        if self._enrollment_status.get("phase") != "completed_review":
            return {**self._enrollment_status, "ok": False, "error": "enrollment_not_finishable"}
        self._enrollment_status = None
        return {**self._idle_enrollment_status(), "ok": True, "finished": True}


def _build_app() -> FastAPI:
    app = FastAPI()
    app.state.templates = Jinja2Templates(directory="frontend/templates")
    app.state.service = _DummyService()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)
    app.add_middleware(SessionMiddleware, secret_key="test-secret")
    app.include_router(router)
    return app


def _apply_test_config() -> None:
    routes_module.config.admin_user = "admin"
    routes_module.config.admin_password = "admin-pass"
    routes_module.config.debug = False
    routes_module.db.get_admin_by_username = lambda username: None


def _reset_limiter_state() -> None:
    storage = getattr(limiter, "_storage", None)
    if storage and hasattr(storage, "reset"):
        storage.reset()


def _build_client() -> TestClient:
    _apply_test_config()
    _reset_limiter_state()
    app = _build_app()
    return TestClient(app)


import pytest


@pytest.fixture()
def client():
    return _build_client()
