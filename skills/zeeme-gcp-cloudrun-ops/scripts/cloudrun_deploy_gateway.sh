#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-}"
REGION="${2:-us-central1}"
SERVICE="${3:-zeeme-morning-brief-gcp}"
MODEL="${4:-gemini-2.5-flash}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "Usage: cloudrun_deploy_gateway.sh <project-id> [region] [service] [model]"
  exit 1
fi

gcloud run deploy "$SERVICE" \
  --source ./services/morning-brief-gcp \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --allow-unauthenticated \
  --set-env-vars "MORNING_BRIEF_GCP_MODEL=$MODEL" \
  --set-secrets "GEMINI_API_KEY=GEMINI_API_KEY:latest" # secret-scan:allow

SERVICE_URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)')"
echo "Service URL: $SERVICE_URL"
