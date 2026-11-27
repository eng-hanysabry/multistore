#!/usr/bin/env bash
# MultiStore post-restore verification (spec 22.2 R-7, procedure V-05 step 3;
# changes per Telegram 26530265 items 3.1, 3.5, 3.6, 3.7).
#
# Usage: verify-restore.sh MANIFEST TARGET_DB
#
# Checks, against the restored copy, each one reporting PASS or FAIL:
#   1. SHA-256 of the dump next to the manifest equals the manifest's dump_sha256.
#   2. Row counts per table equal the manifest (fails when manifest entries are
#      missing, so an empty manifest can never silently pass).
#   3. Snapshot diffs are empty for: table grants (incl. anon, authenticated,
#      service_role), column grants, policies, RLS flags, UUID columns and
#      default privileges (pg_default_acl). Required snapshot files that are
#      missing or impossibly empty fail the check: an information_schema view
#      shows each role only its own grants, so an empty grants/policies/RLS
#      snapshot means the export ran without sufficient visibility, not that
#      no privileges exist.
#   4. Role attributes match the approved set (LOGIN, NOSUPERUSER, NOBYPASSRLS,
#      NOCREATEDB, NOCREATEROLE, INHERIT/NOINHERIT, connection limit).
#   5. Readiness: a connection as multistore_app succeeds (APP_PASSWORD from
#      the secret store, environment only).
#
# MANIFEST is the manifest from the extracted export archive; the dump and the
# six snapshot files must sit next to it with the same base name.
# PG* env selects the operator/superuser connection; checks run on TARGET_DB.
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-snapshot.sh
. "$HERE/lib-snapshot.sh"

MANIFEST="${1:?usage: verify-restore.sh MANIFEST TARGET_DB}"
TARGET="${2:?target database name}"
: "${PGHOST:?set PGHOST, PGPORT, PGUSER in the environment}"
: "${PGUSER:?set PGUSER (operator/superuser)}"
: "${APP_PASSWORD:?set APP_PASSWORD from the secret store for the readiness check}"

BASE="${MANIFEST%.manifest.txt}"
[ -f "$MANIFEST" ] || { echo "verify: FAIL, manifest not found: $MANIFEST"; exit 1; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/multistore-verify.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() { echo "  FAIL: $1" | tee -a "$TMP/fail"; }

echo "check 1: dump SHA-256 vs manifest"
EXPECTED_SHA="$(grep -E '^dump_sha256: [0-9a-f]{64}$' "$MANIFEST" | awk '{print $2}')"
if [ -z "$EXPECTED_SHA" ]; then
  fail "manifest has no dump_sha256 entry"
elif [ ! -f "$BASE.dump" ]; then
  fail "dump file $BASE.dump not found next to the manifest"
else
  ACTUAL_SHA="$(sha256sum "$BASE.dump" | awk '{print $1}')"
  if [ "$ACTUAL_SHA" = "$EXPECTED_SHA" ]; then
    echo "  PASS: dump sha256 matches manifest"
  else
    fail "dump sha256 mismatch: manifest=$EXPECTED_SHA actual=$ACTUAL_SHA"
  fi
fi

echo "check 2: row counts vs manifest"
N_ENTRIES="$(grep -cE '^  .+: [0-9]+$' "$MANIFEST" || true)"
if [ "$N_ENTRIES" -eq 0 ]; then
  fail "manifest contains no row-count entries"
else
  N_OK=0
  while IFS=': ' read -r t c; do
    actual="$(psql -tAc "SELECT count(*) FROM public.\"$t\"" "$TARGET")"
    if [ "$actual" = "$c" ]; then
      N_OK=$((N_OK + 1))
    else
      echo "  FAIL: row count mismatch $t: manifest=$c restored=$actual" >> "$TMP/fail"
    fi
  done < <(grep -E '^  .+: [0-9]+$' "$MANIFEST" | sed 's/^  //')
  if [ "$N_OK" -eq "$N_ENTRIES" ]; then
    echo "  PASS: all $N_OK/$N_ENTRIES row counts match"
  else
    echo "  compared $N_ENTRIES manifest entries, $N_OK matched" | tee -a "$TMP/fail"
  fi
fi

echo "check 3: snapshot diffs"
for k in grants column-grants policies rls uuid default-acl; do
  SRC="$BASE.$k.txt"
  if [ ! -f "$SRC" ]; then
    fail "required snapshot file missing: $SRC"
    continue
  fi
  case "$k" in
    grants|policies|rls)
      if [ ! -s "$SRC" ]; then
        fail "snapshot $SRC is empty: a lesser-role export shows only its own grants, so empty means insufficient visibility, not no privileges"
        continue
      fi ;;
  esac
done
PGDATABASE="$TARGET" write_snapshots "$TMP/snap"
for k in grants column-grants policies rls uuid default-acl; do
  SRC="$BASE.$k.txt"
  [ -f "$SRC" ] || continue
  if [ -s "$SRC" ] || [ "$k" = column-grants ] || [ "$k" = default-acl ]; then
    if diff -u "$SRC" "$TMP/snap.$k.txt" > "$TMP/diff.$k"; then
      echo "  PASS: $k snapshot identical"
    else
      echo "  FAIL: $k snapshot differs:" | tee -a "$TMP/fail"
      cat "$TMP/diff.$k"
    fi
  fi
done

echo "check 4: role attributes"
if verify_role_attributes; then
  echo "  PASS: all role attributes verified"
else
  touch "$TMP/fail"
fi

echo "check 5: readiness as multistore_app"
if PGPASSWORD="$APP_PASSWORD" psql -h "$PGHOST" -p "${PGPORT:-5432}" \
     -U multistore_app -d "$TARGET" -tAc "SELECT 1" >/dev/null; then
  echo "  PASS: multistore_app connected to $TARGET"
else
  fail "readiness: multistore_app cannot connect to $TARGET"
fi

if [ -e "$TMP/fail" ]; then
  echo "verify: FAILED"
  exit 1
fi
echo "verify: all checks passed for $TARGET"
