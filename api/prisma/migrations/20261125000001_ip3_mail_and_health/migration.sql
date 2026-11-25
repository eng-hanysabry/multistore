-- IP-3: email outbox (10.7) and the readiness RLS canary (10.7). Applied by multistore_owner.
-- Ids are supplied by the caller: no database-side default (5.6).
CREATE TABLE email_outbox (
  id uuid PRIMARY KEY,
  to_address text NOT NULL,
  subject text NOT NULL,
  body_text text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX email_outbox_due_idx ON email_outbox (status, next_attempt_at);

-- Internal table, no tenant_id: reachable only by the API role, not by the admin role.
REVOKE ALL ON email_outbox FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON email_outbox TO multistore_app;

-- Canary: one fixed row. Without tenant context the app role must see zero rows (not an error),
-- with the context it must see the row. Proves RLS and the NULLIF form work on this connection.
CREATE TABLE rls_canary (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL
);
ALTER TABLE rls_canary ENABLE ROW LEVEL SECURITY;
ALTER TABLE rls_canary FORCE ROW LEVEL SECURITY;
CREATE POLICY canary_read ON rls_canary FOR SELECT TO multistore_app
  USING (current_setting('app.role', true) = 'GUEST'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY canary_seed ON rls_canary FOR INSERT TO multistore_owner WITH CHECK (true);
INSERT INTO rls_canary (id, tenant_id) VALUES
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2');
REVOKE ALL ON rls_canary FROM PUBLIC;
GRANT SELECT ON rls_canary TO multistore_app;
