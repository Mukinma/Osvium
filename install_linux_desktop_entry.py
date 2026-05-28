#!/usr/bin/env python3
"""Install Linux/Raspberry OS desktop shortcuts for Osvium."""

from __future__ import annotations

import argparse
import platform
from pathlib import Path


APP_NAME = "Osvium"
APP_COMMENT = "Abrir Osvium en una ventana nativa"
PROJECT_ROOT = Path(__file__).resolve().parent
RUNNER_PATH = PROJECT_ROOT / "run_desktop.sh"
ICON_CANDIDATES = (
    PROJECT_ROOT / "frontend" / "static" / "images" / "favicon.svg",
    PROJECT_ROOT / "frontend" / "static" / "images" / "logo-white.svg",
)


def _desktop_escape(value: Path | str) -> str:
    return str(value).replace("\\", "\\\\").replace(" ", "\\ ")


def _resolve_icon_path(icon_path: Path) -> Path:
    if icon_path.exists():
        return icon_path

    fallback_icon = icon_path.with_name("logo-white.svg")
    if fallback_icon.exists():
        return fallback_icon

    return icon_path


def build_desktop_entry(exec_path: Path, icon_path: Path) -> str:
    return (
        "[Desktop Entry]\n"
        "Version=1.0\n"
        "Type=Application\n"
        f"Name={APP_NAME}\n"
        f"Comment={APP_COMMENT}\n"
        f"Exec={_desktop_escape(exec_path)}\n"
        f"Path={_desktop_escape(exec_path.parent)}\n"
        f"Icon={_desktop_escape(icon_path)}\n"
        "Terminal=false\n"
        "StartupNotify=true\n"
        "Categories=Utility;\n"
    )


def install_linux_shortcuts(
    *,
    applications_dir: Path,
    autostart_dir: Path,
    enable_autostart: bool,
    runner_path: Path = RUNNER_PATH,
    icon_path: Path = ICON_CANDIDATES[0],
) -> tuple[Path, Path | None]:
    resolved_icon_path = _resolve_icon_path(icon_path)
    applications_dir.mkdir(parents=True, exist_ok=True)
    desktop_entry = applications_dir / "osvium.desktop"
    desktop_entry.write_text(build_desktop_entry(runner_path, resolved_icon_path), encoding="utf-8")
    desktop_entry.chmod(0o755)

    autostart_entry: Path | None = None
    if enable_autostart:
        autostart_dir.mkdir(parents=True, exist_ok=True)
        autostart_entry = autostart_dir / "osvium.desktop"
        autostart_entry.write_text(build_desktop_entry(runner_path, resolved_icon_path), encoding="utf-8")
        autostart_entry.chmod(0o755)

    return desktop_entry, autostart_entry


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Install Osvium desktop shortcuts on Linux/Raspberry OS.")
    parser.add_argument(
        "--no-autostart",
        action="store_false",
        dest="enable_autostart",
        help="Do not install an autostart entry in ~/.config/autostart.",
    )
    parser.set_defaults(enable_autostart=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    if platform.system().lower() != "linux":
        print("Este instalador solo aplica a Linux/Raspberry OS.")
        return 1

    args = _build_arg_parser().parse_args(argv)
    home = Path.home()
    applications_dir = home / ".local" / "share" / "applications"
    autostart_dir = home / ".config" / "autostart"

    desktop_entry, autostart_entry = install_linux_shortcuts(
        applications_dir=applications_dir,
        autostart_dir=autostart_dir,
        enable_autostart=bool(args.enable_autostart),
    )

    print(f"Acceso directo instalado en: {desktop_entry}")
    if autostart_entry is not None:
        print(f"Autoarranque instalado en: {autostart_entry}")
    else:
        print("Autoarranque no instalado. Usa --no-autostart solo si quieres deshabilitarlo.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
