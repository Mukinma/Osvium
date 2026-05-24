"""Head pose heuristics using bbox geometry and profile Haar cascade.

No neural networks or ML models — only classical Haar cascades (already
bundled with OpenCV) and bounding-box arithmetic.
"""

from dataclasses import dataclass
from typing import Any, Optional

import cv2
import numpy as np


@dataclass
class PoseHints:
    """Deltas vs the center-step baseline + profile detection flags."""
    delta_cx: float = 0.0       # horizontal offset (normalized to frame width)
    delta_cy: float = 0.0       # vertical offset (normalized to frame height)
    delta_aspect: float = 0.0   # change in w/h ratio vs baseline
    delta_scale: float = 0.0    # change in area vs baseline
    profile_left: bool = False
    profile_right: bool = False
    frontal_detected: bool = False
    brightness: float = 128.0   # mean pixel value inside face ROI


# ── Step thresholds ────────────────────────────────────────────────
# Each key maps to a dict of constraints.  A step is "matched" when ALL
# constraints are satisfied simultaneously.
# Offset values are normalised to frame dimensions.

STEP_THRESHOLDS: dict[str, dict[str, Any]] = {
    "center": {
        "max_abs_offset_x": 0.15,
        "max_abs_offset_y": 0.18,
        "require_frontal": True,
    },
    "tilt_left": {
        "min_delta_cx": 0.02,
        "max_delta_cx": 0.18,
        "require_frontal": True,
    },
    "tilt_right": {
        "min_delta_cx": -0.18,
        "max_delta_cx": -0.02,
        "require_frontal": True,
    },
    "look_up": {
        "min_delta_cy": 0.02,
        "max_delta_cy": 0.18,
        "require_frontal": True,
    },
    "look_down": {
        "min_delta_cy": -0.18,
        "max_delta_cy": -0.02,
        "require_frontal": True,
    },
    "turn_left": {
        "min_delta_cx": 0.04,
        "require_profile_or_frontal": True,
    },
    "turn_right": {
        "max_delta_cx": -0.04,
        "require_profile_or_frontal": True,
    },
}


