#!/usr/bin/env bash
# Renders assets/icon/icon.svg to the PNG that package.json's "icon" and the
# README header point at. VS Code and vsce both refuse SVG for those.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v rsvg-convert >/dev/null; then
  echo "rsvg-convert not found. Install it with: brew install librsvg" >&2
  exit 1
fi

rsvg-convert -w 128 -h 128 assets/icon/icon.svg -o assets/icon/icon.png
echo "wrote assets/icon/icon.png"
