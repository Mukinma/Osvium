from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import TYPE_CHECKING, Optional

import cv2
import numpy as np

from config import config
from vision.detector import FaceDetection

if TYPE_CHECKING:
    from vision.secure_storage import SecureStorage


def _l2_normalize(vector: np.ndarray) -> np.ndarray:
    flat = np.asarray(vector, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(flat))
    if norm <= 1e-12:
        return flat
    return flat / norm


class SFaceRecognizer:
    recognition_metric = "cosine_similarity"
    preprocess_mode = config.sface_preprocess_mode

    def __init__(
        self,
        model_path: str = config.face_recognition_model_path,
        embedding_path: str = config.model_path,
    ):
        self.model_path = str(model_path)
        self.embedding_path = str(embedding_path)
        self.recognizer = None
        self.user_ids = np.array([], dtype=np.int32)
        self.embeddings = np.empty((0, 0), dtype=np.float32)
        self.sample_counts: dict[int, int] = {}
        self.loaded = False
        self._ensure_recognizer()

    @property
    def model_loaded(self) -> bool:
        return self.recognizer is not None

    def _ensure_recognizer(self) -> bool:
        if self.recognizer is not None:
            return True
        if not Path(self.model_path).exists() or not hasattr(cv2, "FaceRecognizerSF_create"):
            return False
        self.recognizer = cv2.FaceRecognizerSF_create(self.model_path, "")
        return True

    @staticmethod
    def _to_bgr(image: np.ndarray) -> np.ndarray:
        if image.ndim == 2:
            return cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
        return image

    @staticmethod
    def _bbox_tuple(face) -> tuple[int, int, int, int]:
        if isinstance(face, FaceDetection):
            return face.bbox
        return tuple(int(v) for v in face[:4])

    @staticmethod
    def _fallback_crop(frame: np.ndarray, face) -> Optional[np.ndarray]:
        x, y, w, h = SFaceRecognizer._bbox_tuple(face)
        height, width = frame.shape[:2]
        x = max(0, min(x, width - 1))
        y = max(0, min(y, height - 1))
        w = max(1, min(w, width - x))
        h = max(1, min(h, height - y))
        crop = frame[y : y + h, x : x + w]
        if crop.size == 0:
            return None
        return cv2.resize(crop, (112, 112))

    def align_crop(self, frame: np.ndarray, face) -> Optional[np.ndarray]:
        bgr = self._to_bgr(frame)
        if not self._ensure_recognizer():
            return self._fallback_crop(bgr, face)

        if isinstance(face, FaceDetection) and face.landmarks is not None:
            try:
                aligned = self.recognizer.alignCrop(bgr, face.as_yunet_row())
                if aligned is not None and aligned.size:
                    return aligned
            except Exception:
                pass
        return self._fallback_crop(bgr, face)

    def extract_feature(self, image: np.ndarray) -> np.ndarray:
        if not self._ensure_recognizer():
            raise RuntimeError("Modelo SFace no disponible")
        bgr = self._to_bgr(image)
        if bgr.shape[0] != 112 or bgr.shape[1] != 112:
            bgr = cv2.resize(bgr, (112, 112))
        feature = self.recognizer.feature(np.ascontiguousarray(bgr))
        return _l2_normalize(feature)

    def train(self, images: list[np.ndarray], labels: list[int]) -> None:
        if not images or not labels:
            raise ValueError("No hay datos de entrenamiento")
        if len(images) != len(labels):
            raise ValueError("Imágenes y etiquetas no coinciden")

        grouped: dict[int, list[np.ndarray]] = {}
        for image, label in zip(images, labels):
            feature = self.extract_feature(image)
            grouped.setdefault(int(label), []).append(feature)

        user_ids: list[int] = []
        centroids: list[np.ndarray] = []
        sample_counts: dict[int, int] = {}
        for user_id in sorted(grouped):
            samples = grouped[user_id]
            centroid = _l2_normalize(np.mean(np.vstack(samples), axis=0))
            user_ids.append(user_id)
            centroids.append(centroid)
            sample_counts[user_id] = len(samples)

        self.user_ids = np.asarray(user_ids, dtype=np.int32)
        self.embeddings = np.vstack(centroids).astype(np.float32)
        self.sample_counts = sample_counts
        self.loaded = len(user_ids) > 0

    def save_model(
        self,
        path: Optional[str] = None,
        store: "Optional[SecureStorage]" = None,
    ) -> None:
        if not self.loaded or self.embeddings.size == 0:
            raise ValueError("No hay embeddings para guardar")
        index_path = Path(path or self.embedding_path)
        index_path.parent.mkdir(parents=True, exist_ok=True)
        counts = np.asarray([self.sample_counts.get(int(uid), 0) for uid in self.user_ids], dtype=np.int32)
        np.savez(
            index_path,
            user_ids=self.user_ids.astype(np.int32),
            embeddings=self.embeddings.astype(np.float32),
            sample_counts=counts,
            metric=np.asarray([self.recognition_metric]),
            preprocess_mode=np.asarray([self.preprocess_mode]),
        )
        if store is not None and getattr(store, "enabled", False):
            store.encrypt_file(index_path)
        self.embedding_path = str(index_path)
        self.loaded = True

    def _load_npz(self, path: Path, store: "Optional[SecureStorage]" = None):
        if store is not None and getattr(store, "enabled", False):
            data = store.decrypt_file(path)
            return np.load(BytesIO(data), allow_pickle=False)
        return np.load(path, allow_pickle=False)

    def load_model(
        self,
        path: Optional[str] = None,
        store: "Optional[SecureStorage]" = None,
    ) -> bool:
        if not self._ensure_recognizer():
            self.loaded = False
            return False
        index_path = Path(path or self.embedding_path)
        if not index_path.exists():
            self.loaded = False
            return False
        with self._load_npz(index_path, store) as data:
            stored_mode = str(data["preprocess_mode"][0]) if "preprocess_mode" in data else ""
            if stored_mode != self.preprocess_mode:
                self.loaded = False
                return False
            self.user_ids = data["user_ids"].astype(np.int32)
            self.embeddings = data["embeddings"].astype(np.float32)
            counts = data["sample_counts"].astype(np.int32) if "sample_counts" in data else np.ones_like(self.user_ids)
        self.sample_counts = {int(uid): int(count) for uid, count in zip(self.user_ids, counts)}
        self.embedding_path = str(index_path)
        self.loaded = self.user_ids.size > 0 and self.embeddings.size > 0
        return self.loaded

    def predict(self, face_image) -> tuple[Optional[int], Optional[float]]:
        if not self.loaded or self.user_ids.size == 0 or self.embeddings.size == 0:
            return None, None
        feature = _l2_normalize(face_image) if getattr(face_image, "ndim", 0) == 1 else self.extract_feature(face_image)
        scores = self.embeddings @ feature.reshape(-1)
        if scores.size == 0:
            return None, None
        idx = int(np.argmax(scores))
        score = max(0.0, min(100.0, float(scores[idx]) * 100.0))
        return int(self.user_ids[idx]), round(score, 4)


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

    def load_model(self, path: str = config.legacy_lbph_model_path,
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

    def save_model(self, path: str = config.legacy_lbph_model_path,
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

    def predict(self, face_200x200_gray) -> tuple[Optional[int], Optional[float]]:
        if not self.loaded:
            return None, None
        label, confidence = self.recognizer.predict(face_200x200_gray)
        return int(label), float(confidence)
