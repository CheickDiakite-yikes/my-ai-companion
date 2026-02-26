#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-}"
REGION="${2:-us-central1}"
SERVICE="${3:-zeeme-morning-brief-gcp}"
TIMEZONE="${4:-America/New_York}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "Usage: cloudrun_smoke.sh <project-id> [region] [service] [timezone]"
  exit 1
fi

SERVICE_URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)')"

echo "Service URL: $SERVICE_URL"
echo
echo "== /healthz =="
curl -si "$SERVICE_URL/healthz" | sed -n '1,40p'
echo
echo "== /v1/brief/news =="
curl -si "$SERVICE_URL/v1/brief/news" \
  -H "content-type: application/json" \
  -d "{\"timezone\":\"$TIMEZONE\"}" | sed -n '1,80p'
