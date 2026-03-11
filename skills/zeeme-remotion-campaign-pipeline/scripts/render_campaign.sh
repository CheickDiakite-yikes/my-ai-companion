#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(pwd)}"
COMPOSITION_ID="${2:-PromoOrbit45}"
OUT_DIR="${3:-$ROOT_DIR/output/remotion}"
USER_NAME="${ZEEME_PROMO_USER_NAME:-Friend}"
BROWSER_EXECUTABLE="${REMOTION_BROWSER_EXECUTABLE:-}"
CHROME_MODE="${REMOTION_CHROME_MODE:-}"
PUBLIC_DIR="${ZEEME_PROMO_PUBLIC_DIR:-client/public}"
BUNDLE_DIR="${ZEEME_PROMO_BUNDLE_DIR:-$OUT_DIR/bundle}"
STATIC_PORT="${ZEEME_PROMO_STATIC_PORT:-}"
RENDER_CONCURRENCY="${ZEEME_PROMO_CONCURRENCY:-1}"
SERVER_LOG="$OUT_DIR/static-server.log"
STATIC_SERVER_PID=""

if [[ -z "$BROWSER_EXECUTABLE" && -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]]; then
  BROWSER_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
fi

if [[ -n "$BROWSER_EXECUTABLE" && -z "$CHROME_MODE" ]]; then
  CHROME_MODE="chrome-for-testing"
fi

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

if ! command -v python3 >/dev/null 2>&1; then
  echo "[render-campaign] python3 is required to host the static Remotion bundle" >&2
  exit 2
fi

PROPS_JSON=$(printf '{"userName":"%s"}' "$USER_NAME")
REMOTION_BROWSER_ARGS=()
REMOTION_PUBLIC_ARGS=()
REMOTION_RENDER_ARGS=()

if [[ -n "$BROWSER_EXECUTABLE" ]]; then
  REMOTION_BROWSER_ARGS+=(--browser-executable "$BROWSER_EXECUTABLE")
fi

if [[ -n "$CHROME_MODE" ]]; then
  REMOTION_BROWSER_ARGS+=(--chrome-mode="$CHROME_MODE")
fi

if [[ -n "$PUBLIC_DIR" ]]; then
  REMOTION_PUBLIC_ARGS+=(--public-dir="$PUBLIC_DIR")
fi

if [[ -n "$RENDER_CONCURRENCY" ]]; then
  REMOTION_RENDER_ARGS+=(--concurrency="$RENDER_CONCURRENCY")
fi

if [[ -z "$STATIC_PORT" ]]; then
  STATIC_PORT="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
fi

cleanup() {
  if [[ -n "$STATIC_SERVER_PID" ]]; then
    kill "$STATIC_SERVER_PID" >/dev/null 2>&1 || true
    wait "$STATIC_SERVER_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT

ENTRY_POINT="http://127.0.0.1:$STATIC_PORT/index.html"

echo "[render-campaign] bundling static site -> $BUNDLE_DIR"
npx remotion bundle video/index.ts --out-dir="$BUNDLE_DIR" \
  "${REMOTION_PUBLIC_ARGS[@]}"

echo "[render-campaign] starting static server -> $ENTRY_POINT"
python3 -m http.server "$STATIC_PORT" --bind 127.0.0.1 -d "$BUNDLE_DIR" >"$SERVER_LOG" 2>&1 &
STATIC_SERVER_PID="$!"

for _ in $(seq 1 50); do
  if curl -sf "$ENTRY_POINT" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

if ! curl -sf "$ENTRY_POINT" >/dev/null 2>&1; then
  echo "[render-campaign] static server did not become ready at $ENTRY_POINT" >&2
  if [[ -f "$SERVER_LOG" ]]; then
    cat "$SERVER_LOG" >&2
  fi
  exit 2
fi

echo "[render-campaign] composition=$COMPOSITION_ID userName=$USER_NAME"
if [[ -n "$BROWSER_EXECUTABLE" ]]; then
  echo "[render-campaign] browser=$BROWSER_EXECUTABLE"
fi
if [[ -n "$CHROME_MODE" ]]; then
  echo "[render-campaign] chrome-mode=$CHROME_MODE"
fi
if [[ -n "$PUBLIC_DIR" ]]; then
  echo "[render-campaign] public-dir=$PUBLIC_DIR"
fi
if [[ -n "$RENDER_CONCURRENCY" ]]; then
  echo "[render-campaign] concurrency=$RENDER_CONCURRENCY"
fi
echo "[render-campaign] rendering master -> $MASTER_OUT"
npx remotion render "$ENTRY_POINT" "$COMPOSITION_ID" "$MASTER_OUT" \
  --codec=h264 \
  "${REMOTION_BROWSER_ARGS[@]}" \
  "${REMOTION_PUBLIC_ARGS[@]}" \
  "${REMOTION_RENDER_ARGS[@]}" \
  --props="$PROPS_JSON"

echo "[render-campaign] rendering preview -> $PREVIEW_OUT"
npx remotion render "$ENTRY_POINT" "$COMPOSITION_ID" "$PREVIEW_OUT" \
  --codec=h264 \
  --scale=0.5 \
  "${REMOTION_BROWSER_ARGS[@]}" \
  "${REMOTION_PUBLIC_ARGS[@]}" \
  "${REMOTION_RENDER_ARGS[@]}" \
  --props="$PROPS_JSON"

echo "[render-campaign] exporting stills"
npx remotion still "$ENTRY_POINT" "$COMPOSITION_ID" "$STILLS_DIR/cover-frame-120.png" \
  --frame=120 \
  "${REMOTION_BROWSER_ARGS[@]}" \
  "${REMOTION_PUBLIC_ARGS[@]}" \
  --props="$PROPS_JSON"
npx remotion still "$ENTRY_POINT" "$COMPOSITION_ID" "$STILLS_DIR/mid-frame-540.png" \
  --frame=540 \
  "${REMOTION_BROWSER_ARGS[@]}" \
  "${REMOTION_PUBLIC_ARGS[@]}" \
  --props="$PROPS_JSON"
npx remotion still "$ENTRY_POINT" "$COMPOSITION_ID" "$STILLS_DIR/end-frame-1230.png" \
  --frame=1230 \
  "${REMOTION_BROWSER_ARGS[@]}" \
  "${REMOTION_PUBLIC_ARGS[@]}" \
  --props="$PROPS_JSON"

echo "[render-campaign] done"
echo "master=$MASTER_OUT"
echo "preview=$PREVIEW_OUT"
echo "stills=$STILLS_DIR"
