-- IP-4: identity and tenancy (spec v4.9 sections 5.6, 6.2-6.7, 9, 19.4; schema design v3).
-- Applied by multistore_owner only, never postgres or service_role.
-- Schema review: Telegram 21435287; corrections A-D and approvals: Telegram 21512898.
-- No seeds here: test/seed data is loaded by the test harness, never by the migration.

CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  code text NOT NULL CHECK (code ~ '^[a-z0-9-]{3,40}$'),
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED','DELETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tenants_code_key ON tenants (code);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL CHECK (email = lower(email)),
  password_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING_VERIFICATION','ACTIVE','DISABLED')),
  is_super_admin boolean NOT NULL DEFAULT false,
  email_verified_at timestamptz,
  password_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (email);

CREATE TABLE memberships (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('MERCHANT')),
  status text NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX memberships_tenant_user_key ON memberships (tenant_id, user_id);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE auth_codes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  purpose text NOT NULL CHECK (purpose IN ('VERIFY_EMAIL','RESET_PASSWORD')),
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at <= created_at + interval '10 minutes')
);
CREATE INDEX auth_codes_user_purpose_idx ON auth_codes (user_id, purpose, created_at DESC);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason text CHECK (revoked_reason IN ('LOGOUT','REUSE_DETECTED','PASSWORD_CHANGED','ADMIN')),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 days')
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions(id),
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','ROTATED','REVOKED')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  session_expires_at timestamptz NOT NULL,
  replaced_by_id uuid REFERENCES refresh_tokens(id),
  CHECK (expires_at <= session_expires_at)
);
CREATE UNIQUE INDEX refresh_tokens_hash_key ON refresh_tokens (token_hash);
CREATE INDEX refresh_tokens_session_idx ON refresh_tokens (session_id);

CREATE TABLE audit_log (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  actor_role text,
  action text NOT NULL,
  tenant_id uuid,
  target_type text,
  target_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('ALLOWED','REJECTED')),
  request_id uuid,
  detail jsonb
);
CREATE INDEX audit_log_occurred_idx ON audit_log (occurred_at);
CREATE INDEX audit_log_tenant_idx ON audit_log (tenant_id, occurred_at);

-- D-S2 (approved 26 Nov, Telegram 21512898 item 2): plain SECURITY INVOKER trigger.
-- RLS cannot compare old and new row values; this is the database-level guard for
-- status / email_verified_at / is_super_admin. multistore_owner is exempt: its
-- operations are migrations and reviewed manual steps (STM-16).
CREATE OR REPLACE FUNCTION users_protect_sensitive() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER AS $f$
BEGIN
  IF current_user = 'multistore_owner' THEN
    RETURN NEW;
  END IF;
  IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
    RAISE EXCEPTION 'is_super_admin can never change via application roles';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.email_verified_at IS DISTINCT FROM OLD.email_verified_at THEN
    IF current_setting('app.role', true) IS DISTINCT FROM 'GUEST' THEN
      RAISE EXCEPTION 'status/email_verified_at change only inside the verification flow';
    END IF;
    IF NOT (OLD.status = 'PENDING_VERIFICATION' AND NEW.status = 'ACTIVE'
            AND NEW.email_verified_at IS NOT NULL) THEN
      RAISE EXCEPTION 'only PENDING_VERIFICATION -> ACTIVE with email_verified_at is allowed';
    END IF;
    -- A GUEST context alone is not proof of a valid code: require a recently consumed
    -- VERIFY_EMAIL code for this user (consumed in the same verification transaction).
    IF NOT EXISTS (SELECT 1 FROM auth_codes c
                   WHERE c.user_id = OLD.id AND c.purpose = 'VERIFY_EMAIL'
                     AND c.consumed_at IS NOT NULL
                     AND c.consumed_at > now() - interval '10 minutes') THEN
      RAISE EXCEPTION 'verification requires a consumed verification code';
    END IF;
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER users_protect_sensitive_trg BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION users_protect_sensitive();

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE auth_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

REVOKE ALL ON tenants, users, memberships, auth_codes, sessions, refresh_tokens, audit_log
  FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE multistore_owner IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE multistore_owner IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE multistore_owner IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM PUBLIC;

-- Supabase's platform roles exist on the real project but not in a vanilla CI database:
-- revoke per existing role only, so the same migration applies in both.
DO $rev$
DECLARE r text;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON tenants, users, memberships, auth_codes, sessions, refresh_tokens, audit_log FROM %I', r);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE multistore_owner IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE multistore_owner IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE multistore_owner IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
  END LOOP;
END $rev$;

