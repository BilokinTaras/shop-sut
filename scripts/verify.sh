#!/bin/sh
# Proves the claims this repository makes about the stand, and writes the evidence to
# docs/verification/<date>.md so a reader does not have to take the README's word for it.
#
#   1. a fresh stand comes up and passes the smoke checks;
#   2. the bootstrap is idempotent: a second run changes no row counts;
#   3. the qa_readonly role really is read-only.
#
# Usage: sh scripts/verify.sh            # reuses the running stand
#        FRESH=1 sh scripts/verify.sh    # `make reset` first (wipes the volumes), the honest version
set -eu

cd "$(dirname "$0")/.."
GENERATED=.generated
OUT_DIR=docs/verification
STAMP=$(date +%Y-%m-%d)
OUT="$OUT_DIR/$STAMP.md"
mkdir -p "$OUT_DIR"

psql_count() {
  docker compose exec -T postgres psql -U postgres -d medusa -tAc "$1" | tr -d '\r'
}
elapsed() { echo "$(( $(date +%s) - $1 ))s"; }

counts_query="select
  (select count(*) from product) || ' products, ' ||
  (select count(*) from product_variant) || ' variants, ' ||
  (select count(*) from region) || ' regions, ' ||
  (select count(*) from product_collection) || ' collections, ' ||
  (select count(*) from \"user\") || ' admin users'"

start=$(date +%s)
if [ "${FRESH:-0}" = "1" ]; then
  make reset >/dev/null
  mode="make reset (volumes wiped, images cached)"
else
  make up >/dev/null
  mode="make up on an existing stand"
fi
up_time=$(elapsed "$start")

start=$(date +%s)
sh scripts/smoke.sh > "$OUT_DIR/.smoke.log" 2>&1 || true
smoke_time=$(elapsed "$start")
smoke_pass=$(grep -c '^PASS' "$OUT_DIR/.smoke.log" || true)
smoke_fail=$(grep -c '^FAIL' "$OUT_DIR/.smoke.log" || true)

before=$(psql_count "$counts_query")
start=$(date +%s)
make bootstrap >/dev/null
second_time=$(elapsed "$start")
after=$(psql_count "$counts_query")
[ "$before" = "$after" ] && idempotent="yes" || idempotent="NO"

# The read-only role must fail on write and on DDL; `|| true` keeps the script going so both are reported.
ro_url=$(grep '^SUT_DB_READONLY_URL=' "$GENERATED/sut.env" | cut -d= -f2-)
ro_update=$(docker compose exec -T postgres psql "$(echo "$ro_url" | sed 's|@[^/]*/|@localhost:5432/|')" \
  -tAc 'update product set title = title' 2>&1 | head -1 | tr -d '\r' || true)
ro_create=$(docker compose exec -T postgres psql "$(echo "$ro_url" | sed 's|@[^/]*/|@localhost:5432/|')" \
  -tAc 'create table qa_probe(x int)' 2>&1 | head -1 | tr -d '\r' || true)

versions=$(docker compose exec -T medusa node -p "require('@medusajs/medusa/package.json').version" | tr -d '\r')
docker_version=$(docker version --format '{{.Server.Version}}')
commit=$(git rev-parse --short HEAD)

cat > "$OUT" <<EOF
# Stand verification — $STAMP

Produced by \`sh scripts/verify.sh\` (\`FRESH=1\` wipes the volumes first). Re-run it after any change to
the stand; the README links to the newest file here instead of quoting numbers from memory.

| Item | Value |
|---|---|
| Commit | \`$commit\` |
| Mode | $mode |
| Host | $(uname -s) $(uname -m), Docker $docker_version |
| Medusa | $versions |

## 1. The stand starts and answers

| Step | Result |
|---|---|
| Start | $up_time |
| Smoke checks | **$smoke_pass passed, $smoke_fail failed** in $smoke_time |

\`\`\`
$(cat "$OUT_DIR/.smoke.log")
\`\`\`

## 2. The bootstrap is idempotent

A second \`make bootstrap\` on the same database took $second_time and left the row counts unchanged:
**$idempotent**.

| When | Row counts |
|---|---|
| Before the second run | $before |
| After the second run | $after |

## 3. The read-only role cannot write

\`\`\`
update product set title = title   -> $ro_update
create table qa_probe(x int)       -> $ro_create
\`\`\`
EOF
rm -f "$OUT_DIR/.smoke.log"
echo "verify: wrote $OUT (smoke $smoke_pass/$((smoke_pass + smoke_fail)), idempotent=$idempotent)"

# Fail when any promise is broken, so CI can use this script as a gate, not just as a report.
status=0
if [ "$smoke_fail" -ne 0 ] || [ "$smoke_pass" -eq 0 ]; then echo "verify: smoke checks failed" >&2; status=1; fi
[ "$idempotent" = yes ] || { echo "verify: second bootstrap changed row counts" >&2; status=1; }
case "$ro_update" in *ERROR*) ;; *) echo "verify: qa_readonly could UPDATE" >&2; status=1 ;; esac
case "$ro_create" in *ERROR*) ;; *) echo "verify: qa_readonly could CREATE TABLE" >&2; status=1 ;; esac
exit "$status"
