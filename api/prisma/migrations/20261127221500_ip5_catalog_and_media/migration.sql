-- IP-5: catalog and media (spec v4.9 sections 8.6, 8.7, 10.7; design docs/ip5/IP5_schema_design.md).
-- Applied by multistore_owner only, never postgres or service_role.
-- Step 1 approval: Telegram 26970309/26970315/26970320/26970325 (27 Nov 2026).
-- Batch 1 decisions and PART A correction (no database UUID defaults): Telegram
-- 27231065/27231077/27231079/27231080/27231082 (27 Nov 2026).
-- No seeds here: test/seed data is loaded by the test harness, never by the migration.
-- drive_file_key holds the external Drive object id; it is not a database foreign key
-- (named *_key, not *_id, so the STM-20 uuid-fk rule stays exact).

CREATE TABLE categories (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED')),
  published_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'PUBLISHED') = (published_at IS NOT NULL))
);
CREATE UNIQUE INDEX categories_tenant_id_id_key ON categories (tenant_id, id);
CREATE INDEX categories_public_list_idx ON categories (tenant_id, status, created_at, id);

CREATE TABLE products (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  category_id uuid,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR char_length(description) <= 5000),
  price_amount numeric(14,3) CHECK (price_amount IS NULL OR price_amount >= 0),
  price_currency char(3) CHECK (price_currency IS NULL OR price_currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED')),
  published_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((price_amount IS NULL) = (price_currency IS NULL)),
  CHECK ((status = 'PUBLISHED') = (published_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, category_id) REFERENCES categories (tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX products_tenant_id_id_key ON products (tenant_id, id);
CREATE INDEX products_public_list_idx ON products (tenant_id, status, created_at, id);
CREATE INDEX products_category_idx ON products (tenant_id, category_id);

CREATE TABLE media_assets (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  product_id uuid,
  kind text NOT NULL CHECK (kind IN ('PRODUCT_IMAGE','STORE_LOGO')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('UPLOADING','ACTIVE','FAILED','ORPHANED')),
  drive_file_key text,
  original_filename text,
  content_type text NOT NULL,
  byte_size integer CHECK (byte_size IS NULL OR byte_size >= 0),
  width_px integer CHECK (width_px IS NULL OR (width_px > 0 AND width_px <= 4000)),
  height_px integer CHECK (height_px IS NULL OR (height_px > 0 AND height_px <= 4000)),
  variants jsonb,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'PRODUCT_IMAGE') = (product_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products (tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX media_assets_tenant_id_id_key ON media_assets (tenant_id, id);
CREATE UNIQUE INDEX media_assets_drive_file_key_key ON media_assets (drive_file_key)
  WHERE drive_file_key IS NOT NULL;
CREATE INDEX media_assets_product_idx ON media_assets (tenant_id, product_id);
CREATE INDEX media_assets_status_idx ON media_assets (tenant_id, status);

CREATE TABLE idempotency_keys (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL CHECK (char_length(action) >= 1),
  key text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 128),
  request_hash text NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  CHECK (expires_at <= created_at + interval '24 hours')
);
CREATE UNIQUE INDEX idempotency_keys_scope_key ON idempotency_keys (tenant_id, user_id, action, key);
CREATE INDEX idempotency_keys_expires_idx ON idempotency_keys (expires_at);

-- Database-level lifecycle guards (plain SECURITY INVOKER, approved IP-4
-- users_protect_sensitive precedent). RLS cannot compare old/new row values nor enforce
-- cross-row publish gates; these triggers own the two Batch 1 rules:
--   M-3: publish requires a published category and an ACTIVE PRODUCT_IMAGE.
--   M-4: a category cannot be unpublished while published products reference it.
-- multistore_owner is exempt: its operations are migrations and reviewed manual steps.
CREATE OR REPLACE FUNCTION products_publish_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER AS $f$
BEGIN
  IF current_user = 'multistore_owner' THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'PUBLISHED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'PUBLISHED') THEN
    IF NEW.category_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM categories c
      WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.category_id AND c.status = 'PUBLISHED') THEN
      RAISE EXCEPTION 'product publish requires a published category';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM media_assets m
      WHERE m.tenant_id = NEW.tenant_id AND m.product_id = NEW.id
        AND m.kind = 'PRODUCT_IMAGE' AND m.status = 'ACTIVE') THEN
      RAISE EXCEPTION 'product publish requires an ACTIVE PRODUCT_IMAGE';
    END IF;
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER products_publish_guard_trg BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION products_publish_guard();

CREATE OR REPLACE FUNCTION categories_unpublish_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER AS $f$
BEGIN
  IF current_user = 'multistore_owner' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'PUBLISHED' AND NEW.status = 'DRAFT' AND EXISTS (
    SELECT 1 FROM products p
    WHERE p.tenant_id = NEW.tenant_id AND p.category_id = NEW.id AND p.status = 'PUBLISHED') THEN
    RAISE EXCEPTION 'category unpublish blocked: published products still reference it';
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER categories_unpublish_guard_trg BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION categories_unpublish_guard();

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets FORCE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;

REVOKE ALL ON categories, products, media_assets, idempotency_keys FROM PUBLIC;

-- Supabase's platform roles exist on the real project but not in a vanilla CI database:
-- revoke per existing role only, so the same migration applies in both.
DO $rev$
DECLARE r text;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON categories, products, media_assets, idempotency_keys FROM %I', r);
  END LOOP;
END $rev$;

-- Application role: minimum table rights. Idempotency records are write-once for the
-- app role (SELECT + INSERT only; no UPDATE or DELETE grant, and no policy either).
GRANT SELECT, INSERT, UPDATE, DELETE ON categories TO multistore_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON products TO multistore_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON media_assets TO multistore_app;
GRANT SELECT, INSERT ON idempotency_keys TO multistore_app;

-- Admin role: read-only operational inspection of catalog and media. Idempotency
-- records stay outside the admin role (approved design section E-2).
GRANT SELECT ON categories TO multistore_admin;
GRANT SELECT ON products TO multistore_admin;
GRANT SELECT ON media_assets TO multistore_admin;

-- categories
CREATE POLICY categories_public_read ON categories FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) IN ('GUEST','CUSTOMER')
  AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND status = 'PUBLISHED');
