#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(pwd)}"
COMPOSITION_ID="${2:-PromoOrbit45}"
OUT_DIR="${3:-$ROOT_DIR/output/remotion}"
USER_NAME="${ZEEME_PROMO_USER_NAME:-Friend}"

MASTER_OUT="$OUT_DIR/zeeme-orbit-of-you.mp4"
PREVIEW_OUT="$OUT_DIR/zeeme-orbit-of-you-preview.mp4"
STILLS_DIR="$OUT_DIR/stills"

mkdir -p "$OUT_DIR" "$STILLS_DIR"
cd "$ROOT_DIR"

if [[ ! -f "video/index.ts" ]]; then
  echo "[render-campaign] missing video/index.ts in $ROOT_DIR" >&2
  exit 2
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "[render-campaign] npx is required" >&2
  exit 2
fi

PROPS_JSON=$(printf '{"userName":"%s"}' "$USER_NAME")

echo "[render-campaign] composition=$COMPOSITION_ID userName=$USER_NAME"
echo "[render-campaign] rendering master -> $MASTER_OUT"
npx remotion render video/index.ts "$COMPOSITION_ID" "$MASTER_OUT" \
  --codec=h264 \
  --props="$PROPS_JSON"

echo "[render-campaign] rendering preview -> $PREVIEW_OUT"
npx remotion render video/index.ts "$COMPOSITION_ID" "$PREVIEW_OUT" \
  --codec=h264 \
  --scale=0.5 \
  --props="$PROPS_JSON"

echo "[render-campaign] exporting stills"
npx remotion still video/index.ts "$COMPOSITION_ID" "$STILLS_DIR/cover-frame-120.png" \
  --frame=120 \
  --props="$PROPS_JSON"
npx remotion still video/index.ts "$COMPOSITION_ID" "$STILLS_DIR/mid-frame-540.png" \
  --frame=540 \
  --props="$PROPS_JSON"
npx remotion still video/index.ts "$COMPOSITION_ID" "$STILLS_DIR/end-frame-1230.png" \
  --frame=1230 \
  --props="$PROPS_JSON"

echo "[render-campaign] done"
echo "master=$MASTER_OUT"
echo "preview=$PREVIEW_OUT"
echo "stills=$STILLS_DIR"
