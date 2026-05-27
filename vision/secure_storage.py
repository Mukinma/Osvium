"""Transparent AES-128-CBC + HMAC-SHA256 encryption for biometric data at rest.

Provides drop-in replacements for cv2.imwrite / cv2.imread and for
LBPHRecognizer.save_model / load_model.  When storage_encrypted is False every
call degrades to the plain-file equivalent — no performance cost, no behaviour
change.

Key derivation
--------------
HKDF-SHA256(ikm=CAMERAPI_SECRET, salt=b"vireom-biometric-v1", info=b"storage")
→ 32 bytes → base64url → Fernet key (AES-128-CBC + HMAC-SHA256, 256 bits total)

The derived key is kept in memory only.  No key material is written to disk.

Encrypted files are standard Fernet tokens (version byte + timestamp + IV +
ciphertext + HMAC).  The .jpg / .xml extensions are kept so the dataset
directory structure remains unchanged and gitignore rules still apply.

Usage
-----
    from vision.secure_storage import storage

    # Write
    storage.write_image(path, gray_or_bgr_ndarray)

    # Read
    img = storage.read_image(path, flags=cv2.IMREAD_GRAYSCALE)

    # Model (wraps recognizer.write / recognizer.read transparently)
    storage.save_model(recognizer, model_path)
    storage.load_model(recognizer, model_path)  # returns bool
"""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

from config import AppConfig, config as _global_config

logger = logging.getLogger("camerapi.secure_storage")

_SALT = b"vireom-biometric-v1"
_INFO = b"storage"


class SecureStorage:
    """Thread-safe encrypted file I/O for biometric data."""

    def __init__(self, cfg: AppConfig) -> None:
        self._enabled = cfg.storage_encrypted
        self._cfg = cfg
        self._fernet: Optional[object] = None  # lazy-init

        if self._enabled:
            if not cfg.secret_key:
                raise RuntimeError(
                    "CAMERAPI_STORAGE_ENCRYPTED=1 requires a non-empty "
                    "CAMERAPI_SECRET.  Set it in .env before enabling encryption."
                )
            self._fernet = self._derive_fernet(cfg.secret_key)
            logger.info("SecureStorage: encrypted mode active (Fernet/AES-128-CBC)")
        else:
            logger.info("SecureStorage: plain mode (CAMERAPI_STORAGE_ENCRYPTED=0)")

    # ── Public API ────────────────────────────────────────────────────────────

    def write_image(self, path: Path, image: np.ndarray) -> bool:
        """Encode image as JPEG and write (optionally encrypted) to path.

        Replaces cv2.imwrite.  Returns True on success.
        """
        ok, buf = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 95])
        if not ok:
            logger.error("secure_storage write_image imencode failed: %s", path)
            return False
        data = buf.tobytes()
        if self._enabled:
            data = self._fernet.encrypt(data)
        path.write_bytes(data)
        return True

    def read_image(self, path: Path, flags: int = cv2.IMREAD_GRAYSCALE) -> Optional[np.ndarray]:
        """Read (optionally decrypt) image from path and decode.

        Replaces cv2.imread.  Returns None on any failure.
        """
        if not path.exists():
            return None
        try:
            data = path.read_bytes()
            if self._enabled:
                data = self._fernet.decrypt(data)
            buf = np.frombuffer(data, dtype=np.uint8)
            return cv2.imdecode(buf, flags)
        except Exception:
            logger.exception("secure_storage read_image failed: %s", path)
            return None

    def save_model(self, recognizer_obj, model_path: str) -> None:
        """Write LBPH model to disk, then encrypt in-place if enabled.

        recognizer_obj must expose a .write(path: str) method (cv2 LBPH).
        """
        path = Path(model_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        recognizer_obj.write(model_path)
        if self._enabled:
            plain = path.read_bytes()
            path.write_bytes(self._fernet.encrypt(plain))
            logger.debug("secure_storage model encrypted: %s", path)

    def load_model(self, recognizer_obj, model_path: str) -> bool:
        """Decrypt (if needed) LBPH model and load it into recognizer_obj.

        Returns True on success, False if file does not exist.
        """
        path = Path(model_path)
        if not path.exists():
            return False
        if not self._enabled:
            recognizer_obj.read(model_path)
            return True
        # Decrypt to a temporary file, read, then delete it.
        try:
            cipher_bytes = path.read_bytes()
            plain_bytes = self._fernet.decrypt(cipher_bytes)
            with tempfile.NamedTemporaryFile(
                suffix=".xml", delete=False, prefix="vireom_model_"
            ) as tmp:
                tmp.write(plain_bytes)
                tmp_path = tmp.name
            try:
                recognizer_obj.read(tmp_path)
            finally:
                Path(tmp_path).unlink(missing_ok=True)
            logger.debug("secure_storage model decrypted and loaded: %s", path)
            return True
        except Exception:
            logger.exception("secure_storage load_model failed: %s", path)
            return False

    def write_data(self, path: Path, data: bytes) -> None:
        """Write raw bytes to disk, encrypting if enabled."""
        if self._enabled:
            data = self._fernet.encrypt(data)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def read_data(self, path: Path) -> Optional[bytes]:
        """Read raw bytes from disk, decrypting if enabled. None if missing."""
        if not path.exists():
            return None
        try:
            data = path.read_bytes()
            if self._enabled:
                data = self._fernet.decrypt(data)
            return data
        except Exception:
            logger.exception("secure_storage read_data failed: %s", path)
            return None

    def encrypt_file(self, path: Path) -> None:
        """Encrypt an existing plain-text file in-place (migration use)."""
        if not self._enabled:
            raise RuntimeError("Encryption not enabled")
        plain = path.read_bytes()
        path.write_bytes(self._fernet.encrypt(plain))

    def decrypt_file(self, path: Path) -> bytes:
        """Return decrypted bytes of an encrypted file (migration use)."""
        if not self._enabled:
            return path.read_bytes()
        return self._fernet.decrypt(path.read_bytes())

    @property
    def enabled(self) -> bool:
        return self._enabled

    # ── Key derivation ────────────────────────────────────────────────────────

    @staticmethod
    def _derive_fernet(secret: str):
        import base64
        from cryptography.fernet import Fernet
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.kdf.hkdf import HKDF

        raw_key = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=_SALT,
            info=_INFO,
        ).derive(secret.encode())
        fernet_key = base64.urlsafe_b64encode(raw_key)
        return Fernet(fernet_key)


# Module-level singleton — imported by enrollment, trainer, recognizer, main
storage = SecureStorage(_global_config)