CREATE POLICY categories_merchant_select ON categories FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) = 'MERCHANT'
  AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY categories_merchant_insert ON categories FOR INSERT TO multistore_app WITH CHECK (
  current_setting('app.role', true) = 'MERCHANT'
  AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND status = 'DRAFT' AND published_at IS NULL);
CREATE POLICY categories_merchant_update ON categories FOR UPDATE TO multistore_app
  USING (current_setting('app.role', true) = 'MERCHANT'
         AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (current_setting('app.role', true) = 'MERCHANT'
              AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY categories_merchant_delete ON categories FOR DELETE TO multistore_app USING (
  current_setting('app.role', true) = 'MERCHANT'
  AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND status = 'DRAFT');
CREATE POLICY categories_admin_select ON categories FOR SELECT TO multistore_admin USING (true);
CREATE POLICY categories_owner_select ON categories FOR SELECT TO multistore_owner USING (true);

-- products: public visibility additionally requires a published-or-absent category
-- (design F-4, defensive check; the unpublish trigger keeps it true by construction).
CREATE POLICY products_public_read ON products FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) IN ('GUEST','CUSTOMER')
  AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND status = 'PUBLISHED'
  AND (category_id IS NULL OR EXISTS (
    SELECT 1 FROM categories c
    WHERE c.tenant_id = products.tenant_id AND c.id = products.category_id
      AND c.status = 'PUBLISHED')));
CREATE POLICY products_merchant_select ON products FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) = 'MERCHANT'
  AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY products_merchant_insert ON products FOR INSERT TO multistore_app WITH CHECK (
  current_setting('app.role', true) = 'MERCHANT'
  AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND status = 'DRAFT' AND published_at IS NULL);
CREATE POLICY products_merchant_update ON products FOR UPDATE TO multistore_app
  USING (current_setting('app.role', true) = 'MERCHANT'
         AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (current_setting('app.role', true) = 'MERCHANT'
              AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY products_merchant_delete ON products FOR DELETE TO multistore_app USING (
  current_setting('app.role', true) = 'MERCHANT'
  AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND status = 'DRAFT');
CREATE POLICY products_admin_select ON products FOR SELECT TO multistore_admin USING (true);
CREATE POLICY products_owner_select ON products FOR SELECT TO multistore_owner USING (true);

-- media_assets: public reads follow the product publication state; STORE_LOGO has no
-- public access at this stage (Batch 1 decision M-7). Merchant delete is limited to
-- media of DRAFT products and to logos (J9: deletion only while the record is DRAFT).
CREATE POLICY media_public_read ON media_assets FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) IN ('GUEST','CUSTOMER')
  AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND kind = 'PRODUCT_IMAGE' AND status = 'ACTIVE'
  AND EXISTS (SELECT 1 FROM products p
              WHERE p.tenant_id = media_assets.tenant_id AND p.id = media_assets.product_id
                AND p.status = 'PUBLISHED'
                AND (p.category_id IS NULL OR EXISTS (
                      SELECT 1 FROM categories c
                      WHERE c.tenant_id = p.tenant_id AND c.id = p.category_id
                        AND c.status = 'PUBLISHED'))));
CREATE POLICY media_merchant_select ON media_assets FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) = 'MERCHANT'
  AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY media_merchant_insert ON media_assets FOR INSERT TO multistore_app WITH CHECK (
  current_setting('app.role', true) = 'MERCHANT'
  AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY media_merchant_update ON media_assets FOR UPDATE TO multistore_app
  USING (current_setting('app.role', true) = 'MERCHANT'
         AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (current_setting('app.role', true) = 'MERCHANT'
              AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY media_merchant_delete ON media_assets FOR DELETE TO multistore_app USING (
  current_setting('app.role', true) = 'MERCHANT'
  AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND (kind = 'STORE_LOGO' OR EXISTS (
    SELECT 1 FROM products p
    WHERE p.tenant_id = media_assets.tenant_id AND p.id = media_assets.product_id
      AND p.status = 'DRAFT')));
CREATE POLICY media_admin_select ON media_assets FOR SELECT TO multistore_admin USING (true);
CREATE POLICY media_owner_select ON media_assets FOR SELECT TO multistore_owner USING (true);

-- idempotency_keys: tenant+user scoped, write-once for the app role. Only the owner
-- prunes expired rows (approved IP-4 owner-cleanup precedent).
CREATE POLICY idem_app_select ON idempotency_keys FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) IN ('CUSTOMER','MERCHANT')
  AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY idem_app_insert ON idempotency_keys FOR INSERT TO multistore_app WITH CHECK (
  current_setting('app.role', true) IN ('CUSTOMER','MERCHANT')
  AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY idem_owner_select ON idempotency_keys FOR SELECT TO multistore_owner USING (true);
CREATE POLICY idem_owner_prune ON idempotency_keys FOR DELETE TO multistore_owner
  USING (expires_at < now());
