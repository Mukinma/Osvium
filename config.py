import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

_RECOGNITION_ENGINE = os.getenv("CAMERAPI_RECOGNITION_ENGINE", "insightface")


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw.strip())
    except ValueError:
        return default


def _clamp_int(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, int(value)))


def _resolve_secret_key() -> str:
    debug = _env_bool("CAMERAPI_DEBUG", False)
    if debug:
        return os.getenv("CAMERAPI_SECRET", "camerapi-local-secret")
    return os.getenv("CAMERAPI_SECRET", "")


def _resolve_cors_origins() -> list[str]:
    debug = _env_bool("CAMERAPI_DEBUG", False)
    raw = os.getenv("CAMERAPI_CORS_ORIGINS", "")
    origins = [value.strip() for value in raw.split(",") if value.strip()]
    if origins:
        return origins
    if debug:
        return ["*"]
    return []


@dataclass
class AppConfig:
    app_name: str = "CameraPI Access"
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = _env_bool("CAMERAPI_DEBUG", False)
    secret_key: str = _resolve_secret_key()
    cors_origins: list[str] = field(default_factory=_resolve_cors_origins)
    session_https_only: bool = _env_bool("CAMERAPI_SESSION_HTTPS_ONLY", False)
    session_max_age_seconds: int = _clamp_int(
        _env_int("CAMERAPI_SESSION_MAX_AGE_SECONDS", 8 * 60 * 60),
        300,
        7 * 24 * 60 * 60,
    )
    enable_restart: bool = _env_bool("CAMERAPI_ENABLE_RESTART", False)

    # Encrypt biometric files at rest (AES-128-CBC via Fernet).
    # Requires CAMERAPI_SECRET to be set.  Run migrate_encrypt_dataset.py first.
    storage_encrypted: bool = _env_bool("CAMERAPI_STORAGE_ENCRYPTED", False)

    # ── Recognition engine ──
    recognition_engine: str = _RECOGNITION_ENGINE

    db_path: str = "database/camerapi.db"
    model_path: str = (
        "models/face_encodings.pkl"
        if _RECOGNITION_ENGINE == "insightface"
        else "models/lbph_model.xml"
    )
    dataset_dir: str = "dataset"
    logs_path: str = "logs/system.log"

    camera_index: int = 0
    frame_width: int = 640
    frame_height: int = 480
    max_fps: int = _clamp_int(_env_int("CAMERAPI_MAX_FPS", 30), 1, 120)
    stream_fps: int = _clamp_int(_env_int("CAMERAPI_STREAM_FPS", 15), 1, 60)
    process_interval_ms: int = _clamp_int(_env_int("CAMERAPI_PROCESS_INTERVAL_MS", 200), 10, 2000)
    cv_threads: int = _clamp_int(_env_int("CAMERAPI_CV_THREADS", 2), 1, 16)
    camera_buffer_size: int = _clamp_int(_env_int("CAMERAPI_CAMERA_BUFFER_SIZE", 1), 1, 8)
    camera_jpeg_quality: int = _clamp_int(_env_int("CAMERAPI_CAMERA_JPEG_QUALITY", 80), 55, 95)
    camera_flip_horizontal: bool = _env_bool("CAMERAPI_CAMERA_FLIP_HORIZONTAL", True)

    cascade_filename: str = "haarcascade_frontalface_default.xml"
    detect_downscale: float = 0.5
    detect_scale_factor: float = 1.15
    detect_min_neighbors: int = 5
    detect_min_size_w: int = 96
    detect_min_size_h: int = 96

    recognition_cooldown_ms: int = 200
    roi_absdiff_threshold: float = 6.0
    roi_cache_max_age_ms: int = 200

    lbph_radius: int = 1
    lbph_neighbors: int = 8
    lbph_grid_x: int = 8
    lbph_grid_y: int = 8

    default_confidence_threshold: float = 50.0 if _RECOGNITION_ENGINE == "insightface" else 70.0
    default_open_seconds: int = 3
    default_max_attempts: int = 3

    admin_user: str = os.getenv("CAMERAPI_ADMIN_USER", "admin")
    admin_password: str = os.getenv("CAMERAPI_ADMIN_PASSWORD", "")

    # ── Enrollment ──
    enrollment_samples_per_step: int = 20
    enrollment_hold_steady_ms: int = 600
    enrollment_brightness_threshold: float = 40.0
    enrollment_face_lost_timeout_ms: int = 3000
    enrollment_bbox_offset_tolerance: float = 0.04

    # ── Liveness / anti-spoofing ──
    liveness_enabled: bool = _env_bool("CAMERAPI_LIVENESS_ENABLED", False)
    liveness_buffer_size: int = _clamp_int(_env_int("CAMERAPI_LIVENESS_BUFFER_SIZE", 10), 4, 30)
    liveness_t_live: float = float(os.getenv("CAMERAPI_LIVENESS_T_LIVE", "0.70"))
    liveness_t_spoof: float = float(os.getenv("CAMERAPI_LIVENESS_T_SPOOF", "0.30"))
    liveness_w_passive: float = float(os.getenv("CAMERAPI_LIVENESS_W_PASSIVE", "0.5"))
    liveness_w_motion: float = float(os.getenv("CAMERAPI_LIVENESS_W_MOTION", "0.5"))
    liveness_fft_band_low: float = float(os.getenv("CAMERAPI_LIVENESS_FFT_BAND_LOW", "0.25"))
    liveness_fft_band_high: float = float(os.getenv("CAMERAPI_LIVENESS_FFT_BAND_HIGH", "0.45"))
    liveness_challenge_pool: list[str] = field(
        default_factory=lambda: [
            s.strip()
            for s in os.getenv("CAMERAPI_LIVENESS_CHALLENGE_POOL", "blink,smile").split(",")
            if s.strip()
        ]
    )
    liveness_challenge_timeout_ms: int = _clamp_int(
        _env_int("CAMERAPI_LIVENESS_CHALLENGE_TIMEOUT_MS", 5000), 2000, 15000
    )
    liveness_challenge_max_retries: int = _clamp_int(
        _env_int("CAMERAPI_LIVENESS_CHALLENGE_MAX_RETRIES", 1), 0, 3
    )


config = AppConfig()
