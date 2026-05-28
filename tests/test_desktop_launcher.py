import threading

import pytest

import desktop_launcher
import install_linux_desktop_entry


class _FakeSocket:
    def __init__(self, connect_result=0):
        self._connect_result = connect_result

    def settimeout(self, _timeout):
        return None

    def connect_ex(self, _address):
        return self._connect_result

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class _FakeResponse:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class _FakeEvent:
    def __init__(self):
        self.handlers = []

    def __iadd__(self, handler):
        self.handlers.append(handler)
        return self

    def fire(self, *args):
        for handler in list(self.handlers):
            handler(*args)


class _FakeEvents:
    def __init__(self):
        self.initialized = _FakeEvent()
        self.shown = _FakeEvent()
        self.loaded = _FakeEvent()


class _FakeWindow:
    def __init__(self):
        self.events = _FakeEvents()
        self.actions = []
        self.js_calls = []

    def resize(self, width, height):
        self.actions.append(("resize", width, height))

    def maximize(self):
        self.actions.append("maximize")

    def toggle_fullscreen(self):
        self.actions.append("toggle_fullscreen")

    def evaluate_js(self, script):
        self.js_calls.append(script)


def test_assert_port_available_rechaza_puerto_ocupado(monkeypatch):
    monkeypatch.setattr(
        desktop_launcher.socket,
        "socket",
        lambda *args, **kwargs: _FakeSocket(connect_result=0),
    )

    with pytest.raises(RuntimeError, match="ya esta en uso"):
        desktop_launcher.assert_port_available("127.0.0.1", 8000)


def test_wait_for_server_ready_detecta_health(monkeypatch):
    attempts = {"count": 0}

    def _fake_urlopen(url, timeout):
        attempts["count"] += 1
        if attempts["count"] < 2:
            raise desktop_launcher.urllib.error.URLError("warming up")
        return _FakeResponse()

    monkeypatch.setattr(desktop_launcher.urllib.request, "urlopen", _fake_urlopen)
    monkeypatch.setattr(desktop_launcher.time, "sleep", lambda _seconds: None)

    desktop_launcher.wait_for_server_ready(
        "http://127.0.0.1:8000",
        timeout_s=2.0,
        interval_s=0.01,
        server_thread=threading.current_thread(),
    )

    assert attempts["count"] == 2


def test_load_webview_module_falla_con_mensaje_claro(monkeypatch):
    def _raise_import_error(name):
        raise ImportError(name)

    monkeypatch.setattr(desktop_launcher.importlib, "import_module", _raise_import_error)

    with pytest.raises(RuntimeError, match="pywebview"):
        desktop_launcher.load_webview_module()


def test_window_url_agrega_flag_desktop():
    config = desktop_launcher.DesktopLauncherConfig(start_path="/")

    assert config.window_url == "http://127.0.0.1:8000/?desktop-launch=1"


def test_open_desktop_window_difiere_fullscreen_y_despacha_ready(monkeypatch):
    fake_window = _FakeWindow()
    captured = {}

    class _FakeWebview:
        def create_window(self, *args, **kwargs):
            captured["kwargs"] = kwargs
            return fake_window

        def start(self, func=None, args=None, localization=None, gui=None, debug=False, **_kwargs):
            captured["debug"] = debug
            captured["gui"] = gui
            fake_window.events.initialized.fire(fake_window, "gtk")
            fake_window.events.shown.fire(fake_window)
            fake_window.events.loaded.fire(fake_window)

    monkeypatch.setattr(desktop_launcher, "load_webview_module", lambda: _FakeWebview())
    monkeypatch.setattr(desktop_launcher.time, "sleep", lambda _seconds: None)

    desktop_launcher.open_desktop_window(desktop_launcher.DesktopLauncherConfig(fullscreen=True))

    assert captured["kwargs"]["hidden"] is False
    assert captured["kwargs"]["fullscreen"] is False
    assert captured["kwargs"]["background_color"] == desktop_launcher.WINDOW_BACKGROUND_COLOR
    assert captured["debug"] is False
    assert captured["gui"] == desktop_launcher.DESKTOP_GUI_BACKEND
    assert fake_window.actions[:2] == ["maximize", "toggle_fullscreen"]
    assert desktop_launcher.DESKTOP_READY_JS in fake_window.js_calls


