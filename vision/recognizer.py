import logging
import pickle
from pathlib import Path
from typing import TYPE_CHECKING, Optional

import cv2
import numpy as np

from config import config

if TYPE_CHECKING:
    from vision.secure_storage import SecureStorage

try:
    from insightface.app import FaceAnalysis
    _HAS_INSIGHTFACE = True
except ImportError:
    _HAS_INSIGHTFACE = False

logger = logging.getLogger("camerapi.recognizer")


class LBPHRecognizer:
    def __init__(self):
        self.recognizer = cv2.face.LBPHFaceRecognizer_create(
            radius=config.lbph_radius,
            neighbors=config.lbph_neighbors,
            grid_x=config.lbph_grid_x,
            grid_y=config.lbph_grid_y,
        )
        self.loaded = False

    def configure(self, radius: int, neighbors: int, grid_x: int, grid_y: int) -> None:
        self.recognizer = cv2.face.LBPHFaceRecognizer_create(
            radius=radius,
            neighbors=neighbors,
            grid_x=grid_x,
            grid_y=grid_y,
        )
        self.loaded = False

    def load_model(self, path: str = config.model_path,
                   store: "Optional[SecureStorage]" = None) -> bool:
        if store is not None:
            ok = store.load_model(self.recognizer, path)
            self.loaded = ok
            return ok
        model_file = Path(path)
        if not model_file.exists():
            self.loaded = False
            return False
        self.recognizer.read(path)
        self.loaded = True
        return True

    def save_model(self, path: str = config.model_path,
                   store: "Optional[SecureStorage]" = None) -> None:
        if store is not None:
            store.save_model(self.recognizer, path)
            self.loaded = True
            return
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.recognizer.write(path)
        self.loaded = True

    def train(self, images: list[np.ndarray], labels: list[int]) -> None:
        if not images or not labels:
            raise ValueError("No hay datos de entrenamiento")
        self.recognizer.train(images, np.array(labels))
        self.loaded = True

    def predict(self, face_200x200_gray, **_kwargs) -> tuple[Optional[int], Optional[float]]:
        if not self.loaded:
            return None, None
        label, confidence = self.recognizer.predict(face_200x200_gray)
        return int(label), float(confidence)


