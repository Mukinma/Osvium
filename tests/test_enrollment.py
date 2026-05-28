from pathlib import Path
from types import SimpleNamespace

import numpy as np

from config import config
from vision.enrollment import ENROLLMENT_STEPS, EnrollmentSession


class _FakePose:
    def __init__(self):
        self.has_baseline = False
        self.brightness = 120.0
        self.matched = False
        self.message = "Sigue la guia"

    def clear_baseline(self):
        self.has_baseline = False

    def set_baseline(self, face, frame_shape):
        self.has_baseline = True

    def analyze(self, gray, face, frame_shape):
        return SimpleNamespace(brightness=self.brightness)

    def check_step(self, step_name, hints):
        return self.matched, self.message


def _make_session(tmp_path, monkeypatch, *, user_id=5, user_name="Ana Prueba"):
    dataset_dir = tmp_path / "dataset"
    monkeypatch.setattr(config, "dataset_dir", str(dataset_dir))
    pose = _FakePose()
    session = EnrollmentSession(user_id=user_id, pose=pose, user_name=user_name)
    return session, pose, dataset_dir


def test_enrollment_session_starts_with_rehydratable_snapshot(tmp_path, monkeypatch):
    session, _pose, _dataset_dir = _make_session(tmp_path, monkeypatch)

    status = session.get_status()

    assert status["phase"] == "active"
    assert status["state"] == "step_active"
    assert status["user_name"] == "Ana Prueba"
    assert status["current_step"] == 0
    assert status["total_steps"] == len(ENROLLMENT_STEPS)
    assert status["guidance"]["instruction"] == "Rostro normal"
    assert status["appearance_variant"] == "normal"
    assert [step["appearance_variant"] for step in status["steps_summary"]] == [
        "normal",
        "cabello_recogido",
        "casco",
    ]
    assert status["actions"]["can_abort"] is True
    assert status["actions"]["can_train"] is False


def test_retry_step_clears_only_current_step_files(tmp_path, monkeypatch):
    session, _pose, dataset_dir = _make_session(tmp_path, monkeypatch)
    user_dir = dataset_dir / f"user_{session.user_id}"
    first_path = user_dir / "enroll_center_001.jpg"
    second_path = user_dir / "enroll_center_002.jpg"
    first_path.write_bytes(b"a")
    second_path.write_bytes(b"b")

    session._samples[0] = [
      f"{config.dataset_dir}/user_{session.user_id}/{first_path.name}",
      f"{config.dataset_dir}/user_{session.user_id}/{second_path.name}",
    ]

    session.retry_step()

    assert session.get_status()["samples_this_step"] == 0
    assert not first_path.exists()
    assert not second_path.exists()


def test_session_reports_multiple_faces_and_recovers_from_light_and_face_loss(tmp_path, monkeypatch):
    session, pose, _dataset_dir = _make_session(tmp_path, monkeypatch)
    frame = np.ones((120, 120, 3), dtype=np.uint8) * 255
    gray = np.ones((120, 120), dtype=np.uint8) * 255

    session.update(frame, gray, (10, 10, 40, 40), 2)
    status = session.get_status()
    assert status["guidance"]["multiple_faces"] is True
    assert status["guidance"]["hint"] == "Debe salir la otra persona"

    pose.brightness = 10.0
    session.update(frame, gray, (10, 10, 40, 40), 1)
    assert session.get_status()["state"] == "low_light"

    pose.brightness = 120.0
    pose.matched = False
    pose.message = "Mira de frente"
    session.update(frame, gray, (10, 10, 40, 40), 1)
    assert session.get_status()["state"] == "step_active"

    session._last_face_ms = 0
    session._now = lambda: session.face_lost_timeout_ms + 50
    session.update(frame, gray, None, 0)
    assert session.get_status()["state"] == "face_lost"

    session._now = lambda: session.face_lost_timeout_ms + 100
    session.update(frame, gray, (10, 10, 40, 40), 1)
    assert session.get_status()["state"] != "face_lost"


def test_completed_snapshot_marks_last_step_as_complete(tmp_path, monkeypatch):
    session, _pose, _dataset_dir = _make_session(tmp_path, monkeypatch)
    session._current_step = len(ENROLLMENT_STEPS) - 1
    session._state = "completed"
    session._samples = {
        index: [f"{config.dataset_dir}/user_{session.user_id}/sample_{index}_{sample}.jpg" for sample in range(config.enrollment_samples_per_step)]
        for index in range(len(ENROLLMENT_STEPS))
    }

    status = session.get_status()

    assert status["phase"] == "completed_review"
    assert status["steps_summary"][-1]["status"] == "complete"
    assert status["actions"]["can_finish"] is True
    assert status["actions"]["can_train"] is True