def test_open_desktop_window_windowed_reaplica_resize(monkeypatch):
    fake_window = _FakeWindow()

    class _FakeWebview:
        def create_window(self, *args, **kwargs):
            return fake_window

        def start(self, func=None, args=None, localization=None, gui=None, debug=False, **_kwargs):
            fake_window.events.initialized.fire(fake_window)
            fake_window.events.shown.fire(fake_window)
            fake_window.events.loaded.fire(fake_window)

    monkeypatch.setattr(desktop_launcher, "load_webview_module", lambda: _FakeWebview())
    monkeypatch.setattr(desktop_launcher.time, "sleep", lambda _seconds: None)

    config = desktop_launcher.DesktopLauncherConfig(fullscreen=False, width=1440, height=900)
    desktop_launcher.open_desktop_window(config)

    assert fake_window.actions == [
        ("resize", 1440, 900),
        ("resize", 1440, 900),
    ]
    assert desktop_launcher.DESKTOP_READY_JS in fake_window.js_calls


def test_bind_window_event_handlers_tolera_args_extra_de_pywebview():
    fake_window = _FakeWindow()
    state = desktop_launcher.DesktopWindowState()
    config = desktop_launcher.DesktopLauncherConfig()

    desktop_launcher._bind_window_event_handlers(fake_window, state, config)

    fake_window.events.initialized.fire(fake_window, "gtk")
    fake_window.events.shown.fire(fake_window)
    fake_window.events.loaded.fire(fake_window, "http://127.0.0.1:8000/")

    assert state.initialized.is_set() is True
    assert state.shown.is_set() is True
    assert state.loaded.is_set() is True


def test_install_linux_shortcuts_escribe_archivos(tmp_path):
    applications_dir = tmp_path / "applications"
    autostart_dir = tmp_path / "autostart"
    runner_path = tmp_path / "run_desktop.sh"
    icon_path = tmp_path / "favicon.svg"
    runner_path.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    icon_path.write_text("<svg />\n", encoding="utf-8")

    desktop_entry, autostart_entry = install_linux_desktop_entry.install_linux_shortcuts(
        applications_dir=applications_dir,
        autostart_dir=autostart_dir,
        enable_autostart=True,
        runner_path=runner_path,
        icon_path=icon_path,
    )

    assert desktop_entry.exists()
    assert autostart_entry is not None and autostart_entry.exists()
    desktop_text = desktop_entry.read_text(encoding="utf-8")
    assert "Name=Osvium" in desktop_text
    assert str(runner_path).replace(" ", "\\ ") in desktop_text
    assert str(icon_path).replace(" ", "\\ ") in desktop_text


def test_install_linux_shortcuts_usa_logo_white_si_favicon_no_existe(tmp_path):
    applications_dir = tmp_path / "applications"
    autostart_dir = tmp_path / "autostart"
    runner_path = tmp_path / "run_desktop.sh"
    favicon_path = tmp_path / "favicon.svg"
    logo_white_path = tmp_path / "logo-white.svg"
    runner_path.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    logo_white_path.write_text("<svg />\n", encoding="utf-8")

    desktop_entry, _ = install_linux_desktop_entry.install_linux_shortcuts(
        applications_dir=applications_dir,
        autostart_dir=autostart_dir,
        enable_autostart=False,
        runner_path=runner_path,
        icon_path=favicon_path,
    )

    desktop_text = desktop_entry.read_text(encoding="utf-8")
    assert str(logo_white_path).replace(" ", "\\ ") in desktop_text
