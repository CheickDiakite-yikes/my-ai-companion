#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(pwd)}"
cd "$ROOT_DIR"

pass() { printf "[PASS] %s\n" "$1"; }
warn() { printf "[WARN] %s\n" "$1"; }
fail() { printf "[FAIL] %s\n" "$1"; }

HAS_FAIL=0
HAS_WARN=0

check_file() {
  local file="$1"
  local label="$2"
  if [[ -f "$file" ]]; then
    pass "$label ($file)"
  else
    fail "$label missing ($file)"
    HAS_FAIL=1
  fi
}

check_opt_file() {
  local file="$1"
  local label="$2"
  if [[ -f "$file" ]]; then
    pass "$label ($file)"
  else
    warn "$label not found ($file)"
    HAS_WARN=1
  fi
}

echo "[testflight-audit] root=$ROOT_DIR"

echo "\n== Core project files =="
check_file "package.json" "Node project"
check_opt_file "app.json" "Expo app config"
check_opt_file "app.config.ts" "Expo TS app config"
check_opt_file "eas.json" "EAS build profiles"
check_opt_file "ios/Podfile" "Native iOS directory"

echo "\n== Release and security gates =="
if [[ -f "script/check-secrets.sh" ]]; then
  pass "Secret scan script present"
else
  fail "Secret scan script missing"
  HAS_FAIL=1
fi

if rg -n "\"check\"\s*:\s*\"tsc\"" package.json >/dev/null 2>&1; then
  pass "Typecheck script configured"
else
  warn "Typecheck script not detected"
  HAS_WARN=1
fi

if [[ -f "client/public/favicon.png" ]]; then
  pass "Favicon present"
else
  warn "Favicon missing"
  HAS_WARN=1
fi

echo "\n== Recommendation =="
if [[ -f "app.json" || -f "app.config.ts" || -f "eas.json" ]]; then
  echo "Detected Expo/EAS signals. Native TestFlight path is available."
else
  warn "No Expo/EAS config detected. Current repo looks web-first."
  echo "Recommended next step: establish Expo wrapper or native migration plan before TestFlight build."
  HAS_WARN=1
fi

echo "\n== Summary =="
if [[ "$HAS_FAIL" -ne 0 ]]; then
  echo "Status: FAIL"
  exit 2
fi

if [[ "$HAS_WARN" -ne 0 ]]; then
  echo "Status: WARN"
  exit 0
fi

echo "Status: PASS"
