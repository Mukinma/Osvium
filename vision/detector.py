from typing import Any

import cv2
import numpy as np

from config import config

try:
    from insightface.app import FaceAnalysis
    _HAS_INSIGHTFACE = True
except ImportError:
    _HAS_INSIGHTFACE = False


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
