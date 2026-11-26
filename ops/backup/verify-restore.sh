#!/usr/bin/env bash
# MultiStore post-restore verification (spec 22.2 R-7, procedure V-05 step 3).
#
# Usage: verify-restore.sh MANIFEST TARGET_DB
#
# Checks, against the restored copy:
#   1. Row counts per table equal the export manifest.
#   2. Grants, column grants, policies, RLS flags and UUID column snapshots equal
#      the snapshots taken at export time (the 6.4/6.6 privilege surface).
#   3. Readiness: a connection as multistore_app succeeds (APP_PASSWORD from the
#      secret store, environment only).
#
# MANIFEST is the unencrypted manifest written by export.sh; the snapshot files
# must sit next to it (decrypt with `age --decrypt` first if exported --encrypt).
# PG* env selects the operator/superuser connection; the checks run on TARGET_DB.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-snapshot.sh
. "$HERE/lib-snapshot.sh"

MANIFEST="${1:?usage: verify-restore.sh MANIFEST TARGET_DB}"
TARGET="${2:?target database name}"
: "${PGHOST:?set PGHOST, PGPORT, PGUSER in the environment}"
: "${PGUSER:?set PGUSER (operator/superuser)}"
: "${APP_PASSWORD:?set APP_PASSWORD from the secret store for the readiness check}"

BASE="${MANIFEST%.manifest.txt}"
[ -f "$MANIFEST" ] || { echo "verify: manifest not found: $MANIFEST"; exit 1; }
[ -f "$BASE.grants.txt" ] || {
  echo "verify: source snapshots not found next to the manifest (encrypted? run age --decrypt first)"
  exit 1
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "verify: row counts vs manifest"
grep -E '^  .+: [0-9]+$' "$MANIFEST" | sed 's/^  //' | while IFS=': ' read -r t c; do
  actual="$(psql -tAc "SELECT count(*) FROM public.\"$t\"" "$TARGET")"
  if [ "$actual" != "$c" ]; then
    echo "  MISMATCH $t: manifest=$c restored=$actual" | tee -a "$TMP/fail"
  fi
done

echo "verify: snapshot diffs (grants, column grants, policies, RLS, UUID)"
PGDATABASE="$TARGET" write_snapshots "$TMP/snap"
for k in grants column-grants policies rls uuid; do
  if ! diff -u "$BASE.$k.txt" "$TMP/snap.$k.txt" > "$TMP/diff.$k"; then
    echo "  MISMATCH $k:"
    cat "$TMP/diff.$k"
    touch "$TMP/fail"
  fi
done

echo "verify: readiness as multistore_app"
if ! PGPASSWORD="$APP_PASSWORD" psql -h "$PGHOST" -p "${PGPORT:-5432}" \
       -U multistore_app -d "$TARGET" -tAc "SELECT 1" >/dev/null; then
  echo "  MISMATCH readiness: multistore_app cannot connect"
  touch "$TMP/fail"
fi

if [ -e "$TMP/fail" ]; then
  echo "verify: FAILED"
  exit 1
fi
echo "verify: all R-7 checks passed for $TARGET"
