#!/usr/bin/env bash
# Rasterizes the GitHub SVGs to PNG with headless Chrome. Run after build.cjs.
set -euo pipefail
cd "$(dirname "$0")/../github"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

render() { # svg png width height
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size="$3,$4" \
    --screenshot="$PWD/$2" "file://$PWD/$1" >/dev/null 2>&1
  echo "wrote github/$2"
}

render avatar.svg avatar.png 1024 1024
render social-preview.svg social-preview.png 1280 640
