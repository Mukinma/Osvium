#!/usr/bin/env python3
"""Native desktop launcher for Osvium.

Starts the local FastAPI app on 127.0.0.1 and wraps it in a pywebview window
without requiring the user to type localhost in a browser.
"""

from __future__ import annotations

import argparse
import importlib
import logging
import platform
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

import uvicorn


logger = logging.getLogger("camerapi.desktop")

DESKTOP_GUI_BACKEND = "qt"
DESKTOP_READY_EVENT = "vireom:desktop-ready"
DESKTOP_LAUNCH_QUERY = "desktop-launch=1"
DESKTOP_WINDOW_SETTLE_S = 0.35
WINDOWED_RESIZE_SETTLE_S = 0.12
WINDOW_BACKGROUND_COLOR = "#050911"
DESKTOP_READY_JS = f"""
(() => {{
  window.__VIREOM_DESKTOP_PENDING__ = false;
  window.dispatchEvent(new CustomEvent('{DESKTOP_READY_EVENT}'));
  window.dispatchEvent(new Event('resize'));
}})();
""".strip()


@dataclass(frozen=True)
class DesktopLauncherConfig:
    host: str = "127.0.0.1"
    port: int = 8000
    start_path: str = "/"
    width: int = 1280
    height: int = 820
    fullscreen: bool = True
    health_timeout_s: float = 25.0
    health_interval_s: float = 0.25
    title: str = "Osvium"

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"

    @property
    def start_url(self) -> str:
        return f"{self.base_url}{self.start_path}"

    @property
    def window_url(self) -> str:
        separator = "&" if "?" in self.start_path else "?"
        return f"{self.base_url}{self.start_path}{separator}{DESKTOP_LAUNCH_QUERY}"


@dataclass
class DesktopServerHandle:
    server: uvicorn.Server
    thread: threading.Thread
    base_url: str

    def stop(self, timeout_s: float = 10.0) -> None:
        self.server.should_exit = True
        self.thread.join(timeout=timeout_s)
        if self.thread.is_alive():
            self.server.force_exit = True
            self.thread.join(timeout=2.0)


@dataclass
class DesktopWindowState:
    initialized: threading.Event = field(default_factory=threading.Event)
    shown: threading.Event = field(default_factory=threading.Event)
    loaded: threading.Event = field(default_factory=threading.Event)
    released: bool = False
    lock: threading.Lock = field(default_factory=threading.Lock)


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Launch Osvium in a native desktop window.")
    parser.add_argument("--host", default="127.0.0.1", help="Local bind host for desktop mode.")
    parser.add_argument("--port", default=8000, type=int, help="Local bind port for desktop mode.")
    parser.add_argument("--width", default=1280, type=int, help="Initial window width.")
    parser.add_argument("--height", default=820, type=int, help="Initial window height.")
    parser.add_argument("--start-path", default="/", help="Initial route to open inside the app.")
    parser.add_argument(
        "--windowed",
        action="store_true",
        help="Open in a normal window instead of fullscreen.",
    )
    return parser


def build_launcher_config(args: argparse.Namespace) -> DesktopLauncherConfig:
    return DesktopLauncherConfig(
        host=str(args.host or "127.0.0.1"),
        port=int(args.port or 8000),
        width=max(960, int(args.width or 1280)),
        height=max(640, int(args.height or 820)),
        fullscreen=not bool(args.windowed),
        start_path=_normalize_start_path(str(args.start_path or "/")),
    )


def _normalize_start_path(raw_path: str) -> str:
    return raw_path if raw_path.startswith("/") else f"/{raw_path}"


def assert_port_available(host: str, port: int) -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.5)
        if probe.connect_ex((host, port)) == 0:
            raise RuntimeError(
                f"El puerto local {port} ya esta en uso. Cierra la otra instancia de Osvium o libera ese puerto."
            )


def _build_server_config(app: Any, config: DesktopLauncherConfig) -> uvicorn.Config:
    return uvicorn.Config(
        app=app,
        host=config.host,
        port=config.port,
        reload=False,
        log_level="info",
        access_log=False,
    )


def create_server_handle(config: DesktopLauncherConfig) -> DesktopServerHandle:
    from main import get_app

    app = get_app()
    server = uvicorn.Server(_build_server_config(app, config))
    thread = threading.Thread(target=server.run, name="osvium-desktop-server", daemon=True)
    return DesktopServerHandle(server=server, thread=thread, base_url=config.base_url)


def wait_for_server_ready(
    base_url: str,
    timeout_s: float,
    interval_s: float,
    server_thread: threading.Thread | None = None,
) -> None:
    deadline = time.monotonic() + timeout_s
    health_url = f"{base_url}/health"

    while time.monotonic() < deadline:
        if server_thread is not None and not server_thread.is_alive():
            raise RuntimeError("El servidor local termino antes de completar el arranque.")
        try:
            with urllib.request.urlopen(health_url, timeout=1.0) as response:
                if 200 <= int(response.status) < 500:
                    return
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
            time.sleep(interval_s)

    raise RuntimeError("El servidor local no respondio a tiempo en /health.")


def start_server(config: DesktopLauncherConfig) -> DesktopServerHandle:
    assert_port_available(config.host, config.port)
    handle = create_server_handle(config)
    handle.thread.start()
    try:
        wait_for_server_ready(
            handle.base_url,
            timeout_s=config.health_timeout_s,
            interval_s=config.health_interval_s,
            server_thread=handle.thread,
        )
        return handle
    except Exception:
        handle.stop(timeout_s=2.0)
        raise


