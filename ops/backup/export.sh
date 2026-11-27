#!/usr/bin/env bash
# MultiStore logical export (decision D2 option A; spec 22.2 R-3/R-4;
# changes per Telegram 26530265 items 2B and 3.2).
#
# Usage: export.sh OUT_DIR [--encrypt]
#
# Produces ONE archive in OUT_DIR: multistore-<utc>.tar containing the dump,
# the manifest and all metadata snapshots. With --encrypt the archive is sealed
# once with `age --passphrase` (single prompt) into multistore-<utc>.tar.age and
# the plaintext archive is removed.
#
# Connection and credentials come from the environment (PGHOST, PGPORT, PGUSER,
# PGPASSWORD or a .pgpass entry). Run as the operator/superuser role: FORCE RLS
# binds even multistore_owner, and the information_schema privilege views show
# each role only its own grants, so row counts and snapshots taken as a lesser
# role are silently incomplete.
#
# Temporary artifacts live in a mktemp -d directory with umask 077 and are
# removed on success AND failure. Removal is ordinary filesystem deletion; no
# secure-erasure guarantee is claimed on SSD storage.
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-snapshot.sh
. "$HERE/lib-snapshot.sh"

OUT_DIR="${1:?usage: export.sh OUT_DIR [--encrypt]}"
ENCRYPT="${2:-}"
: "${PGHOST:?set PGHOST, PGPORT, PGUSER, PGDATABASE in the environment}"
: "${PGUSER:?set PGUSER}"
: "${PGDATABASE:?set PGDATABASE}"

if [ "$ENCRYPT" = "--encrypt" ]; then
  command -v age >/dev/null 2>&1 || { echo "export: --encrypt requested but age is not installed"; exit 1; }
fi

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/multistore-export.XXXXXX")"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="multistore-$STAMP"
DUMP="$STAGE/$NAME.dump"
MANIFEST="$STAGE/$NAME.manifest.txt"

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

write_snapshots "$STAGE/$NAME"

TAR="$OUT_DIR/$NAME.tar"
tar -C "$STAGE" -cf "$TAR" .
echo "export: archive $TAR ($(stat -c%s "$TAR") bytes), sha256 $(sha256sum "$TAR" | awk '{print $1}')"

if [ "$ENCRYPT" = "--encrypt" ]; then
  age --passphrase --output "$TAR.age" "$TAR"
  rm -f "$TAR"
  echo "export: encrypted once with age --passphrase -> $TAR.age"
fi
echo "export: done"
