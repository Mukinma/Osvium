import hmac
import logging
import secrets
import shutil
import socket
import time
from pathlib import Path
from typing import Optional

import bcrypt
import cv2
from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from config import config
from database.db import db
from rate_limit import limiter
from vision.secure_storage import storage as _storage

router = APIRouter()
auth_logger = logging.getLogger("camerapi.auth")
logger = logging.getLogger("camerapi.routes")
CSRF_SESSION_KEY = "csrf_token"
CSRF_HEADER = "x-csrf-token"
MANUFACTURER_SUPPORT_PHONE = "+52 314 616 1661"


def _template_context(request: Request, **extra: object) -> dict[str, object]:
    context: dict[str, object] = {
        "request": request,
        "asset_version": getattr(request.app.state, "asset_version", "dev"),
        "csrf_token": _get_or_create_csrf_token(request),
    }
    context.update(extra)
    return context


def _get_or_create_csrf_token(request: Request) -> str:
    token = request.session.get(CSRF_SESSION_KEY)
    if not isinstance(token, str) or len(token) < 32:
        token = secrets.token_urlsafe(32)
        request.session[CSRF_SESSION_KEY] = token
    return token


def _is_admin(request: Request) -> bool:
    return bool(request.session.get("admin_authenticated"))


def _has_session(request: Request) -> bool:
    return bool(request.session.get("admin_authenticated") or request.session.get("kiosk"))


def _session_required(request: Request) -> None:
    if not _has_session(request):
        raise HTTPException(status_code=401, detail="No autorizado")


def _admin_required(request: Request) -> None:
    if not _is_admin(request):
        raise HTTPException(status_code=401, detail="No autorizado")


def _csrf_required(request: Request, supplied_token: Optional[str] = None) -> None:
    expected = request.session.get(CSRF_SESSION_KEY)
    token = supplied_token or request.headers.get(CSRF_HEADER, "")
    if not isinstance(expected, str) or not token or not hmac.compare_digest(expected, token):
        raise HTTPException(status_code=403, detail="Token CSRF inválido")


def _session_write_required(request: Request, supplied_token: Optional[str] = None) -> None:
    _session_required(request)
    _csrf_required(request, supplied_token)


def _admin_write_required(request: Request, supplied_token: Optional[str] = None) -> None:
    _admin_required(request)
    _csrf_required(request, supplied_token)


def _verify_admin_password(username: str, password: str) -> bool:
    """Verifica credenciales: primero SQLite (bcrypt), luego fallback a .env (texto plano)."""
    admin_row = db.get_admin_by_username(username)
    if admin_row:
        try:
            return bcrypt.checkpw(password.encode("utf-8"), admin_row["password_hash"].encode("utf-8"))
        except Exception:
            return False
    # Fallback: admin no está en DB aún, usar credenciales de .env
    admin_password = config.admin_password
    valid_user = hmac.compare_digest(username, config.admin_user)
    valid_password = bool(admin_password) and hmac.compare_digest(password, admin_password)
    return valid_user and valid_password


class ConfigUpdate(BaseModel):
    umbral_confianza: float = Field(ge=1, le=200)
    tiempo_apertura_seg: int = Field(ge=1, le=20)
    max_intentos: int = Field(ge=1, le=20)
    support_phone: Optional[str] = Field(default=None, max_length=64)


class ChangePasswordPayload(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8, max_length=128)


class EnrollmentStart(BaseModel):
    user_id: int = Field(gt=0)


class UserCreate(BaseModel):
    nombre: str = Field(min_length=2, max_length=80)


class UserStatusUpdate(BaseModel):
    activo: bool


class SimulateAccessPayload(BaseModel):
    is_valid: bool
    confidence: Optional[float] = None


@router.get("/", response_class=HTMLResponse)
def home(request: Request):
    request.session.setdefault("kiosk", True)
    return request.app.state.templates.TemplateResponse(
        request,
        "index.html",
        _template_context(request),
    )


