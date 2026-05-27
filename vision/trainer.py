from pathlib import Path
from typing import Union

import cv2

from config import config
from database.db import db
from vision.recognizer import LBPHRecognizer

try:
    from vision.recognizer import InsightFaceRecognizer
except ImportError:
    InsightFaceRecognizer = None  # type: ignore[assignment,misc]

from vision.secure_storage import storage as _storage


class FaceTrainer:
    def __init__(self, recognizer: Union["LBPHRecognizer", "InsightFaceRecognizer"]):
        self.recognizer = recognizer

    def train_from_dataset(self) -> dict:
        samples = db.list_samples()
        images = []
        labels = []

        for sample in samples:
            path = Path(sample["imagen_ref"])
            if not path.exists():
                continue
            image = _storage.read_image(path, flags=cv2.IMREAD_GRAYSCALE)
            if image is None:
                continue
            image = cv2.resize(image, (200, 200))
            images.append(image)
            labels.append(int(sample["usuario_id"]))

        if not images:
            raise ValueError("No hay muestras válidas para entrenar")

        self.recognizer.train(images, labels)
        self.recognizer.save_model(config.model_path, _storage)

        return {
            "samples_used": len(images),
            "unique_users": len(set(labels)),
            "model_path": config.model_path,
        }
