#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(pwd)}"
OUT_DIR="${2:-$ROOT_DIR/output/remotion}"
MASTER_IN="${3:-$OUT_DIR/zeeme-orbit-of-you.mp4}"
SOCIAL_DIR="$OUT_DIR/social"

mkdir -p "$SOCIAL_DIR"

if [[ ! -f "$MASTER_IN" ]]; then
  echo "[social-cuts] master video not found: $MASTER_IN" >&2
  echo "[social-cuts] run render_campaign.sh first" >&2
  exit 2
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "[social-cuts] ffmpeg is required for social cut generation" >&2
  exit 2
fi

echo "[social-cuts] source=$MASTER_IN"

# 9:16 master copy (Stories/Reels/TikTok)
cp "$MASTER_IN" "$SOCIAL_DIR/zeeme-orbit-9x16.mp4"

# 1:1 square cut (feed posts)
ffmpeg -y -i "$MASTER_IN" \
  -vf "crop=1080:1080:0:420,format=yuv420p" \
  -c:v libx264 -preset medium -crf 20 -movflags +faststart \
  "$SOCIAL_DIR/zeeme-orbit-1x1.mp4" >/dev/null 2>&1

# 4:5 portrait cut (Instagram feed)
ffmpeg -y -i "$MASTER_IN" \
  -vf "crop=1080:1350:0:285,format=yuv420p" \
  -c:v libx264 -preset medium -crf 20 -movflags +faststart \
  "$SOCIAL_DIR/zeeme-orbit-4x5.mp4" >/dev/null 2>&1

# Stills for thumbnails and ad variants
ffmpeg -y -ss 00:00:03 -i "$MASTER_IN" -frames:v 1 "$SOCIAL_DIR/thumb-3s.png" >/dev/null 2>&1
ffmpeg -y -ss 00:00:12 -i "$MASTER_IN" -frames:v 1 "$SOCIAL_DIR/thumb-12s.png" >/dev/null 2>&1
ffmpeg -y -ss 00:00:25 -i "$MASTER_IN" -frames:v 1 "$SOCIAL_DIR/thumb-25s.png" >/dev/null 2>&1

echo "[social-cuts] done"
echo "outputs:"
echo "  $SOCIAL_DIR/zeeme-orbit-9x16.mp4"
echo "  $SOCIAL_DIR/zeeme-orbit-1x1.mp4"
echo "  $SOCIAL_DIR/zeeme-orbit-4x5.mp4"
echo "  $SOCIAL_DIR/thumb-3s.png"
echo "  $SOCIAL_DIR/thumb-12s.png"
echo "  $SOCIAL_DIR/thumb-25s.png"
