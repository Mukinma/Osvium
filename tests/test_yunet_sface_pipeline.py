from pathlib import Path

import numpy as np


class _FakeYuNet:
    def __init__(self):
        self.input_sizes = []

    def setInputSize(self, size):
        self.input_sizes.append(tuple(size))

    def detect(self, frame):
        rows = np.array(
            [
                [10, 20, 30, 40, 16, 28, 35, 28, 25, 42, 18, 55, 32, 55, 0.91],
                [60, 15, 20, 25, 65, 20, 75, 20, 70, 30, 66, 38, 74, 38, 0.84],
            ],
            dtype=np.float32,
        )
        return 1, rows


class _FakeSFace:
    def feature(self, image):
        marker = int(image[0, 0, 0])
        if marker >= 200:
            return np.array([[1.0, 0.0, 0.0, 0.0]], dtype=np.float32)
        return np.array([[0.0, 1.0, 0.0, 0.0]], dtype=np.float32)

    def alignCrop(self, frame, face_row):
        x, y, w, h = [int(v) for v in face_row[:4]]
        return frame[y : y + h, x : x + w].copy()


def test_yunet_detector_returns_all_faces_with_landmarks(tmp_path, monkeypatch):
    import vision.detector as detector_module

    model_path = tmp_path / "yunet.onnx"
    model_path.write_bytes(b"onnx")
    fake = _FakeYuNet()
    monkeypatch.setattr(
        detector_module.cv2,
        "FaceDetectorYN_create",
        lambda *args, **kwargs: fake,
    )

    detector = detector_module.YuNetFaceDetector(model_path=str(model_path))
    faces = detector.detect(np.zeros((100, 120, 3), dtype=np.uint8))

    assert len(faces) == 2
    assert faces[0].bbox == (10, 20, 30, 40)
    assert faces[0].score == 0.91
    assert faces[0].landmarks.shape == (5, 2)
    assert fake.input_sizes[-1] == (120, 100)


def test_sface_recognizer_trains_centroids_and_loads_index(tmp_path, monkeypatch):
    import vision.recognizer as recognizer_module

    model_path = tmp_path / "sface.onnx"
    index_path = tmp_path / "sface_embeddings.npz"
    model_path.write_bytes(b"onnx")
    monkeypatch.setattr(
        recognizer_module.cv2,
        "FaceRecognizerSF_create",
        lambda *args, **kwargs: _FakeSFace(),
    )

    bright = np.full((112, 112, 3), 255, dtype=np.uint8)
    dim = np.zeros((112, 112, 3), dtype=np.uint8)
    recognizer = recognizer_module.SFaceRecognizer(
        model_path=str(model_path),
        embedding_path=str(index_path),
    )

    recognizer.train([bright, bright, dim], [7, 7, 9])
    recognizer.save_model()

    loaded = recognizer_module.SFaceRecognizer(
        model_path=str(model_path),
        embedding_path=str(index_path),
    )
    assert loaded.load_model()

    label, score = loaded.predict(bright)
    assert label == 7
    assert score >= 99.0
    assert loaded.sample_counts[7] == 2
    assert loaded.recognition_metric == "cosine_similarity"


def test_sface_align_crop_uses_yunet_landmarks_when_available(tmp_path, monkeypatch):
    import vision.recognizer as recognizer_module
    from vision.detector import FaceDetection

    model_path = tmp_path / "sface.onnx"
    model_path.write_bytes(b"onnx")
    fake = _FakeSFace()
    monkeypatch.setattr(
        recognizer_module.cv2,
        "FaceRecognizerSF_create",
        lambda *args, **kwargs: fake,
    )

    frame = np.full((80, 80, 3), 255, dtype=np.uint8)
    face = FaceDetection(
        bbox=(10, 12, 30, 32),
        landmarks=np.array(
            [[16, 18], [30, 18], [23, 28], [18, 38], [28, 38]],
            dtype=np.float32,
        ),
        score=0.95,
    )
    recognizer = recognizer_module.SFaceRecognizer(model_path=str(model_path))

    aligned = recognizer.align_crop(frame, face)

    assert aligned.shape == (32, 30, 3)
    assert aligned[0, 0, 0] == 255
    assert Path(model_path).exists()
