import threading
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np


def _service_with_faces(main_module, faces, frame):
    service = main_module.AccessService.__new__(main_module.AccessService)
    service.backend_sleep = False
    service.analysis_lock = threading.Lock()
    service.lock = threading.Lock()
    service.camera = SimpleNamespace(get_frame=lambda *args, **kwargs: frame)
    service.detector = SimpleNamespace(detect=lambda frame_arg, params: faces)
    service.detector_params = {}
    service.recognizer = SimpleNamespace(
        loaded=True,
        load_model=lambda *args, **kwargs: True,
        predict=lambda image: (1, 92.0),
        align_crop=lambda source, face: source[face[1] : face[1] + face[3], face[0] : face[0] + face[2]],
    )
    service.relay = SimpleNamespace(open_for=Mock())
    service.consecutive_denied = 0
    service.recognition_time_total_ms = 0.0
    service.recognition_count = 0
    service.attempts_processed = 0
    service.gpio_activation_count = 0
    service.system_status = {
        "face_detected": False,
        "face_bbox": None,
        "primary_face_bbox": None,
        "faces_count": 0,
        "face_updated_ts": 0,
        "analysis_state": "idle",
        "analysis_busy": False,
        "processing_errors": 0,
        "camera_frame_width": 0,
        "camera_frame_height": 0,
        "attempts_processed": 0,
        "gpio_activations": 0,
        "failed_attempts_consecutive": 0,
    }
    return service


def test_analyze_once_blocks_multiple_faces_without_logging_success(tmp_path, monkeypatch):
    import main as main_module

    model_path = tmp_path / "sface_embeddings.npz"
    model_path.write_bytes(b"index")
    monkeypatch.setattr(main_module.config, "model_path", str(model_path))
    monkeypatch.setattr(
        main_module.db,
        "get_config",
        lambda: {"umbral_confianza": 70.0, "tiempo_apertura_seg": 3, "max_intentos": 3},
    )
    monkeypatch.setattr(main_module.db, "get_user", lambda user_id: {"id": user_id, "nombre": "Ada", "activo": 1})
    insert_access = Mock()
    monkeypatch.setattr(main_module.db, "insert_access", insert_access)

    frame = np.full((100, 120, 3), 255, dtype=np.uint8)
    service = _service_with_faces(
        main_module,
        [(10, 10, 24, 24), (70, 12, 22, 22)],
        frame,
    )

    payload, status_code = service.analyze_once()

    assert status_code == 200
    assert payload["ok"] is False
    assert payload["event"] == "multiple_faces"
    assert payload["result"] == "MULTIPLE_FACES"
    assert payload["faces_count"] == 2
    assert service.relay.open_for.call_count == 0
    insert_access.assert_not_called()


def test_access_decision_never_returns_lockout_after_failed_attempts(monkeypatch):
    import main as main_module

    service = main_module.AccessService.__new__(main_module.AccessService)
    service.consecutive_denied = 2
    service.relay = SimpleNamespace(open_for=Mock())
    service.gpio_activation_count = 0

    user_id, user_name, result = service._apply_access_decision(
        label=None,
        score=10.0,
        conf={"umbral_confianza": 70.0, "tiempo_apertura_seg": 3, "max_intentos": 3},
    )

    assert user_id is None
    assert user_name == "Desconocido"
    assert result == "DENEGADO"
    assert service.consecutive_denied == 3
    service.relay.open_for.assert_not_called()


def test_capture_sample_rejects_multiple_faces(tmp_path, monkeypatch):
    import main as main_module

    monkeypatch.setattr(main_module.config, "dataset_dir", str(tmp_path / "dataset"))
    frame = np.full((100, 120, 3), 255, dtype=np.uint8)
    service = _service_with_faces(
        main_module,
        [(10, 10, 24, 24), (70, 12, 22, 22)],
        frame,
    )

    result = service.capture_sample(user_id=3, sample_index=1)

    assert result is None
    assert not Path(main_module.config.dataset_dir).exists()
