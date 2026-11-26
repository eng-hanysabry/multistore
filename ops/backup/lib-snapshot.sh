# Shared snapshot queries for export and restore verification (spec 22.2 R-7).
# Sourced by export.sh and verify-restore.sh; not executed directly.
# Requires PG* env for psql. Must be sourced with a superuser/operator connection:
# the information_schema privilege views show each role only its own grants, so a
# snapshot taken as any other role is silently incomplete.
#
# write_snapshots PREFIX writes five files: PREFIX.{grants,column-grants,policies,rls,uuid}.txt

write_snapshots() {
  local prefix="$1"
  psql -tA -o "${prefix}.grants.txt" -c "
    SELECT grantee, table_name, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee IN ('multistore_owner', 'multistore_app', 'multistore_admin', 'PUBLIC')
    ORDER BY 1, 2, 3"
  psql -tA -o "${prefix}.column-grants.txt" -c "
    SELECT grantee, table_name, column_name, privilege_type
    FROM information_schema.column_privileges
    WHERE table_schema = 'public'
      AND grantee IN ('multistore_owner', 'multistore_app', 'multistore_admin')
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
}
