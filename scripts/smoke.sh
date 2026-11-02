#!/bin/sh
# Smoke check for a running shop-sut. POSIX sh + curl; works on macOS, Linux, Git Bash.
# Usage: scripts/smoke.sh [path/to/sut.env]
set -eu

ENV_FILE=${1:-.generated/sut.env}
if [ ! -f "$ENV_FILE" ]; then
  echo "smoke: $ENV_FILE not found. Start the stand with 'make up' first." >&2
  exit 2
fi
# shellcheck disable=SC1090
. "$ENV_FILE"

fails=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s (%s)\n' "$1" "$2"; fails=$((fails + 1)); }

status() { # status <url> [curl args...] -> prints HTTP status code
  # The body is printed and dropped with tail instead of `-o /dev/null`, which
  # a Windows build of curl cannot open.
  url=$1; shift
  out=$(curl -sS -w '
%{http_code}' --max-time 15 "$@" "$url" 2>/dev/null) || out=000
  printf '%s
' "$out" | tail -n 1
}

# 1. Backend health
code=$(status "$SUT_BACKEND_URL/health")
if [ "$code" = 200 ]; then pass "backend /health returns 200"; else fail "backend /health returns 200" "got $code"; fi

# 2. Store API lists qa-tee with the publishable key
body=$(curl -sS --max-time 15 -H "x-publishable-api-key: $SUT_PUBLISHABLE_KEY" \
  "$SUT_BACKEND_URL/store/products?handle=qa-tee&fields=id,handle,title" || true)
case "$body" in
  *'"handle":"qa-tee"'*) pass "store API returns qa-tee with publishable key" ;;
  *) fail "store API returns qa-tee with publishable key" "body: $(printf '%s' "$body" | cut -c1-120)" ;;
esac

# 3. Store API rejects a request without the key
code=$(status "$SUT_BACKEND_URL/store/products")
case "$code" in
  4??) pass "store API without publishable key is rejected ($code)" ;;
  *) fail "store API without publishable key is rejected" "got $code" ;;
esac

# 4. Admin login (email/password auth provider)
body=$(curl -sS --max-time 15 -H 'content-type: application/json' \
  -d "{\"email\":\"$SUT_ADMIN_EMAIL\",\"password\":\"$SUT_ADMIN_PASSWORD\"}" \
  "$SUT_BACKEND_URL/auth/user/emailpass" || true)
case "$body" in
  *'"token":"'*) pass "admin login returns a token" ;;
  *) fail "admin login returns a token" "body: $(printf '%s' "$body" | cut -c1-120)" ;;
esac

# 5. Storefront renders the QA product page, and its local image is actually served
page=$(curl -sS --max-time 30 "$SUT_STOREFRONT_URL/$SUT_STOREFRONT_COUNTRY/products/qa-tee" || true)
case "$page" in
  *'QA Tee'*) pass "storefront product page shows QA Tee" ;;
  *) fail "storefront product page shows QA Tee" "title not found in HTML" ;;
esac

# 6. The product image is local to this stand: no test should depend on an external CDN.
status=$(curl -sS --max-time 30 -o /dev/null -w '%{http_code}' "$SUT_STOREFRONT_URL/qa/qa-tee.png" || true)
case "$status" in
  200) pass "storefront serves the local QA product image" ;;
  *) fail "storefront serves the local QA product image" "GET /qa/qa-tee.png -> $status" ;;
esac

if [ "$fails" -gt 0 ]; then
  echo "smoke: $fails check(s) failed" >&2
  exit 1
fi
echo "smoke: all checks passed"
