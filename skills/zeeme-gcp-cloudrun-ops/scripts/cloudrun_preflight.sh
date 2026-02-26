#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-}"
REGION="${2:-us-central1}"
SERVICE="${3:-zeeme-morning-brief-gcp}"
BRANCH="${4:-main3}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "Usage: cloudrun_preflight.sh <project-id> [region] [service] [branch]"
  exit 1
fi

echo "== gcloud context =="
gcloud config get-value project
gcloud auth list

echo "== expected target =="
echo "PROJECT_ID=$PROJECT_ID"
echo "REGION=$REGION"
echo "SERVICE=$SERVICE"
echo "BRANCH=$BRANCH"

echo "== repo status =="
git rev-parse --abbrev-ref HEAD
git rev-parse --short HEAD

echo "== branch sync =="
git fetch origin
git checkout "$BRANCH"
git pull --ff-only

echo "== service files =="
ls services/morning-brief-gcp/package.json services/morning-brief-gcp/src/index.ts

echo "== secret check =="
gcloud secrets describe GEMINI_API_KEY --project "$PROJECT_ID" >/dev/null
echo "GEMINI_API_KEY secret exists."

echo "== cloud run service (if already deployed) =="
gcloud run services describe "$SERVICE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --format='value(status.url)' || true

echo "Preflight complete."
