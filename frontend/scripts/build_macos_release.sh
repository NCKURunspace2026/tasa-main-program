#!/usr/bin/env bash
set -euo pipefail

frontend_dir="$(cd "$(dirname "$0")/.." && pwd)"
backend_dir="$(cd "$frontend_dir/../backend" && pwd)"
version="$(node -p "require('$frontend_dir/package.json').version")"
artifact="$frontend_dir/dist/Mission-Dashboard-${version}-arm64.dmg"

cd "$frontend_dir"
"$backend_dir/scripts/build_sidecar_macos.sh"
npm run build
npm run smoke:renderer
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64 --dir
codesign --force --deep --sign - "dist/mac-arm64/Mission Dashboard.app"
codesign --verify --deep --strict "dist/mac-arm64/Mission Dashboard.app"
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder \
  --mac dmg zip \
  --arm64 \
  --prepackaged "dist/mac-arm64/Mission Dashboard.app" \
  --publish never
hdiutil verify "$artifact"
(cd "$frontend_dir/dist" && shasum -a 256 "$(basename "$artifact")") > "$artifact.sha256.txt"
test -s "dist/latest-mac.yml"
