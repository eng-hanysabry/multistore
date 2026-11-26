#!/usr/bin/env bash
# MultiStore logical export (decision D2 option A; spec 22.2 R-3/R-4).
#
# Usage: export.sh OUT_DIR [--encrypt]
#
# Connection and credentials come from the environment (PGHOST, PGPORT, PGUSER,
# PGPASSWORD or a .pgpass entry), exactly like psql/pg_dump. Nothing is hardcoded.
# Run as the operator/superuser role: FORCE RLS binds even multistore_owner, and the
# information_schema privilege views show each role only its own grants, so row
# counts and snapshots taken as any other role are silently incomplete.
#
# --encrypt seals the dump, manifest and snapshots with `age --passphrase`
# (spec R-4: encrypted before leaving the operator machine). age prompts for the
# passphrase; it is never read from a file, argument or variable by this script.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-snapshot.sh
. "$HERE/lib-snapshot.sh"

OUT_DIR="${1:?usage: export.sh OUT_DIR [--encrypt]}"
ENCRYPT="${2:-}"
: "${PGHOST:?set PGHOST, PGPORT, PGUSER, PGDATABASE in the environment}"
: "${PGUSER:?set PGUSER}"
: "${PGDATABASE:?set PGDATABASE}"

mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASE="$OUT_DIR/multistore-$STAMP"
DUMP="$BASE.dump"
MANIFEST="$BASE.manifest.txt"

echo "export: pg_dump of $PGDATABASE on $PGHOST as $PGUSER"
pg_dump --format=custom --file="$DUMP" "$PGDATABASE"

{
  echo "database: $PGDATABASE"
  echo "host: $PGHOST"
  echo "role: $PGUSER"
  echo "exported_at_utc: $STAMP"
  echo "pg_dump: $(pg_dump --version)"
  echo "server: $(psql -tAc 'show server_version')"
  echo "dump_sha256: $(sha256sum "$DUMP" | awk '{print $1}')"
  echo "row_counts:"
  psql -tAc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1" |
    while read -r t; do
      printf '  %s: %s\n' "$t" "$(psql -tAc "SELECT count(*) FROM public.\"$t\"")"
    done
} > "$MANIFEST"

write_snapshots "$BASE"

if [ "$ENCRYPT" = "--encrypt" ]; then
  command -v age >/dev/null 2>&1 || { echo "export: age is not installed"; exit 1; }
  for f in "$DUMP" "$MANIFEST" "$BASE.grants.txt" "$BASE.column-grants.txt" \
           "$BASE.policies.txt" "$BASE.rls.txt" "$BASE.uuid.txt"; do
    age --passphrase --output "$f.age" "$f"
    rm -f "$f"
  done
  echo "export: encrypted with age --passphrase (passphrase prompted, never stored)"
fi
echo "export: done -> $BASE.*"
