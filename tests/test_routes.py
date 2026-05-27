import re

import api.routes as routes_module


def _csrf_from_html(html):
    match = re.search(r'<meta name="csrf-token" content="([^"]+)"', html)
    assert match, html
    return match.group(1)


def _csrf_headers(token):
    return {"x-csrf-token": token}


def _login_admin(client):
    response = client.post(
        "/auth/login",
        data={"username": "admin", "password": "admin-pass"},
        follow_redirects=False,
    )
    assert response.status_code == 303
    admin_page = client.get("/admin")
    assert admin_page.status_code == 200
    return _csrf_from_html(admin_page.text)


def _open_kiosk_session(client):
    response = client.get("/")
    assert response.status_code == 200
    return _csrf_from_html(response.text)


def test_stream_rechaza_acceso_anonimo(client):
    response = client.get("/api/stream")
    assert response.status_code == 401


def test_frame_rechaza_acceso_anonimo(client):
    response = client.get("/api/frame")
    assert response.status_code == 401


def test_frame_snapshot_kiosk_con_frame(client):
    _open_kiosk_session(client)

    response = client.get("/api/frame")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["content-type"].startswith("image/jpeg")
    assert response.content == b"\xff\xd8fake"


def test_frame_snapshot_devuelve_204_sin_frame(client):
    _open_kiosk_session(client)
    client.app.state.service.camera.snapshot_payload = None

    response = client.get("/api/frame")

    assert response.status_code == 204
    assert response.headers["cache-control"] == "no-store"
    assert response.content == b""


def test_frame_snapshot_devuelve_503_si_camara_inactiva(client):
    _open_kiosk_session(client)
    client.app.state.service.camera.active = False

    response = client.get("/api/frame")

    assert response.status_code == 503
    assert response.headers["cache-control"] == "no-store"


def test_status_rechaza_acceso_anonimo(client):
    response = client.get("/api/status")
    assert response.status_code == 401


