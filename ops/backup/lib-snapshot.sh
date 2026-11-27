# Shared snapshot queries and role checks for export and restore verification
# (spec 22.2 R-7; changes per Telegram 26530265 items 2A and 3.4/3.5).
# Sourced by export.sh, restore.sh and verify-restore.sh; not executed directly.
#
# Requires PG* env for psql with a superuser/operator connection. The
# information_schema privilege views show each role only its own grants, so a
# snapshot taken as multistore_owner (or any lesser role) is silently incomplete
# and missing rows are NEVER proof that privileges do not exist.
#
# write_snapshots PREFIX writes six files:
#   PREFIX.{grants,column-grants,policies,rls,uuid,default-acl}.txt
# The grants snapshots include the Supabase platform roles (anon, authenticated,
# service_role) so a restored database can be checked for zero unintended
# privileges on application tables. On a server without those roles the filter
# simply yields no rows for them.

write_snapshots() {
  local prefix="$1"
  psql -tA -o "${prefix}.grants.txt" -c "
    SELECT grantee, table_name, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee IN ('multistore_owner', 'multistore_app', 'multistore_admin',
                      'PUBLIC', 'anon', 'authenticated', 'service_role')
    ORDER BY 1, 2, 3"
  psql -tA -o "${prefix}.column-grants.txt" -c "
    SELECT grantee, table_name, column_name, privilege_type
    FROM information_schema.column_privileges
    WHERE table_schema = 'public'
      AND grantee IN ('multistore_owner', 'multistore_app', 'multistore_admin',
                      'anon', 'authenticated', 'service_role')
    ORDER BY 1, 2, 3, 4"
  psql -tA -o "${prefix}.policies.txt" -c "
    SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY 1, 2, 3"
  psql -tA -o "${prefix}.rls.txt" -c "
    SELECT n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY 1, 2"
  psql -tA -o "${prefix}.uuid.txt" -c "
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND (column_name = 'id' OR column_name LIKE '%\_id')
    ORDER BY 1, 2"
  psql -tA -o "${prefix}.default-acl.txt" -c "
    SELECT r.rolname, d.defaclobjtype, COALESCE(n.nspname, ''), d.defaclacl::text
    FROM pg_default_acl d
    JOIN pg_roles r ON r.oid = d.defaclrole
    LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
    ORDER BY 1, 2, 3"
}

# verify_role_attributes: fails unless the three application roles exist with
# exactly the approved attributes (Telegram 26530265 item 3.4):
#   owner/app: LOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, INHERIT, connlimit -1
#   admin:     same but NOINHERIT and CONNECTION LIMIT 3
# Never selects or prints passwords. Returns non-zero on any mismatch.
verify_role_attributes() {
  local expected line rc=0
  for role in multistore_owner multistore_app multistore_admin; do
    case "$role" in
      multistore_admin) expected='t|f|f|f|f|f|3' ;;
      *)                expected='t|f|f|f|f|t|-1' ;;
    esac
    line="$(psql -tAc "
      SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolconnlimit
      FROM pg_roles WHERE rolname = '$role'")"
    if [ -z "$line" ]; then
      echo "  role-check FAIL: $role does not exist"
      rc=1
    elif [ "$line" != "$expected" ]; then
      echo "  role-check FAIL: $role attributes are [$line], expected [$expected]"
      rc=1
    else
      echo "  role-check PASS: $role (LOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, $( [ "$role" = multistore_admin ] && echo 'NOINHERIT, CONNLIMIT 3' || echo 'INHERIT, CONNLIMIT -1'))"
    fi
  done
  return $rc
}
