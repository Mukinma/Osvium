import threading
import time
import logging


try:
    import RPi.GPIO as GPIO  # type: ignore
except Exception:
    GPIO = None


logger = logging.getLogger("camerapi.gpio")


# ── Servo door constants ──────────────────────────────────────────────────────
_SERVO_IZQ_GPIO = 18
_SERVO_DER_GPIO = 19

_IZQ_CERRADO = 45
_IZQ_ABIERTO = 135
_DER_CERRADO = 135
_DER_ABIERTO = 45

_PASO_GRADOS = 2
_TIEMPO_ENTRE_PASOS = 0.025
_TIEMPO_ESTABILIZACION = 0.45
_MIN_PULSE = 0.0008
_MAX_PULSE = 0.0022
_FRAME_WIDTH = 0.020


class RelayController:
    def __init__(self, pin: int = 18, active_high: bool = True):
        self.pin = pin
        self.active_high = active_high
        self.available = False
        self.initialized = False
        self.last_error = None
        if GPIO is not None:
            try:
                GPIO.setmode(GPIO.BCM)
                GPIO.setup(self.pin, GPIO.OUT)
                GPIO.output(self.pin, GPIO.LOW if active_high else GPIO.HIGH)
                self.available = True
                self.initialized = True
                logger.info("gpio_init_ok pin=%s", self.pin)
            except Exception as exc:
                self.available = False
                self.initialized = False
                self.last_error = str(exc)
                logger.exception("gpio_init_failed pin=%s", self.pin)
        else:
            logger.warning("gpio_module_unavailable mode=mock")

    def open_for(self, seconds: int) -> None:
        if not self.available:
            logger.error("gpio_open_skipped available=false")
            return
        threading.Thread(target=self._pulse, args=(seconds,), daemon=True).start()

    def _pulse(self, seconds: int) -> None:
        try:
            if self.active_high:
                GPIO.output(self.pin, GPIO.HIGH)
            else:
                GPIO.output(self.pin, GPIO.LOW)
            time.sleep(max(1, seconds))
            if self.active_high:
                GPIO.output(self.pin, GPIO.LOW)
            else:
                GPIO.output(self.pin, GPIO.HIGH)
            logger.info("gpio_pulse_ok duration=%s", seconds)
        except Exception as exc:
            self.last_error = str(exc)
            logger.exception("gpio_pulse_failed")

    def cleanup(self) -> None:
        if self.available:
            try:
                GPIO.cleanup()
                logger.info("gpio_cleanup_ok")
            except Exception:
                logger.exception("gpio_cleanup_failed")

    def is_healthy(self) -> bool:
        if GPIO is None:
            return False
        return bool(self.available and self.initialized)


class ServoController:
    """Double-servo door controller that replaces RelayController."""

    def __init__(self):
        self.available = False
        self.initialized = False
        self.last_error = None
        self._lock = threading.Lock()
        self._factory = None
        self._servo_izq = None
        self._servo_der = None
        self._izq_actual = _IZQ_CERRADO
        self._der_actual = _DER_CERRADO

        try:
            from gpiozero import AngularServo  # type: ignore
            from gpiozero.pins.lgpio import LGPIOFactory  # type: ignore

            factory = self._crear_factory(LGPIOFactory)
            self._factory = factory
            self._servo_izq = AngularServo(
                _SERVO_IZQ_GPIO,
                min_angle=0,
                max_angle=180,
                min_pulse_width=_MIN_PULSE,
                max_pulse_width=_MAX_PULSE,
                frame_width=_FRAME_WIDTH,
                initial_angle=None,
                pin_factory=factory,
            )
            self._servo_der = AngularServo(
                _SERVO_DER_GPIO,
                min_angle=0,
                max_angle=180,
                min_pulse_width=_MIN_PULSE,
                max_pulse_width=_MAX_PULSE,
                frame_width=_FRAME_WIDTH,
                initial_angle=None,
                pin_factory=factory,
            )
            # Ensure doors start closed
            self._mover_suave(_IZQ_CERRADO, _DER_CERRADO, _IZQ_CERRADO, _DER_CERRADO)
            self.available = True
            self.initialized = True
            logger.info("servo_init_ok gpio_izq=%s gpio_der=%s", _SERVO_IZQ_GPIO, _SERVO_DER_GPIO)
        except Exception as exc:
            self.last_error = str(exc)
            logger.warning("servo_init_failed error=%s mode=mock", exc)

    @staticmethod
    def _crear_factory(LGPIOFactory):
        for chip in (4, None):
            try:
                factory = LGPIOFactory(chip=chip) if chip is not None else LGPIOFactory()
                logger.info("lgpio_init_ok chip=%s", chip if chip is not None else "default")
                return factory
            except Exception as exc:
                logger.debug("lgpio_chip_failed chip=%s error=%s", chip, exc)
        raise RuntimeError("No se pudo inicializar LGPIOFactory")

    @staticmethod
    def _limitar(angulo: float) -> int:
        return max(0, min(180, int(angulo)))

    def _mover_suave(self, izq_from: int, der_from: int, izq_to: int, der_to: int) -> None:
        dist = max(abs(izq_to - izq_from), abs(der_to - der_from))
        pasos = max(1, dist // _PASO_GRADOS)
        for i in range(pasos + 1):
            p = i / pasos
            self._servo_izq.angle = self._limitar(izq_from + (izq_to - izq_from) * p)
            self._servo_der.angle = self._limitar(der_from + (der_to - der_from) * p)
            time.sleep(_TIEMPO_ENTRE_PASOS)
        self._servo_izq.angle = izq_to
        self._servo_der.angle = der_to
        time.sleep(_TIEMPO_ESTABILIZACION)
        self._servo_izq.detach()
        self._servo_der.detach()

    def open_for(self, seconds: int) -> None:
        if not self.available:
            logger.error("servo_open_skipped available=false")
            return
        threading.Thread(target=self._ciclo_apertura, args=(seconds,), daemon=True).start()

    def _ciclo_apertura(self, seconds: int) -> None:
        if not self._lock.acquire(blocking=False):
            logger.warning("servo_open_skipped already_in_progress")
            return
        try:
            logger.info("servo_abriendo")
            self._mover_suave(_IZQ_CERRADO, _DER_CERRADO, _IZQ_ABIERTO, _DER_ABIERTO)
            time.sleep(max(1, seconds))
            logger.info("servo_cerrando")
            self._mover_suave(_IZQ_ABIERTO, _DER_ABIERTO, _IZQ_CERRADO, _DER_CERRADO)
        except Exception as exc:
            self.last_error = str(exc)
            logger.exception("servo_ciclo_failed")
        finally:
            self._lock.release()

    def cleanup(self) -> None:
        if self._servo_izq:
            try:
                self._servo_izq.detach()
                self._servo_izq.close()
            except Exception:
                pass
        if self._servo_der:
            try:
                self._servo_der.detach()
                self._servo_der.close()
            except Exception:
                pass
        logger.info("servo_cleanup_ok")

    def is_healthy(self) -> bool:
        return bool(self.available and self.initialized)