-- Application role: minimum table and column rights (correction B: narrow UPDATE columns).
GRANT SELECT ON tenants TO multistore_app;
GRANT SELECT ON users TO multistore_app;
GRANT INSERT ON users TO multistore_app;
GRANT UPDATE (password_hash, status, email_verified_at, password_changed_at, updated_at)
  ON users TO multistore_app;
GRANT SELECT ON memberships TO multistore_app;
GRANT SELECT, INSERT ON auth_codes TO multistore_app;
GRANT UPDATE (attempts, consumed_at) ON auth_codes TO multistore_app;
GRANT SELECT, INSERT ON sessions TO multistore_app;
GRANT UPDATE (revoked_at, revoked_reason) ON sessions TO multistore_app;
GRANT SELECT, INSERT ON refresh_tokens TO multistore_app;
GRANT UPDATE (status, replaced_by_id) ON refresh_tokens TO multistore_app;
GRANT INSERT ON audit_log TO multistore_app;

-- Admin role: approved minimum Phase 1. No access to auth_codes, sessions,
-- refresh_tokens or password_hash. Audit history is read-only (SELECT, INSERT for
-- completeness of its own admin actions); only the owner prunes rows older than 90 days.
GRANT SELECT, INSERT, UPDATE ON tenants TO multistore_admin;
GRANT SELECT (id, email, status, created_at) ON users TO multistore_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON memberships TO multistore_admin;
GRANT SELECT, INSERT ON audit_log TO multistore_admin;

CREATE POLICY tenant_resolve ON tenants FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) IN ('GUEST','CUSTOMER','MERCHANT')
  AND code = NULLIF(current_setting('app.tenant_code', true), '')
  AND status = 'ACTIVE');
CREATE POLICY tenant_self ON tenants FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) IN ('CUSTOMER','MERCHANT')
  AND id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND status = 'ACTIVE');
CREATE POLICY tenants_admin_all ON tenants FOR ALL TO multistore_admin
  USING (true) WITH CHECK (true);

CREATE POLICY user_login_lookup ON users FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) = 'GUEST'
  AND email = NULLIF(current_setting('app.login_email', true), ''));
CREATE POLICY user_register ON users FOR INSERT TO multistore_app WITH CHECK (
  current_setting('app.role', true) = 'GUEST'
  AND status = 'PENDING_VERIFICATION' AND is_super_admin = false
  AND email = NULLIF(current_setting('app.login_email', true), ''));
CREATE POLICY user_auth_update ON users FOR UPDATE TO multistore_app
  USING (current_setting('app.role', true) = 'GUEST'
         AND email = NULLIF(current_setting('app.login_email', true), ''))
  WITH CHECK (current_setting('app.role', true) = 'GUEST'
              AND is_super_admin = false
              AND email = NULLIF(current_setting('app.login_email', true), ''));
CREATE POLICY user_self ON users FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) IN ('CUSTOMER','MERCHANT')
  AND id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY user_self_update ON users FOR UPDATE TO multistore_app
  USING (current_setting('app.role', true) IN ('CUSTOMER','MERCHANT')
         AND id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (current_setting('app.role', true) IN ('CUSTOMER','MERCHANT')
              AND is_super_admin = false
              AND id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY users_admin_read ON users FOR SELECT TO multistore_admin USING (true);

CREATE POLICY membership_self ON memberships FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) = 'MERCHANT'
  AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY membership_customer_self ON memberships FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) = 'CUSTOMER'
  AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY memberships_admin_all ON memberships FOR ALL TO multistore_admin
  USING (true) WITH CHECK (true);

CREATE POLICY code_auth ON auth_codes FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) = 'GUEST'
  AND EXISTS (SELECT 1 FROM users u WHERE u.id = auth_codes.user_id
              AND u.email = NULLIF(current_setting('app.login_email', true), '')));
CREATE POLICY code_auth_insert ON auth_codes FOR INSERT TO multistore_app WITH CHECK (
  current_setting('app.role', true) = 'GUEST'
  AND EXISTS (SELECT 1 FROM users u WHERE u.id = auth_codes.user_id
              AND u.email = NULLIF(current_setting('app.login_email', true), '')));
CREATE POLICY code_auth_update ON auth_codes FOR UPDATE TO multistore_app
  USING (current_setting('app.role', true) = 'GUEST'
         AND EXISTS (SELECT 1 FROM users u WHERE u.id = auth_codes.user_id
                     AND u.email = NULLIF(current_setting('app.login_email', true), '')))
  WITH CHECK (current_setting('app.role', true) = 'GUEST'
              AND EXISTS (SELECT 1 FROM users u WHERE u.id = auth_codes.user_id
                          AND u.email = NULLIF(current_setting('app.login_email', true), '')));

