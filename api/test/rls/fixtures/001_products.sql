-- RLS harness fixture (test-only). Mirrors spec 6.2 (v4.9, NULLIF form) on one tenant table.
-- Ids are supplied by the caller: no database-side default (5.6).
CREATE TABLE products (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL
);
CREATE TABLE favorites (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  product_id uuid NOT NULL
);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
CREATE POLICY guest_read ON products FOR SELECT TO multistore_app
  USING (current_setting('app.role', true) = 'GUEST'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND status = 'PUBLISHED');
CREATE POLICY customer_read ON products FOR SELECT TO multistore_app
  USING (current_setting('app.role', true) = 'CUSTOMER'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND status = 'PUBLISHED');
CREATE POLICY merchant_all ON products FOR ALL TO multistore_app
  USING (current_setting('app.role', true) = 'MERCHANT'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (current_setting('app.role', true) = 'MERCHANT'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY admin_all ON products FOR ALL TO multistore_admin USING (true) WITH CHECK (true);

ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_own ON favorites FOR ALL TO multistore_app
  USING (current_setting('app.role', true) = 'CUSTOMER'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (current_setting('app.role', true) = 'CUSTOMER'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO multistore_app, multistore_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON products, favorites TO multistore_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON products TO multistore_admin;