@router.get("/admin", response_class=HTMLResponse)
def admin(request: Request):
    if not _is_admin(request):
        has_error = request.query_params.get("error") == "1"
        return request.app.state.templates.TemplateResponse(
            request,
            "login.html",
            _template_context(
                request,
                login_error=has_error,
                admin_user=config.admin_user,
                recovery_phone=MANUFACTURER_SUPPORT_PHONE,
            ),
        )
    return request.app.state.templates.TemplateResponse(
        request,
        "admin.html",
        _template_context(request, admin_user=config.admin_user),
    )


@router.post("/auth/login")
def login(request: Request, username: str = Form(...), password: str = Form(...)):
    if _verify_admin_password(username, password):
        request.session["admin_authenticated"] = True
        return RedirectResponse(url="/admin", status_code=303)
    client_ip = request.client.host if request.client else "unknown"
    auth_logger.warning(
        "login_failed ip=%s username=%s timestamp=%s",
        client_ip,
        username,
        int(time.time()),
    )
    return RedirectResponse(url="/admin?error=1", status_code=303)


@router.post("/auth/logout")
def logout(request: Request, csrf_token: str = Form("")):
    _csrf_required(request, csrf_token)
    request.session.clear()
    return RedirectResponse(url="/admin", status_code=303)


@router.get("/api/stream")
def stream(request: Request):
    _session_required(request)
    service = request.app.state.service

    def generate():
        last_seq = 0
        register = getattr(service.camera, "register_jpeg_client", None)
        unregister = getattr(service.camera, "unregister_jpeg_client", None)
        get_stream_frame_seq = getattr(service.camera, "get_stream_frame_seq", None)
        get_frame_seq = getattr(service.camera, "get_frame_seq", None)
        get_content_type = getattr(service.camera, "get_stream_content_type", None)
        content_type = get_content_type() if callable(get_content_type) else "image/jpeg"
        if callable(register):
            register()
        if callable(get_stream_frame_seq):
            last_seq = get_stream_frame_seq()
        elif callable(get_frame_seq):
            last_seq = get_frame_seq()
        try:
            while True:
                frame, last_seq = service.camera.get_jpeg(last_seq=last_seq, timeout=0.5)
                if frame is None:
                    if not service.running:
                        break
                    time.sleep(0.05)
                    continue
                header = f"--frame\r\nContent-Type: {content_type}\r\n\r\n".encode("ascii")
                yield header + frame + b"\r\n"
        finally:
            if callable(unregister):
                unregister()

    return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")


