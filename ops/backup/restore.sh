#!/usr/bin/env bash
# MultiStore restore rehearsal (spec 22.2 R-5/R-6, procedure V-05).
#
# Usage: restore.sh DUMP TARGET_DB [--create-roles]
#
# Restores an export into a FRESH database only. R-5: never into an existing or
# live database — the script refuses if TARGET_DB already exists.
#
# Connection comes from PG* env for the operator/superuser (maintenance database
# postgres via PGDATABASE). Role handling (R-6: a dump carries no role passwords):
#   --create-roles        create the three roles if missing AND reset their passwords
#   RESET_ROLE_PASSWORDS=1  only reset passwords on existing roles
# Both read OWNER_PASSWORD / APP_PASSWORD / ADMIN_PASSWORD from the environment,
# supplied from the secret store at run time. Values never touch disk or git.
set -euo pipefail

DUMP="${1:?usage: restore.sh DUMP TARGET_DB [--create-roles]}"
TARGET="${2:?target database name}"
ROLES_FLAG="${3:-}"
: "${PGHOST:?set PGHOST, PGPORT, PGUSER, PGDATABASE in the environment}"
: "${PGUSER:?set PGUSER (operator/superuser)}"
: "${PGDATABASE:=postgres}"

[ -f "$DUMP" ] || { echo "restore: dump not found: $DUMP"; exit 1; }

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

psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$TARGET\""
pg_restore --no-password --exit-on-error --dbname="$TARGET" "$DUMP"
echo "restore: $DUMP restored into fresh database $TARGET"
echo "restore: next step: verify-restore.sh <manifest> $TARGET"
