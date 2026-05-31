#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ -x "$SCRIPT_DIR/.venv/bin/python" ]]; then
  # Append system dist-packages via a .pth file so the venv's own packages win over
  # system packages with the same name (e.g. typing_extensions, pydantic) while still
  # making system-only packages available (e.g. picamera2, gi/libcamera).
  venv_site=$(ls -d "$SCRIPT_DIR/.venv/lib/python3.*/site-packages" 2>/dev/null | head -1) || true
  if [[ -n "$venv_site" ]]; then
    pth_file="$venv_site/osvium-system-pkgs.pth"
    : > "$pth_file"
    for dist_packages_dir in /usr/lib/python3/dist-packages /usr/lib/python3.*/dist-packages; do
      [[ -d "$dist_packages_dir" ]] && echo "$dist_packages_dir" >> "$pth_file"
    done
  fi
fi

if [[ -x "$SCRIPT_DIR/.venv/bin/python" ]]; then
  exec "$SCRIPT_DIR/.venv/bin/python" "$SCRIPT_DIR/desktop_launcher.py" "$@"
fi

exec python3 "$SCRIPT_DIR/desktop_launcher.py" "$@"
