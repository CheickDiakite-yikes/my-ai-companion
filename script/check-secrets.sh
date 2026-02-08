#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-staged}"
FILES=()

if [[ "$MODE" == "all" ]]; then
  while IFS= read -r file; do
    FILES+=("$file")
  done < <(git ls-files)
elif [[ "$MODE" == "staged" ]]; then
  while IFS= read -r file; do
    FILES+=("$file")
  done < <(git diff --cached --name-only --diff-filter=ACM)
else
  echo "Usage: bash script/check-secrets.sh [staged|all]"
  exit 2
fi

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "No files to scan."
  exit 0
fi

is_binary_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    return 1
  fi
  if grep -Iq . "$file"; then
    return 1
  fi
  return 0
}

should_skip_file() {
  local file="$1"

  case "$file" in
    attached_assets/*) return 0 ;;
    client/src/assets/*) return 0 ;;
    client/public/*) return 0 ;;
    package-lock.json) return 0 ;;
    .env.example) return 0 ;;
  esac

  return 1
}

is_false_positive_line() {
  local line="$1"
  if [[ "$line" == *"secret-scan:allow"* ]]; then
    return 0
  fi
  if [[ "$line" =~ (example|placeholder|replace-with|your-api-key|changeme|dummy|test-only|sample) ]]; then
    return 0
  fi
  if [[ "$line" == *"process.env."* ]]; then
    return 0
  fi
  if [[ "$line" == *"\${{"* ]]; then
    return 0
  fi
  return 1
}

PATTERNS=(
  'AIza[0-9A-Za-z_-]{30,}'
  'sk-[A-Za-z0-9]{20,}'
  'auth_tokens/[A-Za-z0-9_-]{24,}'
  '-----BEGIN (RSA|EC|OPENSSH|DSA|PGP|PRIVATE) KEY-----'
  '(^|[^A-Z0-9_])(GEMINI_API_KEY|GOOGLE_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|SESSION_SECRET)[[:space:]]*=[[:space:]]*[^$[:space:]][^[:space:]]{8,}'
  '^[A-Z0-9_]*(API_KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*=[^[:space:]]{16,}$'
)

FOUND=0

for file in "${FILES[@]}"; do
  if should_skip_file "$file"; then
    continue
  fi
  if is_binary_file "$file"; then
    continue
  fi
  if [[ ! -f "$file" ]]; then
    continue
  fi

  for pattern in "${PATTERNS[@]}"; do
    while IFS= read -r match; do
      if [[ -z "$match" ]]; then
        continue
      fi
      content="${match#*:}"
      content="${content#*:}"
      if is_false_positive_line "$content"; then
        continue
      fi
      echo "Potential secret detected: $file:${match%%:*}"
      FOUND=1
    done < <(grep -nE -- "$pattern" "$file" || true)
  done
done

if [[ "$FOUND" -ne 0 ]]; then
  echo
  echo "Secret scan failed. Remove secrets or mark intentional lines with 'secret-scan:allow'."
  exit 1
fi

echo "Secret scan passed."