@router.get("/api/frame")
def frame_snapshot(request: Request):
    _session_required(request)
    camera = request.app.state.service.camera
    is_active = getattr(camera, "is_active", None)
    if callable(is_active) and not is_active():
        return Response(status_code=503, headers={"Cache-Control": "no-store"})

    get_snapshot_frame = getattr(camera, "get_snapshot_frame", None)
    if not callable(get_snapshot_frame):
        return Response(status_code=503, headers={"Cache-Control": "no-store"})

    frame, content_type = get_snapshot_frame()
    if frame is None:
        return Response(status_code=204, headers={"Cache-Control": "no-store"})

    return Response(
        content=frame,
        media_type=content_type or "application/octet-stream",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/api/status")
def status(request: Request):
    _session_required(request)
    payload = request.app.state.service.get_status()
    try:
        payload["support_phone"] = str(db.get_config().get("support_phone") or "")
    except Exception:
        logger.exception("status_support_phone_failed")
        payload["support_phone"] = ""
    return payload


@router.post("/api/recognize")
@limiter.limit("10/minute")
def recognize(request: Request):
    _session_write_required(request)
    payload, status_code = request.app.state.service.analyze_once()
    return JSONResponse(payload, status_code=status_code)


@router.post("/api/kiosk/sleep")
def kiosk_sleep(request: Request):
    _session_write_required(request)
    return request.app.state.service.set_backend_sleep(True)


@router.post("/api/kiosk/wake")
def kiosk_wake(request: Request):
    _session_write_required(request)
    return request.app.state.service.set_backend_sleep(False)


@router.get("/health")
def health(request: Request):
    return request.app.state.service.health_liveness()


@router.get("/api/health/detail")
def health_detail(request: Request):
    _admin_required(request)
    return request.app.state.service.health_detail()


@router.post("/api/manual-open")
def manual_open(request: Request):
    _admin_write_required(request)
    request.app.state.service.manual_open()
    return {"ok": True}


@router.get("/api/users")
def list_users(request: Request):
    _admin_required(request)
    return db.list_users()


@router.post("/api/users")
def create_user(payload: UserCreate, request: Request):
    _admin_write_required(request)
    user_id = db.create_user(payload.nombre)
    return {"id": user_id}


@router.get("/api/users/{user_id}")
def get_user_detail(user_id: int, request: Request):
    _admin_required(request)
    user = db.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    samples_count = db.count_user_samples(user_id)
    recent_logs = db.list_user_access_logs(user_id, limit=50)
    return {
        "user": user,
        "samples_count": samples_count,
        "recent_logs": recent_logs,
    }


@router.get("/api/users/{user_id}/thumbnail")
def get_user_thumbnail(user_id: int, request: Request):
    _admin_required(request)
    image_ref = db.get_user_thumbnail_path(user_id)
    if not image_ref:
        return Response(status_code=204, headers={"Cache-Control": "no-store"})

    image = _storage.read_image(Path(image_ref), flags=cv2.IMREAD_GRAYSCALE)
    if image is None:
        return Response(status_code=204, headers={"Cache-Control": "no-store"})

    ok, buffer = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 86])
    if not ok:
        return Response(status_code=204, headers={"Cache-Control": "no-store"})

    return Response(
        content=buffer.tobytes(),
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store"},
    )


@router.patch("/api/users/{user_id}")
def update_user(user_id: int, payload: UserStatusUpdate, request: Request):
    _admin_write_required(request)
    db.set_user_status(user_id, payload.activo)
    return {"ok": True}


