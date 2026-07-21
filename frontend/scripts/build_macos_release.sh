#!/usr/bin/env bash
set -euo pipefail

frontend_dir="$(cd "$(dirname "$0")/.." && pwd)"
project_dir="$(cd "$frontend_dir/.." && pwd)"
version="$(node -p "require('$frontend_dir/package.json').version")"
artifact="$frontend_dir/dist/Mission-Dashboard-${version}-arm64.dmg"

"$project_dir/backend/scripts/build_sidecar_macos.sh"
cd "$frontend_dir"
npm run build
npx electron-builder --mac --arm64
hdiutil create \
  -volname "Mission Dashboard ${version}" \
  -srcfolder "dist/mac-arm64/Mission Dashboard.app" \
  -ov \
  -format UDZO \
  "$artifact"
hdiutil verify "$artifact"
