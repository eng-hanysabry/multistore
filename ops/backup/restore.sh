#!/usr/bin/env bash
# MultiStore restore rehearsal (spec 22.2 R-5/R-6, procedure V-05;
# changes per Telegram 26530265 items 3.3 and 3.4).
#
# Usage: restore.sh DUMP TARGET_DB [--create-roles]
#
# Restores an export into a FRESH database only. R-5: never into an existing or
# live database — the script refuses if TARGET_DB already exists.
#
# Target safety:
# - TARGET_DB must match ^[a-z_][a-z0-9_]{0,62}$ and is double-quoted everywhere.
# - Unless ALLOW_REMOTE_RESTORE=1 is set explicitly, PGHOST must be a local
#   address (127.0.0.1, localhost, ::1 or a unix socket path). This blocks
#   accidental execution against a remote or production server.
# - Before any destructive operation the script prints the server identity
#   (version, address, port) and the target database name.
#
# Connection comes from PG* env for the operator/superuser. Role handling
# (R-6: a dump carries no role passwords):
#   --create-roles          create the three roles if missing AND reset passwords
#   RESET_ROLE_PASSWORDS=1  only reset passwords on existing roles
# Both read OWNER_PASSWORD / APP_PASSWORD / ADMIN_PASSWORD from the environment,
# supplied from the secret store at run time. After any role handling, and on
# every run, the role attributes are verified against the approved set
# (LOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, INHERIT/NOINHERIT,
# connection limit); any drift fails the script. Passwords never touch disk or git.
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-snapshot.sh
. "$HERE/lib-snapshot.sh"

DUMP="${1:?usage: restore.sh DUMP TARGET_DB [--create-roles]}"
TARGET="${2:?target database name}"
ROLES_FLAG="${3:-}"
: "${PGHOST:?set PGHOST, PGPORT, PGUSER, PGDATABASE in the environment}"
: "${PGUSER:?set PGUSER (operator/superuser)}"
: "${PGDATABASE:=postgres}"

[ -f "$DUMP" ] || { echo "restore: dump not found: $DUMP"; exit 1; }

if ! [[ "$TARGET" =~ ^[a-z_][a-z0-9_]{0,62}$ ]]; then
  echo "restore: invalid target database name '$TARGET' (expected ^[a-z_][a-z0-9_]{0,62}$)"
  exit 1
fi

if [ "${ALLOW_REMOTE_RESTORE:-0}" != "1" ]; then
  case "$PGHOST" in
    127.0.0.1|localhost|::1|/*) ;;
    *) echo "restore: refusing, PGHOST='$PGHOST' is not local. Set ALLOW_REMOTE_RESTORE=1 only for an approved remote rehearsal."; exit 1 ;;
  esac
fi

echo "restore: server identity:"
psql -tAc "SELECT '  version: ' || version()"
psql -tAc "SELECT '  address: ' || COALESCE(inet_server_addr()::text, '(unix socket)') || '  port: ' || COALESCE(inet_server_port()::text, '(socket)')"
echo "restore: target database: $TARGET (must not exist)"

if [ "$(psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$TARGET'")" = "1" ]; then
  echo "restore: refusing, database '$TARGET' already exists (R-5: never restore into a live database)"
  exit 1
fi

# Emits an idempotent CREATE-or-reset-password statement for one role.
# Single quotes in passwords are escaped for the SQL literal.
role_sql() {
  local role="$1" pwvar="$2" extra="$3" pw
  pw="${!pwvar:?set $pwvar from the secret store}"
  pw="${pw//\'/\'\'}"
  cat <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$role') THEN
    CREATE ROLE $role LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION $extra PASSWORD '$pw';
  ELSE
    ALTER ROLE $role PASSWORD '$pw';
  END IF;
END
\$\$;
SQL
}

if [ "$ROLES_FLAG" = "--create-roles" ] || [ "${RESET_ROLE_PASSWORDS:-0}" = "1" ]; then
  {
    role_sql multistore_owner OWNER_PASSWORD ""
    role_sql multistore_app APP_PASSWORD ""
    role_sql multistore_admin ADMIN_PASSWORD "NOINHERIT CONNECTION LIMIT 3"
  } | psql -v ON_ERROR_STOP=1 -f -
  echo "restore: roles present, passwords reset from the secret store (R-6)"
fi

echo "restore: verifying role attributes"
verify_role_attributes

psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$TARGET\""
pg_restore --no-password --exit-on-error --dbname="$TARGET" "$DUMP"
echo "restore: $DUMP restored into fresh database $TARGET"
echo "restore: next step: verify-restore.sh <manifest> $TARGET"
