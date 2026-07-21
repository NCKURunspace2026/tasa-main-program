#!/usr/bin/env bash
set -euo pipefail

backend_dir="$(cd "$(dirname "$0")/.." && pwd)"
cache_dir="${TMPDIR:-/private/tmp}/mission-dashboard-pyinstaller"

cd "$backend_dir"
PYINSTALLER_CONFIG_DIR="$cache_dir" .venv/bin/pyinstaller \
  --noconfirm \
  --clean \
  --onedir \
  --name mission-dashboard-backend \
  --add-data "docs/scenarios:docs/scenarios" \
  server_entry.py