@router.delete("/api/users/{user_id}")
def delete_user(user_id: int, request: Request):
    _admin_write_required(request)
    deleted = db.delete_user(user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return {"ok": True}


@router.post("/api/users/{user_id}/capture")
def capture_samples(user_id: int, request: Request, count: int = 30):
    _admin_write_required(request)
    user = db.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if count < 1 or count > 60:
        raise HTTPException(status_code=400, detail="Cantidad inválida")

    service = request.app.state.service
    saved = 0
    attempts = 0
    while saved < count and attempts < count * 2:
        attempts += 1
        path = service.capture_sample(user_id, saved + 1)
        if path:
            db.insert_sample(user_id, path, preprocess_mode=config.sface_preprocess_mode)
            saved += 1
        time.sleep(0.05)
    return {"saved": saved, "requested": count}


@router.post("/api/train")
def train(request: Request):
    _admin_write_required(request)
    service = request.app.state.service

    with service.analysis_lock:
        try:
            result = service.trainer.train_from_dataset()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        try:
            reloaded = service.recognizer.load_model(config.model_path)
        except Exception as exc:
            service.system_status["model"] = "error"
            logger.exception("train_reload_failed_exception path=%s", config.model_path)
            raise HTTPException(
                status_code=500,
                detail=(
                    "Modelo entrenado y guardado en disco, pero la recarga en "
                    "memoria falló con una excepción. Reinicia el servicio para "
                    f"aplicar el nuevo modelo. ({exc})"
                ),
            )

        if not reloaded:
            service.system_status["model"] = "error"
            logger.error("train_reload_returned_false path=%s", config.model_path)
            raise HTTPException(
                status_code=500,
                detail=(
                    "Modelo entrenado y guardado en disco, pero no pudo "
                    "recargarse en memoria. Reinicia el servicio para aplicar "
                    "el nuevo modelo."
                ),
            )

    service.system_status["model"] = "loaded"
    logger.info(
        "train_completed samples=%s users=%s",
        result.get("samples_used"),
        result.get("unique_users"),
    )
    try:
        db.save_model_meta(
            samples=result.get("samples_used", 0),
            unique_users=result.get("unique_users", 0),
        )
    except Exception:
        logger.exception("train_save_meta_failed")
    return {**result, "reloaded": True}


@router.post("/api/face-samples/purge-legacy")
def purge_legacy_face_samples(request: Request):
    _admin_write_required(request)
    return request.app.state.service.purge_legacy_face_samples()


@router.get("/api/config")
def get_config(request: Request):
    _admin_required(request)
    return db.get_config()


@router.put("/api/config")
def update_config(payload: ConfigUpdate, request: Request):
    _admin_write_required(request)
    db.update_config(
        payload.umbral_confianza,
        payload.tiempo_apertura_seg,
        payload.max_intentos,
        payload.support_phone,
    )
    return {"ok": True}


@router.post("/api/restart")
def restart(request: Request):
    _admin_write_required(request)
    if not config.debug or not config.enable_restart:
        raise HTTPException(status_code=403, detail="Reinicio deshabilitado")

    restart_hook = getattr(request.app.state.service, "restart", None)
    if callable(restart_hook):
        restart_hook()
        return {"ok": True}

    raise HTTPException(status_code=501, detail="Reinicio no disponible en este entorno")


@router.get("/api/access-logs")
def access_logs(request: Request, limit: int = 100, offset: int = 0):
    _admin_required(request)
    limit = max(1, min(500, limit))
    offset = max(0, offset)
    return db.list_access_logs(limit=limit, offset=offset)


@router.get("/api/system/diagnostics")
def system_diagnostics(request: Request):
    _admin_required(request)
    service = request.app.state.service
    detail = service.health_detail()

    # Cámara
    camera_ok = bool(detail.get("camera_active"))
    if camera_ok:
        camera_msg = "La cámara está funcionando correctamente"
    else:
        camera_msg = "No detectamos la cámara — verifica la conexión"

    # Modelo
    model_loaded = bool(detail.get("model_loaded"))
    meta = db.get_model_meta()
    if model_loaded and meta:
        model_msg = f"El sistema reconoce a {meta['unique_users']} persona{'s' if meta['unique_users'] != 1 else ''}"
        model_trained_at = meta.get("trained_at")
        model_users = meta.get("unique_users", 0)
    elif model_loaded:
        model_msg = "Modelo activo, sin historial de entrenamiento"
        model_trained_at = None
        model_users = 0
    else:
        model_msg = "Aún no hay un modelo entrenado — ve a Mantenimiento para entrenar"
        model_trained_at = None
        model_users = 0

    # Puerta / GPIO
    gpio_ok = bool(detail.get("gpio_initialized"))
    gpio_mode = "rpi" if gpio_ok else "simulado"
    if gpio_ok:
        door_msg = "La puerta responde correctamente"
    else:
        door_msg = "Control de puerta no disponible (modo simulado)"

    # Almacenamiento
    try:
        usage = shutil.disk_usage("/")
        free_gb = usage.free / (1024 ** 3)
        percent_used = (usage.used / usage.total) * 100
        storage_ok = free_gb >= 0.5
        if storage_ok:
            storage_msg = f"Hay suficiente espacio disponible ({free_gb:.1f} GB libres)"
        else:
            storage_msg = f"Poco espacio en disco ({free_gb:.1f} GB libres) — podrían perderse registros nuevos"
    except Exception:
        free_gb = 0.0
        percent_used = 0.0
        storage_ok = False
        storage_msg = "No se pudo verificar el espacio en disco"

    issues = sum([not camera_ok, not model_loaded, not gpio_ok, not storage_ok])
    if issues == 0:
        summary = "Todo en orden"
    elif issues == 1:
        summary = "Hay 1 aspecto a revisar"
    else:
        summary = f"Hay {issues} aspectos a revisar"

    return {
        "summary": summary,
        "all_ok": issues == 0,
        "checks": {
            "camera": {"ok": camera_ok, "message": camera_msg},
            "model": {
                "ok": model_loaded,
                "message": model_msg,
                "trained_users": model_users,
                "last_trained_at": model_trained_at,
            },
            "door": {"ok": gpio_ok, "message": door_msg, "mode": gpio_mode},
            "storage": {"ok": storage_ok, "message": storage_msg, "free_gb": round(free_gb, 2), "percent_used": round(percent_used, 1)},
        },
    }


@router.get("/api/system/device-info")
def system_device_info(request: Request):
    _admin_required(request)

    hostname = socket.gethostname()

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
    except Exception:
        local_ip = "No disponible"
    finally:
        try:
            s.close()
        except Exception:
            pass

    uptime_seconds = int(time.monotonic())

    try:
        usage = shutil.disk_usage("/")
        disk_free_gb = round(usage.free / (1024 ** 3), 2)
        disk_total_gb = round(usage.total / (1024 ** 3), 2)
    except Exception:
        disk_free_gb = 0.0
        disk_total_gb = 0.0

    software_version = getattr(config, "version", "1.0.0")
    device_name = getattr(config, "device_name", "Vireom — Acceso Principal")

    return {
        "device_name": device_name,
        "hostname": hostname,
        "local_ip": local_ip,
        "uptime_seconds": uptime_seconds,
        "disk_free_gb": disk_free_gb,
        "disk_total_gb": disk_total_gb,
        "software_version": software_version,
    }


@router.post("/api/admin/change-password")
def change_password(payload: ChangePasswordPayload, request: Request):
    _admin_write_required(request)
    admin_username = config.admin_user

    if not _verify_admin_password(admin_username, payload.current_password):
        raise HTTPException(status_code=400, detail="La contraseña actual no es correcta")

    password_hash = bcrypt.hashpw(
        payload.new_password.encode("utf-8"),
        bcrypt.gensalt(),
    ).decode("utf-8")

    db.upsert_admin_password(admin_username, password_hash)
    auth_logger.info("admin_password_changed username=%s", admin_username)
    return {"ok": True}


# ── Enrollment endpoints ───────────────────────────────────────────


@router.post("/api/enrollment/start")
def enrollment_start(payload: EnrollmentStart, request: Request):
    _admin_write_required(request)
    user = db.get_user(payload.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    result = request.app.state.service.start_enrollment(payload.user_id)
    status_code = 200 if result.get("ok") else 409
    return JSONResponse(result, status_code=status_code)


@router.get("/api/enrollment/status")
def enrollment_status(request: Request):
    _admin_required(request)
    return request.app.state.service.get_enrollment_status()


@router.post("/api/enrollment/abort")
def enrollment_abort(request: Request):
    _admin_write_required(request)
    result = request.app.state.service.abort_enrollment()
    status_code = 200 if result.get("ok") else 404
    return JSONResponse(result, status_code=status_code)


@router.post("/api/enrollment/retry-step")
def enrollment_retry_step(request: Request):
    _admin_write_required(request)
    result = request.app.state.service.retry_enrollment_step()
    status_code = 200 if result.get("ok") else 409 if result.get("error") == "enrollment_not_retryable" else 404
    return JSONResponse(result, status_code=status_code)


@router.post("/api/enrollment/finish")
def enrollment_finish(request: Request):
    _admin_write_required(request)
    result = request.app.state.service.finish_enrollment()
    status_code = 200 if result.get("ok") else 409 if result.get("error") == "enrollment_not_finishable" else 404
    return JSONResponse(result, status_code=status_code)


@router.post("/api/test/simulate-access")
def simulate_access(payload: SimulateAccessPayload, request: Request):
    if not config.debug:
        raise HTTPException(status_code=404, detail="No encontrado")
    _admin_write_required(request)
    return request.app.state.service.simulate_access_attempt(
        is_valid=payload.is_valid,
        confidence=payload.confidence,
    )
