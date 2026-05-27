import time
from typing import Any, Optional


class FaceGuidanceEngine:
    """Maquina de estados para detectar una sola persona sin marco fijo."""

    TARGET_CX = 0.50
    TARGET_CY = 0.42
    TARGET_W = 0.28
    TARGET_H = 0.38

    ALIGN_OFFSET_X = 0.08
    ALIGN_OFFSET_Y = 0.10
    ALIGN_SCALE_MIN = 0.65
    ALIGN_SCALE_MAX = 1.45

    HYSTERESIS_OFFSET_X = 0.11
    HYSTERESIS_OFFSET_Y = 0.13
    HYSTERESIS_SCALE_MIN = 0.55
    HYSTERESIS_SCALE_MAX = 1.60

    STEADY_WINDOW_MS = 800
    HOLD_THRESHOLD_MS = 300
    STABILITY_EMA_ALPHA = 0.30
    MAX_STABLE_JITTER = 0.025

    POSITION_EMA_ALPHA = 0.35

    DIR_THRESHOLD_X = 0.06
    DIR_THRESHOLD_Y = 0.06
    SCALE_TOO_CLOSE = 1.35
    SCALE_TOO_FAR = 0.70

    LOST_GRACE_MS = 800

    STATES = frozenset({
        "idle", "searching", "detected_misaligned", "aligned",
        "hold_steady", "ready", "capture_in_progress", "lost", "error",
    })

    def __init__(self):
        self._state: str = "idle"
        self._prev_state: str = "idle"

        self._smooth_cx: Optional[float] = None
        self._smooth_cy: Optional[float] = None
        self._smooth_w: Optional[float] = None
        self._smooth_h: Optional[float] = None

        self._prev_cx: Optional[float] = None
        self._prev_cy: Optional[float] = None
        self._stability_score: float = 0.0

        self._aligned_since_ms: Optional[float] = None
        self._last_face_seen_ms: float = 0.0

        self._faces_count: int = 0

    def _ema(self, prev: Optional[float], current: float, alpha: float) -> float:
        if prev is None:
            return current
        return alpha * current + (1.0 - alpha) * prev

    def _now_ms(self) -> float:
        return time.time() * 1000.0

    def _compute_offsets(self) -> tuple[float, float, float]:
        if self._smooth_cx is None or self._smooth_w is None:
            return 0.0, 0.0, 0.0
        offset_x = self._smooth_cx - self.TARGET_CX
        offset_y = self._smooth_cy - self.TARGET_CY
        scale_ratio = self._smooth_w / max(0.01, self.TARGET_W)
        return offset_x, offset_y, scale_ratio

    def _is_within_align(self, ox: float, oy: float, sr: float) -> bool:
        return (
            abs(ox) <= self.ALIGN_OFFSET_X
            and abs(oy) <= self.ALIGN_OFFSET_Y
            and self.ALIGN_SCALE_MIN <= sr <= self.ALIGN_SCALE_MAX
        )

    def _is_within_hysteresis(self, ox: float, oy: float, sr: float) -> bool:
        return (
            abs(ox) <= self.HYSTERESIS_OFFSET_X
            and abs(oy) <= self.HYSTERESIS_OFFSET_Y
            and self.HYSTERESIS_SCALE_MIN <= sr <= self.HYSTERESIS_SCALE_MAX
        )

    def _compute_stability(self, cx: float, cy: float) -> float:
        if self._prev_cx is None:
            self._prev_cx = cx
            self._prev_cy = cy
            return 0.0
        jitter = abs(cx - self._prev_cx) + abs(cy - self._prev_cy)
        self._prev_cx = cx
        self._prev_cy = cy
        is_stable = 1.0 if jitter < self.MAX_STABLE_JITTER else 0.0
        self._stability_score = self._ema(
            self._stability_score, is_stable, self.STABILITY_EMA_ALPHA
        )
        return self._stability_score

    def _direction_message(self, ox: float, oy: float, sr: float) -> str:
        if sr > self.SCALE_TOO_CLOSE:
            return "Aléjate un poco"
        if sr < self.SCALE_TOO_FAR:
            return "Acércate un poco"
        if ox < -self.DIR_THRESHOLD_X:
            return "Muévete a la derecha"
        if ox > self.DIR_THRESHOLD_X:
            return "Muévete a la izquierda"
        if oy < -self.DIR_THRESHOLD_Y:
            return "Baja ligeramente la cabeza"
        if oy > self.DIR_THRESHOLD_Y:
            return "Sube ligeramente la cabeza"
        return "Ajusta tu posición"

    def _transition(self, new_state: str) -> None:
        if new_state != self._state:
            self._prev_state = self._state
            self._state = new_state

    def update(
        self,
        face_detected: bool,
        face_bbox: Optional[dict],
        faces_count: int,
        camera_ok: bool,
        model_loaded: bool,
    ) -> dict[str, Any]:
        now = self._now_ms()
        self._faces_count = faces_count

        if not camera_ok:
            self._reset_tracking()
            self._transition("error")
            return self._build("Cámara no disponible")

        if not model_loaded:
            self._reset_tracking()
            self._transition("idle")
            return self._build("Sistema preparandose")

        if faces_count > 1:
            self._reset_tracking()
            self._transition("detected_misaligned")
            return self._build("Debe salir la otra persona")

        if not face_detected or face_bbox is None:
            elapsed_since_face = now - self._last_face_seen_ms
            if self._state in ("aligned", "hold_steady", "ready", "detected_misaligned"):
                if elapsed_since_face < self.LOST_GRACE_MS:
                    self._transition("lost")
                    return self._build("Rostro no visible")
                self._reset_tracking()
                self._transition("searching")
                return self._build("Buscando rostro…")
            if self._state == "lost":
                if elapsed_since_face >= self.LOST_GRACE_MS:
                    self._reset_tracking()
                    self._transition("searching")
                    return self._build("Buscando rostro…")
                return self._build("Rostro no visible")
            self._transition("searching")
            return self._build("Buscando rostro…")

        self._last_face_seen_ms = now
        raw_cx = face_bbox["x"] + face_bbox["w"] / 2.0
        raw_cy = face_bbox["y"] + face_bbox["h"] / 2.0
        raw_w = face_bbox["w"]
        raw_h = face_bbox["h"]

        self._smooth_cx = self._ema(self._smooth_cx, raw_cx, self.POSITION_EMA_ALPHA)
        self._smooth_cy = self._ema(self._smooth_cy, raw_cy, self.POSITION_EMA_ALPHA)
        self._smooth_w = self._ema(self._smooth_w, raw_w, self.POSITION_EMA_ALPHA)
        self._smooth_h = self._ema(self._smooth_h, raw_h, self.POSITION_EMA_ALPHA)

        ox, oy, sr = self._compute_offsets()
        stability = self._compute_stability(self._smooth_cx, self._smooth_cy)
        if self._aligned_since_ms is None:
            self._aligned_since_ms = now
        self._transition("ready")
        return self._build("Rostro detectado", ox, oy, sr, stability)

    def set_capturing(self) -> None:
        self._transition("capture_in_progress")

    def _reset_tracking(self) -> None:
        self._smooth_cx = None
        self._smooth_cy = None
        self._smooth_w = None
        self._smooth_h = None
        self._prev_cx = None
        self._prev_cy = None
        self._stability_score = 0.0
        self._aligned_since_ms = None

    def _build(
        self,
        message: str,
        ox: float = 0.0,
        oy: float = 0.0,
        sr: float = 0.0,
        stability: float = 0.0,
    ) -> dict[str, Any]:
        now = self._now_ms()
        steady_ms = 0
        if self._aligned_since_ms is not None:
            steady_ms = int(now - self._aligned_since_ms)
        is_aligned = self._state in ("aligned", "hold_steady", "ready")
        is_stable = self._state in ("hold_steady", "ready")
        return {
            "state": self._state,
            "message": message,
            "is_aligned": is_aligned,
            "is_stable": is_stable,
            "ready": self._state == "ready",
            "faces_count": self._faces_count,
            "offset_x": round(ox, 4),
            "offset_y": round(oy, 4),
            "scale_ratio": round(sr, 3),
            "stability_score": round(stability, 3),
            "steady_ms": steady_ms,
        }
