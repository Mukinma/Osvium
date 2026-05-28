from pathlib import Path

import cv2

from config import config
from database.db import db
from vision.recognizer import SFaceRecognizer
from vision.secure_storage import storage as _storage


class FaceTrainer:
    def __init__(self, recognizer: SFaceRecognizer):
        self.recognizer = recognizer

    def train_from_dataset(self) -> dict:
        samples = db.list_samples(preprocess_mode=config.sface_preprocess_mode)
        images = []
        labels = []
        variants = []

        for sample in samples:
            path = Path(sample["imagen_ref"])
            if not path.exists():
                continue
            image = _storage.read_image(path, flags=cv2.IMREAD_COLOR)
            if image is None:
                continue
            image = cv2.resize(image, (112, 112))
            images.append(image)
            labels.append(int(sample["usuario_id"]))
            variants.append(str(sample.get("appearance_variant") or "normal"))

        if not images:
            raise ValueError("Recaptura requerida: no hay muestras SFace limpias para entrenar")

        self.recognizer.train(images, labels, variants=variants)
        self.recognizer.save_model(config.model_path, _storage)

        return {
            "samples_used": len(images),
            "unique_users": len(set(labels)),
            "model_path": config.model_path,
        }
