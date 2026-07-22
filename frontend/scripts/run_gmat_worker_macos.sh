#!/usr/bin/env bash
set -euo pipefail

cloud_api_base="${MISSION_DASHBOARD_API_BASE_URL:-https://missiondashboard.fastapicloud.dev/api}"

if [[ "${1:-}" == "--dev" ]]; then
  frontend_dir="$(cd "$(dirname "$0")/.." && pwd)"
  cd "$frontend_dir"
  exec env \
    MISSION_DASHBOARD_API_BASE_URL="$cloud_api_base" \
    npm run electron:dev
fi

app_binary="${1:-/Applications/Mission Dashboard.app/Contents/MacOS/Mission Dashboard}"
if [[ ! -x "$app_binary" ]]; then
  echo "Mission Dashboard executable not found: $app_binary" >&2
  echo "Install the app in /Applications or pass its executable path." >&2
  exit 1
fi

exec env \
  MISSION_DASHBOARD_API_BASE_URL="$cloud_api_base" \
  "$app_binary"
