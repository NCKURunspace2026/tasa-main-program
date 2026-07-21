#!/usr/bin/env bash
set -euo pipefail

frontend_dir="$(cd "$(dirname "$0")/.." && pwd)"
version="$(node -p "require('$frontend_dir/package.json').version")"
artifact="$frontend_dir/dist/Mission-Dashboard-${version}-arm64.dmg"

cd "$frontend_dir"
npm run build
npm run smoke:renderer
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64 --dir
codesign --force --deep --sign - "dist/mac-arm64/Mission Dashboard.app"
codesign --verify --deep --strict "dist/mac-arm64/Mission Dashboard.app"
hdiutil create \
  -volname "Mission Dashboard ${version}" \
  -srcfolder "dist/mac-arm64/Mission Dashboard.app" \
  -ov \
  -format UDZO \
  "$artifact"
hdiutil verify "$artifact"