CREATE POLICY session_issue ON sessions FOR INSERT TO multistore_app WITH CHECK (
  current_setting('app.role', true) = 'GUEST'
  AND user_id = (SELECT u.id FROM users u WHERE u.email = NULLIF(current_setting('app.login_email', true), '')));
-- GUEST reads sessions only for the user it is authenticating as (app.login_email at
-- login) or the user a presented token resolved to (app.user_id, set in the same
-- transaction after the token lookup). Scope review (correction D): no other user's
-- rows are visible, no token material is exposed (token_hash lives in refresh_tokens),
-- and without either key the policy matches zero rows.
CREATE POLICY session_guest_lookup ON sessions FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) = 'GUEST'
  AND ( user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        OR user_id = (SELECT u.id FROM users u
                      WHERE u.email = NULLIF(current_setting('app.login_email', true), '')) ));
CREATE POLICY session_guest_revoke ON sessions FOR UPDATE TO multistore_app
  USING (current_setting('app.role', true) = 'GUEST'
         AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (current_setting('app.role', true) = 'GUEST'
              AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
              AND revoked_at IS NOT NULL);
CREATE POLICY session_self ON sessions FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) IN ('CUSTOMER','MERCHANT')
  AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY session_self_update ON sessions FOR UPDATE TO multistore_app
  USING (current_setting('app.role', true) IN ('CUSTOMER','MERCHANT')
         AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (current_setting('app.role', true) IN ('CUSTOMER','MERCHANT')
              AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- Correction A: outer columns qualified explicitly; the WITH CHECK proves the inserted
-- row's user_id and session_expires_at match the actual parent session row. References
-- only sessions/users, never refresh_tokens itself (no recursive RLS evaluation).
CREATE POLICY refresh_lookup ON refresh_tokens FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) = 'GUEST'
  AND token_hash = NULLIF(current_setting('app.token_hash', true), ''));
CREATE POLICY refresh_update ON refresh_tokens FOR UPDATE TO multistore_app
  USING (current_setting('app.role', true) = 'GUEST'
         AND token_hash = NULLIF(current_setting('app.token_hash', true), ''))
  WITH CHECK (current_setting('app.role', true) = 'GUEST'
              AND token_hash = NULLIF(current_setting('app.token_hash', true), ''));
CREATE POLICY refresh_issue ON refresh_tokens FOR INSERT TO multistore_app WITH CHECK (
  current_setting('app.role', true) = 'GUEST'
  AND EXISTS (SELECT 1 FROM sessions s
              WHERE s.id = refresh_tokens.session_id
                AND s.user_id = refresh_tokens.user_id
                AND s.expires_at = refresh_tokens.session_expires_at
                AND s.revoked_at IS NULL AND s.expires_at > now())
  AND ( refresh_tokens.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        OR refresh_tokens.user_id = (SELECT u.id FROM users u
                      WHERE u.email = NULLIF(current_setting('app.login_email', true), '')) ));

-- Owner policies: FORCE RLS binds the owner too, so reviewed manual operations
-- (STM-16) and the approved owner-only cleanup of expired auth codes/sessions
-- (7 days after expiry) need explicit policies. Seeds never run through these:
-- the test harness seeds as superuser.
CREATE POLICY users_owner_all ON users FOR ALL TO multistore_owner
  USING (true) WITH CHECK (true);
CREATE POLICY codes_owner_select ON auth_codes FOR SELECT TO multistore_owner USING (true);
CREATE POLICY codes_owner_cleanup ON auth_codes FOR DELETE TO multistore_owner
  USING (expires_at < now() - interval '7 days');
CREATE POLICY sessions_owner_select ON sessions FOR SELECT TO multistore_owner USING (true);
CREATE POLICY sessions_owner_cleanup ON sessions FOR DELETE TO multistore_owner
  USING (expires_at < now() - interval '7 days');

CREATE POLICY audit_write ON audit_log FOR INSERT TO multistore_app WITH CHECK (
  current_setting('app.role', true) IN ('GUEST','CUSTOMER','MERCHANT')
  AND (tenant_id IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
CREATE POLICY audit_admin_select ON audit_log FOR SELECT TO multistore_admin USING (true);
CREATE POLICY audit_admin_insert ON audit_log FOR INSERT TO multistore_admin WITH CHECK (true);
-- Owner reads audit rows so the prune DELETE can evaluate them (SELECT policies apply to
-- DELETE ... WHERE); the DELETE policy itself restricts to rows older than 90 days.
CREATE POLICY audit_owner_select ON audit_log FOR SELECT TO multistore_owner USING (true);
CREATE POLICY owner_prune ON audit_log FOR DELETE TO multistore_owner
  USING (occurred_at < now() - interval '90 days');
