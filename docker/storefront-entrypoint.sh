#!/bin/sh
# Writes the runtime publishable key and URLs into the prebuilt Next.js output,
# then starts the production server. Runs inside the Linux container only.
set -eu

KEY_FILE="${QA_GENERATED_DIR:-/generated}/publishable-key"
: "${QA_BACKEND_URL:?QA_BACKEND_URL is required}"
: "${QA_STOREFRONT_URL:?QA_STOREFRONT_URL is required}"

i=0
while [ ! -s "$KEY_FILE" ]; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "storefront: $KEY_FILE not found; run the bootstrap service first" >&2
    exit 1
  fi
  sleep 1
done
KEY=$(tr -d '\r\n' < "$KEY_FILE")

case "$KEY" in
  pk_*) ;;
  *) echo "storefront: unexpected key format in $KEY_FILE" >&2; exit 1 ;;
esac

# Start from the pristine build every time so a new key after a reset is applied.
rm -rf .next
cp -a .next-template .next
grep -rlZ -e pk_qa_build_placeholder_key -e qa-build-placeholder- .next \
  | xargs -0 -r sed -i \
      -e "s|pk_qa_build_placeholder_key|${KEY}|g" \
      -e "s|http://qa-build-placeholder-backend:9000|${QA_BACKEND_URL}|g" \
      -e "s|http://qa-build-placeholder-storefront:8000|${QA_STOREFRONT_URL}|g"

# next.config.js validates these at start-up as well, not only at build time.
export NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY="$KEY"
export NEXT_PUBLIC_MEDUSA_BACKEND_URL="$QA_BACKEND_URL"
export NEXT_PUBLIC_BASE_URL="$QA_STOREFRONT_URL"

echo "storefront: publishable key applied (${KEY%"${KEY#pk_????}"}...), backend ${QA_BACKEND_URL}"
exec node_modules/.bin/next start -p "${PORT}" -H 0.0.0.0