def load_webview_module() -> Any:
    try:
        return importlib.import_module("webview")
    except ImportError as exc:
        linux_hint = ""
        if platform.system().lower() == "linux":
            linux_hint = (
                " En Linux/Raspberry OS tambien necesitas un runtime grafico compatible "
                "(por ejemplo GTK/WebKit2GTK o Qt)."
            )
        raise RuntimeError(
            "No se encontro pywebview. Instala las dependencias de escritorio con "
            "`pip install -r requirements.txt`." + linux_hint
        ) from exc


def _safe_window_action(action_name: str, action, *args) -> None:
    try:
        action(*args)
    except Exception:
        logger.exception("desktop_window_action_failed action=%s", action_name)


def _dispatch_desktop_ready(window: Any) -> None:
    _safe_window_action("dispatch_desktop_ready", window.evaluate_js, DESKTOP_READY_JS)


def _stabilize_window(window: Any, config: DesktopLauncherConfig) -> None:
    logger.info("desktop_window_stabilize_start fullscreen=%s", config.fullscreen)
    if config.fullscreen:
        _safe_window_action("maximize", window.maximize)
        time.sleep(DESKTOP_WINDOW_SETTLE_S)
        _safe_window_action("toggle_fullscreen", window.toggle_fullscreen)
        time.sleep(DESKTOP_WINDOW_SETTLE_S)
    else:
        _safe_window_action("resize_initial", window.resize, config.width, config.height)
        time.sleep(WINDOWED_RESIZE_SETTLE_S)
        _safe_window_action("resize_final", window.resize, config.width, config.height)
        time.sleep(WINDOWED_RESIZE_SETTLE_S)

    _dispatch_desktop_ready(window)
    logger.info("desktop_window_stabilize_done fullscreen=%s", config.fullscreen)


def _maybe_release_desktop_ready(window: Any, state: DesktopWindowState, config: DesktopLauncherConfig) -> None:
    if not (state.initialized.is_set() and state.shown.is_set() and state.loaded.is_set()):
        return

    with state.lock:
        if state.released:
            return
        state.released = True

    _stabilize_window(window, config)


def _handle_window_initialized(window: Any, state: DesktopWindowState, config: DesktopLauncherConfig) -> None:
    state.initialized.set()
    logger.info("desktop_window_initialized")
    _maybe_release_desktop_ready(window, state, config)


def _handle_window_shown(window: Any, state: DesktopWindowState, config: DesktopLauncherConfig) -> None:
    state.shown.set()
    logger.info("desktop_window_shown")
    _maybe_release_desktop_ready(window, state, config)


def _handle_window_loaded(window: Any, state: DesktopWindowState, config: DesktopLauncherConfig) -> None:
    state.loaded.set()
    logger.info("desktop_window_loaded")
    _maybe_release_desktop_ready(window, state, config)


def _bind_window_event_handlers(window: Any, state: DesktopWindowState, config: DesktopLauncherConfig) -> None:
    window.events.initialized += (
        lambda *_event_args: _handle_window_initialized(window, state, config)
    )
    window.events.shown += (
        lambda *_event_args: _handle_window_shown(window, state, config)
    )
    window.events.loaded += (
        lambda *_event_args: _handle_window_loaded(window, state, config)
    )


def open_desktop_window(config: DesktopLauncherConfig) -> None:
    webview = load_webview_module()

    try:
        window = webview.create_window(
            config.title,
            config.window_url,
            width=config.width,
            height=config.height,
            resizable=True,
            fullscreen=False,
            hidden=False,
            background_color=WINDOW_BACKGROUND_COLOR,
        )
        state = DesktopWindowState()
        _bind_window_event_handlers(window, state, config)
        webview.start(debug=False, gui=DESKTOP_GUI_BACKEND)
    except Exception as exc:
        linux_hint = ""
        if platform.system().lower() == "linux":
            linux_hint = (
                " Verifica que Raspberry OS/Linux tenga instalado Qt y las dependencias de "
                "pywebview para el backend qt (qtpy, PyQt6, PyQt6-WebEngine)."
            )
        raise RuntimeError(
            f"No se pudo abrir la ventana nativa de Osvium.{linux_hint}"
        ) from exc


def _configure_launcher_logging() -> None:
    if logging.getLogger().handlers:
        return
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def run_launcher(config: DesktopLauncherConfig) -> int:
    _configure_launcher_logging()
    logger.info("desktop_launcher_start url=%s", config.window_url)

    handle: DesktopServerHandle | None = None
    try:
        handle = start_server(config)
        open_desktop_window(config)
        return 0
    except KeyboardInterrupt:
        logger.info("desktop_launcher_interrupted")
        return 130
    except Exception as exc:
        logger.error("desktop_launcher_failed error=%s", exc)
        print(f"[Osvium desktop] {exc}", file=sys.stderr)
        return 1
    finally:
        if handle is not None:
            handle.stop()
            logger.info("desktop_launcher_stop")


def main(argv: list[str] | None = None) -> int:
    parser = _build_arg_parser()
    args = parser.parse_args(argv)
    return run_launcher(build_launcher_config(args))


if __name__ == "__main__":
    raise SystemExit(main())