class InsightFaceRecognizer:
    """Face recognizer using ArcFace embeddings via InsightFace + ONNX Runtime.

    Stores 512-dimensional face embeddings per user.  Recognition is done
    by computing the cosine similarity between an unknown face and all
    stored embeddings, returning the closest match.

    Confidence is reported as ``(1 - similarity) * 100`` so it maps to
    the existing 0-100 threshold system (lower = better match).
    """

    def __init__(self, det_size: tuple[int, int] = (640, 480),
                 model_name: str = "buffalo_l"):
        if not _HAS_INSIGHTFACE:
            raise ImportError(
                "insightface is required for InsightFaceRecognizer. "
                "Install: pip install insightface onnxruntime"
            )
        self._app = FaceAnalysis(
            name=model_name,
            allowed_modules=["detection", "recognition"],
            providers=["CPUExecutionProvider"],
        )
        self._app.prepare(ctx_id=-1, det_size=det_size)
        self._known_embeddings: list[np.ndarray] = []
        self._known_labels: list[int] = []
        self.loaded = False

    def load_model(self, path: str = config.model_path,
                   store: "Optional[SecureStorage]" = None) -> bool:
        model_file = Path(path)
        if not model_file.exists():
            self.loaded = False
            return False
        try:
            if store is not None:
                raw = store.read_data(model_file)
                if raw is None:
                    self.loaded = False
                    return False
            else:
                raw = model_file.read_bytes()
            model_data = pickle.loads(raw)
            self._known_embeddings = model_data.get("embeddings", [])
            self._known_labels = model_data.get("labels", [])
            self.loaded = len(self._known_embeddings) > 0
            logger.info("insightface_model_loaded embeddings=%d users=%d",
                        len(self._known_embeddings), len(set(self._known_labels)))
            return self.loaded
        except Exception:
            logger.exception("insightface_model_load_failed path=%s", path)
            self.loaded = False
            return False

    def save_model(self, path: str = config.model_path,
                   store: "Optional[SecureStorage]" = None) -> None:
        model_data = {
            "embeddings": self._known_embeddings,
            "labels": self._known_labels,
            "version": 2,
        }
        raw = pickle.dumps(model_data, protocol=pickle.HIGHEST_PROTOCOL)
        path_obj = Path(path)
        path_obj.parent.mkdir(parents=True, exist_ok=True)
        if store is not None:
            store.write_data(path_obj, raw)
        else:
            path_obj.write_bytes(raw)
        self.loaded = len(self._known_embeddings) > 0

    def train(self, images: list[np.ndarray], labels: list[int]) -> None:
        if not images or not labels:
            raise ValueError("No hay datos de entrenamiento")
        self._known_embeddings = []
        self._known_labels = []
        skipped = 0
        for image, label in zip(images, labels):
            embedding = self._compute_embedding_from_crop(image)
            if embedding is not None:
                self._known_embeddings.append(embedding)
                self._known_labels.append(int(label))
            else:
                skipped += 1
        if not self._known_embeddings:
            raise ValueError(
                f"No se pudieron computar embeddings de ninguna muestra "
                f"({len(images)} imagenes, {skipped} omitidas)"
            )
        if skipped > 0:
            logger.warning("insightface_train_skipped samples=%d", skipped)
        self.loaded = True

    def predict(self, face_200x200_gray: Optional[np.ndarray] = None,
                frame: Optional[np.ndarray] = None,
                face_location: Optional[tuple[int, int, int, int]] = None,
                ) -> tuple[Optional[int], Optional[float]]:
        if not self.loaded or not self._known_embeddings:
            return None, None

        if frame is not None and face_location is not None:
            return self._predict_from_frame(frame, face_location)

        if face_200x200_gray is not None:
            return self._predict_from_roi(face_200x200_gray)

        return None, None

    def _compute_embedding_from_crop(self, image: np.ndarray,
                                     ) -> Optional[np.ndarray]:
        """Compute ArcFace embedding from a cropped face image."""
        if len(image.shape) == 2:
            bgr = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
        else:
            bgr = image
        bgr = cv2.resize(bgr, (200, 200))
        faces = self._app.get(bgr)
        if not faces:
            padded = cv2.copyMakeBorder(bgr, 40, 40, 40, 40,
                                        cv2.BORDER_CONSTANT, value=(0, 0, 0))
            faces = self._app.get(padded)
        if not faces:
            return None
        return faces[0].embedding

    def _predict_from_frame(self, frame_bgr: np.ndarray,
                            face_xywh: tuple[int, int, int, int],
                            ) -> tuple[Optional[int], Optional[float]]:
        x, y, w, h = [int(v) for v in face_xywh]
        pad = int(max(w, h) * 0.3)
        fh, fw = frame_bgr.shape[:2]
        x1 = max(0, x - pad)
        y1 = max(0, y - pad)
        x2 = min(fw, x + w + pad)
        y2 = min(fh, y + h + pad)
        crop = frame_bgr[y1:y2, x1:x2]
        if crop.size == 0:
            return None, None

        faces = self._app.get(crop)
        if not faces:
            return None, None

        embedding = faces[0].embedding
        return self._match(embedding)

    def _predict_from_roi(self, roi_gray: np.ndarray,
                          ) -> tuple[Optional[int], Optional[float]]:
        embedding = self._compute_embedding_from_crop(roi_gray)
        if embedding is None:
            return None, None
        return self._match(embedding)

    def _match(self, embedding: np.ndarray,
               ) -> tuple[Optional[int], Optional[float]]:
        best_label = None
        best_sim = -1.0
        for known_emb, label in zip(self._known_embeddings, self._known_labels):
            sim = float(np.dot(embedding, known_emb) / (
                np.linalg.norm(embedding) * np.linalg.norm(known_emb) + 1e-8
            ))
            if sim > best_sim:
                best_sim = sim
                best_label = label
        if best_label is None:
            return None, None
        confidence = (1.0 - best_sim) * 100.0
        return best_label, confidence
