-- READ-ONLY metadata inspection (IP-4 step 2). Run in the Supabase SQL editor.
-- Touches only catalog views. No user data. No INSERT/UPDATE/DELETE/ALTER/GRANT/REVOKE.
-- Query 1: privileges of the relevant roles on public tables
SELECT grantee, table_schema, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon','authenticated','service_role','multistore_app','multistore_admin','multistore_owner','PUBLIC')
ORDER BY table_name, grantee, privilege_type;

-- Query 2: default privileges
SELECT pg_get_userbyid(d.defaclrole) AS defined_for_role,
       n.nspname AS schema,
       d.defaclobjtype AS object_type,
       d.defaclacl::text AS acl
FROM pg_default_acl d
LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
ORDER BY 1, 2, 3;