class PoseHeuristic:
    """Estimate head orientation using only bbox geometry and profile cascade."""

    def __init__(self) -> None:
        self.profile_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_profileface.xml"
        )
        self._baseline: Optional[dict[str, float]] = None

    # ── Baseline ───────────────────────────────────────────────────

    @property
    def has_baseline(self) -> bool:
        return self._baseline is not None

    def set_baseline(
        self,
        face: tuple[int, int, int, int],
        frame_shape: tuple[int, ...],
    ) -> None:
        x, y, w, h = face
        fw, fh = frame_shape[1], frame_shape[0]
        self._baseline = {
            "cx": (x + w / 2.0) / fw,
            "cy": (y + h / 2.0) / fh,
            "w": w / fw,
            "h": h / fh,
            "aspect": w / max(1, h),
            "area": (w * h) / (fw * fh),
        }

    def clear_baseline(self) -> None:
        self._baseline = None

    # ── Analysis ───────────────────────────────────────────────────

    def analyze(
        self,
        gray_frame: np.ndarray,
        face: Optional[tuple[int, int, int, int]],
        frame_shape: tuple[int, ...],
    ) -> PoseHints:
        fw, fh = frame_shape[1], frame_shape[0]
        hints = PoseHints()

        if face is not None:
            x, y, w, h = face
            hints.frontal_detected = True

            # Brightness of face ROI
            roi = gray_frame[y : y + h, x : x + w]
            if roi.size > 0:
                hints.brightness = float(np.mean(roi))

            if self._baseline is not None:
                cx_norm = (x + w / 2.0) / fw
                cy_norm = (y + h / 2.0) / fh
                hints.delta_cx = cx_norm - self._baseline["cx"]
                hints.delta_cy = cy_norm - self._baseline["cy"]
                cur_aspect = w / max(1, h)
                hints.delta_aspect = cur_aspect - self._baseline["aspect"]
                cur_area = (w * h) / (fw * fh)
                hints.delta_scale = (
                    (cur_area - self._baseline["area"]) / max(0.001, self._baseline["area"])
                )

        # Profile detection (always run so turn_left/right work even if frontal lost)
        hints.profile_left, hints.profile_right = self._detect_profiles(gray_frame)

        return hints

    def _detect_profiles(self, gray: np.ndarray) -> tuple[bool, bool]:
        """Return (profile_left, profile_right) using the profile cascade."""
        params = {
            "scaleFactor": 1.15,
            "minNeighbors": 4,
            "minSize": (80, 80),
        }
        # Profile cascade is trained for left-facing profiles.
        left_faces = self.profile_cascade.detectMultiScale(gray, **params)
        profile_left = len(left_faces) > 0

        # Flip horizontally to detect right-facing profiles.
        flipped = cv2.flip(gray, 1)
        right_faces = self.profile_cascade.detectMultiScale(flipped, **params)
        profile_right = len(right_faces) > 0

        return profile_left, profile_right

    # ── Step matching ──────────────────────────────────────────────

    def check_step(self, step_name: str, hints: PoseHints) -> tuple[bool, str]:
        """Check if *hints* match the expected pose for *step_name*.

        Returns (matched: bool, guidance_message: str).
        """
        thresholds = STEP_THRESHOLDS.get(step_name)
        if thresholds is None:
            return False, "Paso desconocido"

        # ── Center step (absolute offset, no baseline needed) ──────
        if step_name == "center":
            if not hints.frontal_detected:
                return False, "Coloca tu rostro frente a la camara"
            if self._baseline is None:
                return False, "Coloca tu rostro frente a la camara"
            # For center we check absolute offset from frame center
            abs_ox = abs(hints.delta_cx)
            abs_oy = abs(hints.delta_cy)
            max_x = thresholds["max_abs_offset_x"]
            max_y = thresholds["max_abs_offset_y"]
            if abs_ox > max_x or abs_oy > max_y:
                return False, self._direction_from_deltas(hints.delta_cx, hints.delta_cy)
            return True, "Perfecto, mantente quieto"

        # ── All other steps require baseline ───────────────────────
        if self._baseline is None:
            return False, "Completa primero la posicion central"

        # Check frontal requirement
        if thresholds.get("require_frontal") and not hints.frontal_detected:
            return False, "No se detecta tu rostro de frente"

        if thresholds.get("require_profile_or_frontal"):
            if not hints.frontal_detected and not hints.profile_left and not hints.profile_right:
                return False, "No se detecta tu rostro"

        # Check delta_cx range
        min_dcx = thresholds.get("min_delta_cx")
        max_dcx = thresholds.get("max_delta_cx")
        if min_dcx is not None and hints.delta_cx < min_dcx:
            return False, self._step_guidance(step_name)
        if max_dcx is not None and hints.delta_cx > max_dcx:
            return False, self._step_guidance(step_name)

        # Check delta_cy range
        min_dcy = thresholds.get("min_delta_cy")
        max_dcy = thresholds.get("max_delta_cy")
        if min_dcy is not None and hints.delta_cy < min_dcy:
            return False, self._step_guidance(step_name)
        if max_dcy is not None and hints.delta_cy > max_dcy:
            return False, self._step_guidance(step_name)

        return True, "Perfecto, mantente quieto"

    # ── Guidance helpers ───────────────────────────────────────────

    @staticmethod
    def _direction_from_deltas(dx: float, dy: float) -> str:
        if abs(dx) > abs(dy):
            return "Muevete a la derecha" if dx < 0 else "Muevete a la izquierda"
        return "Baja un poco" if dy < 0 else "Sube un poco"

    @staticmethod
    def _step_guidance(step_name: str) -> str:
        messages = {
            "tilt_left": "Inclina la cabeza hacia la izquierda",
            "tilt_right": "Inclina la cabeza hacia la derecha",
            "look_up": "Mira hacia arriba",
            "look_down": "Mira hacia abajo",
            "turn_left": "Gira la cabeza a la izquierda",
            "turn_right": "Gira la cabeza a la derecha",
        }
        return messages.get(step_name, "Sigue las instrucciones")

    @staticmethod
    def guidance_arrow(step_name: str) -> Optional[str]:
        """Return the direction arrow to show on the overlay, or None."""
        arrows = {
            "tilt_left": "left",
            "tilt_right": "right",
            "look_up": "up",
            "look_down": "down",
            "turn_left": "left",
            "turn_right": "right",
        }
        return arrows.get(step_name)
