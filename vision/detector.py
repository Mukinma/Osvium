from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator, Optional

import cv2
import numpy as np

from config import config

try:
    from insightface.app import FaceAnalysis
    _HAS_INSIGHTFACE = True
except ImportError:
    _HAS_INSIGHTFACE = False


@dataclass(frozen=True)
class FaceDetection:
    bbox: tuple[int, int, int, int]
    landmarks: Optional[np.ndarray] = None
    score: float = 0.0

    def __iter__(self) -> Iterator[int]:
        return iter(self.bbox)

    def __getitem__(self, index: int) -> int:
        return self.bbox[index]

    @property
    def area(self) -> int:
        return int(self.bbox[2]) * int(self.bbox[3])

    def as_yunet_row(self) -> np.ndarray:
        x, y, w, h = self.bbox
        row = np.zeros((15,), dtype=np.float32)
        row[:4] = [x, y, w, h]
        if self.landmarks is not None and self.landmarks.size >= 10:
            row[4:14] = self.landmarks.reshape(-1)[:10]
        row[14] = float(self.score)
        return row


class YuNetFaceDetector:
    def __init__(
        self,
        model_path: str = config.face_detection_model_path,
        score_threshold: float = config.yunet_score_threshold,
        nms_threshold: float = config.yunet_nms_threshold,
        top_k: int = config.yunet_top_k,
    ):
        self.model_path = str(model_path)
        self.score_threshold = float(score_threshold)
        self.nms_threshold = float(nms_threshold)
        self.top_k = int(top_k)
        self._input_size: Optional[tuple[int, int]] = None
        self.detector = None

        if Path(self.model_path).exists() and hasattr(cv2, "FaceDetectorYN_create"):
            self.detector = cv2.FaceDetectorYN_create(
                self.model_path,
                "",
                (int(config.frame_width), int(config.frame_height)),
                self.score_threshold,
                self.nms_threshold,
                self.top_k,
            )

    @property
    def available(self) -> bool:
        return self.detector is not None

    def _ensure_input_size(self, width: int, height: int) -> None:
        size = (int(width), int(height))
        if self._input_size == size:
            return
        self._input_size = size
        set_input_size = getattr(self.detector, "setInputSize", None)
        if callable(set_input_size):
            set_input_size(size)

    @staticmethod
    def _to_bgr(frame: np.ndarray) -> np.ndarray:
        if frame.ndim == 2:
            return cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
        return frame

    @staticmethod
    def _row_to_detection(row: np.ndarray, width: int, height: int) -> Optional[FaceDetection]:
        values = np.asarray(row, dtype=np.float32).reshape(-1)
        if values.size < 5:
            return None

        x, y, w, h = [int(round(float(v))) for v in values[:4]]
        x = max(0, min(x, max(0, width - 1)))
        y = max(0, min(y, max(0, height - 1)))
        w = max(1, min(w, max(1, width - x)))
        h = max(1, min(h, max(1, height - y)))
        score = round(float(values[14]), 6) if values.size >= 15 else 0.0

        landmarks = None
        if values.size >= 14:
            landmarks = values[4:14].reshape(5, 2).astype(np.float32)

        return FaceDetection(bbox=(x, y, w, h), landmarks=landmarks, score=score)

    def detect(self, frame: np.ndarray, params: Optional[dict[str, Any]] = None) -> list[FaceDetection]:
        if self.detector is None or frame is None:
            return []

        bgr = self._to_bgr(frame)
        height, width = bgr.shape[:2]
        self._ensure_input_size(width, height)

        _retval, faces = self.detector.detect(bgr)
        if faces is None:
            return []

        detections: list[FaceDetection] = []
        for row in np.asarray(faces):
            detection = self._row_to_detection(row, width, height)
            if detection is not None:
                detections.append(detection)
        return detections


class HaarFaceDetector:
    def __init__(self):
        cascade_path = cv2.data.haarcascades + config.cascade_filename
        self.classifier = cv2.CascadeClassifier(cascade_path)

    def detect(self, gray_image, params: dict[str, Any]):
        scale_factor = float(params.get("scaleFactor", config.detect_scale_factor))
        min_neighbors = int(params.get("minNeighbors", config.detect_min_neighbors))
        min_size = params.get("minSize", [config.detect_min_size_w, config.detect_min_size_h])
        min_size_tuple = (int(min_size[0]), int(min_size[1]))
        downscale = float(params.get("downscale", config.detect_downscale))

        if 0.0 < downscale < 1.0:
            reduced = cv2.resize(
                gray_image,
                (0, 0),
                fx=downscale,
                fy=downscale,
                interpolation=cv2.INTER_LINEAR,
            )
            min_size_reduced = (
                max(1, int(min_size_tuple[0] * downscale)),
                max(1, int(min_size_tuple[1] * downscale)),
            )
            faces_reduced = self.classifier.detectMultiScale(
                reduced,
                scaleFactor=scale_factor,
                minNeighbors=min_neighbors,
                minSize=min_size_reduced,
            )
            if len(faces_reduced) == 0:
                return faces_reduced

            inv = 1.0 / downscale
            height, width = gray_image.shape[:2]
            faces_scaled: list[tuple[int, int, int, int]] = []
            for face in faces_reduced:
                x, y, w, h = [int(v) for v in face]
                ox = max(0, int(round(x * inv)))
                oy = max(0, int(round(y * inv)))
                ow = max(1, int(round(w * inv)))
                oh = max(1, int(round(h * inv)))

                if ox >= width or oy >= height:
                    continue
                if ox + ow > width:
                    ow = width - ox
                if oy + oh > height:
                    oh = height - oy
                if ow <= 0 or oh <= 0:
                    continue
                faces_scaled.append((ox, oy, ow, oh))
            return faces_scaled

        return self.classifier.detectMultiScale(
            gray_image,
            scaleFactor=scale_factor,
            minNeighbors=min_neighbors,
            minSize=min_size_tuple,
        )


class InsightFaceDetector:
    """Face detector using SCRFD via InsightFace + ONNX Runtime.

    Far more robust than Haar cascades for faces with accessories
    (helmets, glasses, masks).  Accepts grayscale or BGR input.
    """

    def __init__(self, det_size: tuple[int, int] = (640, 480),
                 model_name: str = "buffalo_l"):
        if not _HAS_INSIGHTFACE:
            raise ImportError(
                "insightface is required for InsightFaceDetector. "
                "Install: pip install insightface onnxruntime"
            )
        self._app = FaceAnalysis(
            name=model_name,
            allowed_modules=["detection"],
            providers=["CPUExecutionProvider"],
        )
        self._app.prepare(ctx_id=-1, det_size=det_size)

    def detect(self, image: np.ndarray, params: dict[str, Any],
               ) -> list[tuple[int, int, int, int]]:
        min_size = params.get("minSize", [config.detect_min_size_w, config.detect_min_size_h])
        min_w, min_h = int(min_size[0]), int(min_size[1])

        if len(image.shape) == 2:
            bgr = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
        else:
            bgr = image

        raw_faces = self._app.get(bgr)

        faces: list[tuple[int, int, int, int]] = []
        img_h, img_w = image.shape[:2]
        for face in raw_faces:
            bbox = face.bbox.astype(int)
            x = max(0, int(bbox[0]))
            y = max(0, int(bbox[1]))
            x2 = min(img_w, int(bbox[2]))
            y2 = min(img_h, int(bbox[3]))
            w = x2 - x
            h = y2 - y
            if w >= min_w and h >= min_h:
                faces.append((x, y, w, h))
        return faces