def test_kiosk_home_setea_sesion(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "session" in response.headers.get("set-cookie", "").lower() or response.cookies
    html = response.text
    assert '<meta name="csrf-token"' in html
    assert "tipsCarouselCamera" not in html
    assert 'id="cameraBadge"' not in html
    assert "?v=" in html


def test_health_publico_es_minimo(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"healthy": True}


def test_health_detallado_requiere_admin(client):
    response = client.get("/api/health/detail")
    assert response.status_code == 401


def test_health_detallado_para_admin(client):
    _login_admin(client)
    response = client.get("/api/health/detail")
    assert response.status_code == 200
    assert "metrics" in response.json()


def test_config_get_put_preserva_support_phone(client, monkeypatch):
    saved_config = {
        "umbral_confianza": 68.0,
        "tiempo_apertura_seg": 4,
        "max_intentos": 3,
        "support_phone": "+52 55 0000 1111",
    }

    def fake_get_config():
        return dict(saved_config)

    def fake_update_config(umbral_confianza, tiempo_apertura_seg, max_intentos, support_phone):
        next_phone = saved_config["support_phone"] if support_phone is None else str(support_phone)
        saved_config.update(
            {
                "umbral_confianza": float(umbral_confianza),
                "tiempo_apertura_seg": int(tiempo_apertura_seg),
                "max_intentos": int(max_intentos),
                "support_phone": next_phone,
            }
        )

    monkeypatch.setattr(routes_module.db, "get_config", fake_get_config)
    monkeypatch.setattr(routes_module.db, "update_config", fake_update_config)

    csrf_token = _login_admin(client)

    get_response = client.get("/api/config")
    assert get_response.status_code == 200
    assert get_response.json()["support_phone"] == "+52 55 0000 1111"

    put_response = client.put(
        "/api/config",
        json={
            "umbral_confianza": 81.0,
            "tiempo_apertura_seg": 7,
            "max_intentos": 4,
            "support_phone": "+52 81 2222 3333",
        },
        headers=_csrf_headers(csrf_token),
    )

    assert put_response.status_code == 200
    assert saved_config["umbral_confianza"] == 81.0
    assert saved_config["tiempo_apertura_seg"] == 7
    assert saved_config["max_intentos"] == 4
    assert saved_config["support_phone"] == "+52 81 2222 3333"

    put_without_phone = client.put(
        "/api/config",
        json={
            "umbral_confianza": 79.0,
            "tiempo_apertura_seg": 6,
            "max_intentos": 2,
        },
        headers=_csrf_headers(csrf_token),
    )

    assert put_without_phone.status_code == 200
    assert saved_config["support_phone"] == "+52 81 2222 3333"


def test_admin_login_template_uses_manufacturer_recovery_phone(client, monkeypatch):
    monkeypatch.setattr(
        routes_module.db,
        "get_config",
        lambda: {
            "umbral_confianza": 70.0,
            "tiempo_apertura_seg": 5,
            "max_intentos": 3,
            "support_phone": "+52 55 7777 8888",
        },
    )

    response = client.get("/admin")

    assert response.status_code == 200
    assert 'data-recovery-phone="+52 314 616 1661"' in response.text
    assert "+52 55 7777 8888" not in response.text
    assert "login-recovery-view" in response.text
    assert "login-recovery-panel" not in response.text


def test_purge_legacy_face_samples_endpoint_requires_admin_and_csrf(client, monkeypatch):
    calls = []

    def fake_purge():
        calls.append(True)
        return {"ok": True, "deleted_files": 3, "deleted_samples": 3, "model_removed": True}

    monkeypatch.setattr(client.app.state.service, "purge_legacy_face_samples", fake_purge, raising=False)

    unauthorized = client.post("/api/face-samples/purge-legacy")
    assert unauthorized.status_code == 401

    csrf_token = _login_admin(client)
    forbidden = client.post("/api/face-samples/purge-legacy")
    assert forbidden.status_code == 403

    response = client.post(
        "/api/face-samples/purge-legacy",
        headers=_csrf_headers(csrf_token),
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True, "deleted_files": 3, "deleted_samples": 3, "model_removed": True}
    assert calls == [True]


def test_restart_deshabilitado_en_produccion(client):
    routes_module.config.debug = False
    csrf_token = _login_admin(client)
    response = client.post("/api/restart", headers=_csrf_headers(csrf_token))
    assert response.status_code == 403


def test_simulate_access_oculto_en_produccion(client):
    routes_module.config.debug = False
    _login_admin(client)
    response = client.post("/api/test/simulate-access", json={"is_valid": True})
    assert response.status_code == 404


def test_recognize_tiene_rate_limiting(client):
    csrf_token = _open_kiosk_session(client)
    for _ in range(10):
        response = client.post("/api/recognize", headers=_csrf_headers(csrf_token))
        assert response.status_code == 200

    response = client.post("/api/recognize", headers=_csrf_headers(csrf_token))
    assert response.status_code == 429


def test_recognize_requiere_sesion(client):
    response = client.post("/api/recognize")
    assert response.status_code == 401


def test_kiosk_sleep_requiere_sesion(client):
    response = client.post("/api/kiosk/sleep")
    assert response.status_code == 401


def test_kiosk_sleep_requiere_csrf(client):
    _open_kiosk_session(client)
    response = client.post("/api/kiosk/sleep")
    assert response.status_code == 403


def test_kiosk_sleep_y_wake_con_sesion(client):
    csrf_token = _open_kiosk_session(client)

    sleep_response = client.post("/api/kiosk/sleep", headers=_csrf_headers(csrf_token))
    assert sleep_response.status_code == 200
    assert sleep_response.json().get("sleep_mode") is True

    wake_response = client.post("/api/kiosk/wake", headers=_csrf_headers(csrf_token))
    assert wake_response.status_code == 200
    assert wake_response.json().get("sleep_mode") is False


def test_enrollment_status_idle_para_admin(client):
    _login_admin(client)
    response = client.get("/api/enrollment/status")
    assert response.status_code == 200
    payload = response.json()
    assert payload["phase"] == "preflight"
    assert payload["state"] == "idle"


def test_enrollment_start_devuelve_snapshot_rehidratable(client, monkeypatch):
    monkeypatch.setattr(routes_module.db, "get_user", lambda user_id: {"id": user_id, "nombre": "Ada"})
    csrf_token = _login_admin(client)
    response = client.post(
        "/api/enrollment/start",
        json={"user_id": 1},
        headers=_csrf_headers(csrf_token),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["phase"] == "active"
    assert payload["state"] == "step_active"
    assert payload["user_id"] == 1
    assert payload["actions"]["can_abort"] is True


def test_enrollment_finish_limpia_sesion_terminal(client):
    csrf_token = _login_admin(client)
    service = client.app.state.service
    service._enrollment_status = {
        **service._active_enrollment_status(7),
        "phase": "completed_review",
        "state": "completed",
        "actions": {
            "can_retry": False,
            "can_abort": False,
            "can_finish": True,
            "can_train": True,
        },
    }

    response = client.post("/api/enrollment/finish", headers=_csrf_headers(csrf_token))
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["phase"] == "preflight"
    assert service._enrollment_status is None


def test_enrollment_finish_rechaza_sesion_activa(client):
    csrf_token = _login_admin(client)
    client.app.state.service._enrollment_status = client.app.state.service._active_enrollment_status(3)

    response = client.post("/api/enrollment/finish", headers=_csrf_headers(csrf_token))
    assert response.status_code == 409
    assert response.json()["error"] == "enrollment_not_finishable"
