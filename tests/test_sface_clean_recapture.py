from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from config import config
from database.db import Database
from vision.detector import FaceDetection
from vision.enrollment import EnrollmentSession


class _FakePose:
    has_baseline = False

    def clear_baseline(self):
        self.has_baseline = False

    def set_baseline(self, face, frame_shape):
        self.has_baseline = True

    def analyze(self, gray, face, frame_shape):
        return SimpleNamespace(brightness=120.0)

    def check_step(self, step_name, hints):
        return True, "ok"


class _FakeSFace:
    def feature(self, image):
        marker = int(image[0, 0, 0])
        if marker >= 200:
            return np.array([[1.0, 0.0, 0.0, 0.0]], dtype=np.float32)
        return np.array([[0.0, 1.0, 0.0, 0.0]], dtype=np.float32)


def test_enrollment_captures_sface_aligned_color_sample(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "dataset_dir", str(tmp_path / "dataset"))
    monkeypatch.setattr(config, "enrollment_samples_per_step", 1)
    monkeypatch.setattr(config, "enrollment_hold_steady_ms", 0)
    monkeypatch.setattr(config, "enrollment_brightness_threshold", 1.0)

    aligned = np.full((112, 112, 3), (20, 90, 220), dtype=np.uint8)
    calls = []

    def align_crop(frame, face):
        calls.append((frame.shape, face))
        return aligned

    session = EnrollmentSession(
        user_id=9,
        pose=_FakePose(),
        user_name="Ada",
        face_aligner=align_crop,
    )
    frame = np.full((180, 220, 3), 255, dtype=np.uint8)
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    face = FaceDetection(
        bbox=(40, 30, 70, 90),
        landmarks=np.array([[52, 54], [91, 55], [70, 78], [56, 105], [92, 106]], dtype=np.float32),
        score=0.92,
    )

    session.update(frame, gray, face, 1)

    assert calls and calls[0][1] is face
    assert session.state == "completed"
    [relative_path] = [path for path, _pose in session.all_sample_paths]
    saved = cv2.imread(str(Path(relative_path)))
    assert saved.shape == (112, 112, 3)
    assert int(saved[0, 0, 2]) > 180


def test_recognizer_rejects_index_without_clean_preprocess_metadata(tmp_path, monkeypatch):
    import vision.recognizer as recognizer_module

    model_path = tmp_path / "sface.onnx"
    index_path = tmp_path / "legacy_embeddings.npz"
    model_path.write_bytes(b"onnx")
    np.savez(
        index_path,
        user_ids=np.array([1], dtype=np.int32),
        embeddings=np.array([[1.0, 0.0, 0.0, 0.0]], dtype=np.float32),
        sample_counts=np.array([3], dtype=np.int32),
        metric=np.array(["cosine_similarity"]),
    )
    monkeypatch.setattr(
        recognizer_module.cv2,
        "FaceRecognizerSF_create",
        lambda *args, **kwargs: _FakeSFace(),
    )

    recognizer = recognizer_module.SFaceRecognizer(
        model_path=str(model_path),
        embedding_path=str(index_path),
    )

    assert recognizer.load_model() is False
    assert recognizer.loaded is False


def test_trainer_uses_only_sface_align_crop_samples(tmp_path, monkeypatch):
    import vision.trainer as trainer_module

    clean_path = tmp_path / "clean.jpg"
    legacy_path = tmp_path / "legacy.jpg"
    cv2.imwrite(str(clean_path), np.full((112, 112, 3), 255, dtype=np.uint8))
    cv2.imwrite(str(legacy_path), np.zeros((200, 200, 3), dtype=np.uint8))

    class FakeDB:
        def list_samples(self, user_id=None, preprocess_mode=None):
            assert preprocess_mode == "sface_align_crop"
            return [
                {"usuario_id": 4, "imagen_ref": str(clean_path), "preprocess_mode": "sface_align_crop"},
            ]

    class FakeRecognizer:
        def __init__(self):
            self.images = None
            self.labels = None

        def train(self, images, labels):
            self.images = images
            self.labels = labels

        def save_model(self, *args, **kwargs):
            pass

    recognizer = FakeRecognizer()
    monkeypatch.setattr(trainer_module, "db", FakeDB())

    result = trainer_module.FaceTrainer(recognizer).train_from_dataset()

    assert result["samples_used"] == 1
    assert result["unique_users"] == 1
    assert recognizer.labels == [4]
    assert recognizer.images[0].shape == (112, 112, 3)


def test_trainer_fails_clearly_when_only_legacy_samples_exist(monkeypatch):
    import vision.trainer as trainer_module

    class FakeDB:
        def list_samples(self, user_id=None, preprocess_mode=None):
            assert preprocess_mode == "sface_align_crop"
            return []

    monkeypatch.setattr(trainer_module, "db", FakeDB())

    with pytest.raises(ValueError, match="Recaptura"):
        trainer_module.FaceTrainer(SimpleNamespace()).train_from_dataset()


def test_purge_face_samples_removes_files_rows_and_model(tmp_path):
    db_path = tmp_path / "camerapi.sqlite"
    database = Database(str(db_path), schema_path="database/schema.sql")
    database.init_db()
    user_id = database.create_user("Ada")
    dataset_root = tmp_path / "dataset"
    model_path = tmp_path / "models" / "sface_embeddings.npz"
    sample = dataset_root / f"user_{user_id}" / "enroll_center_001.jpg"
    sample.parent.mkdir(parents=True)
    sample.write_bytes(b"sample")
    model_path.parent.mkdir(parents=True)
    model_path.write_bytes(b"model")
    database.insert_sample_with_pose(
        user_id,
        str(sample.relative_to(tmp_path)),
        "center",
        preprocess_mode="legacy_bbox",
    )
    database.insert_access(user_id, 99.0, "AUTORIZADO")

    result = database.purge_face_samples(
        dataset_dir=str(dataset_root),
        model_path=str(model_path),
    )

    assert result == {"ok": True, "deleted_files": 1, "deleted_samples": 1, "model_removed": True}
    assert database.get_user(user_id)["nombre"] == "Ada"
    assert database.count_user_samples(user_id) == 0
    assert database.fetch_one("SELECT COUNT(*) AS n FROM accesos")["n"] == 1
    assert not sample.exists()
    assert not model_path.exists()
