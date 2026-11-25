import { lintContextSource, lintMigrationSql } from '../../scripts/migration-lints';

const GOOD = `
CREATE TABLE products (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  status text NOT NULL,
  CONSTRAINT x CHECK (status <> '')
);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
CREATE POLICY guest_read ON products FOR SELECT TO multistore_app
  USING (current_setting('app.role', true) = 'GUEST'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND status = 'PUBLISHED');
CREATE POLICY admin_all ON products FOR ALL TO multistore_admin USING (true) WITH CHECK (true);
`;
const rules = (sql: string): string[] =>
  lintMigrationSql({ 'm.sql': sql })
    .map((v) => v.rule)
    .sort();

describe('migration lints (5.6, 6.4)', () => {
  it('passes a compliant migration (and ignores comments)', () => {
    expect(rules(`-- CREATE TABLE bad (id int);\n/* x */\n${GOOD}`)).toEqual([]);
  });
  it('rejects non-uuid id, id default and missing primary key', () => {
    expect(rules('CREATE TABLE a (id integer PRIMARY KEY, name text);')).toContain('uuid-pk');
    expect(rules('CREATE TABLE a (id uuid PRIMARY KEY DEFAULT gen_random_uuid());')).toContain(
      'no-id-default',
    );
    expect(rules('CREATE TABLE a (id uuid DEFAULT uuid_generate_v4());')).toEqual(
      expect.arrayContaining(['no-id-default', 'uuid-pk']),
    );
    expect(rules('CREATE TABLE a (name text);')).toContain('uuid-pk');
  });
  it('rejects non-uuid foreign keys and tenant_id', () => {
    expect(rules('CREATE TABLE a (id uuid PRIMARY KEY, tenant_id bigint, owner_id int);')).toEqual(
      expect.arrayContaining(['uuid-fk']),
    );
  });
  it('rejects tenant tables without enabled and forced RLS', () => {
    const r = rules('CREATE TABLE a (id uuid PRIMARY KEY, tenant_id uuid);');
    expect(r).toEqual(expect.arrayContaining(['rls-enabled', 'rls-forced']));
    expect(
      rules(
        'CREATE TABLE a (id uuid PRIMARY KEY, tenant_id uuid); ALTER TABLE a ENABLE ROW LEVEL SECURITY;',
      ),
    ).toEqual(['rls-forced']);
  });
  it('rejects multistore_app policies without an app.role check (the v2 mistake)', () => {
    const bad = GOOD.replace("current_setting('app.role', true) = 'GUEST'\n    AND ", '');
    expect(rules(bad)).toContain('policy-app-role');
  });
  it('rejects a uuid cast of app.tenant_id or app.user_id without NULLIF', () => {
    expect(
      rules(
        GOOD.replace(
          "NULLIF(current_setting('app.tenant_id', true), '')",
          "current_setting('app.tenant_id', true)",
        ),
      ),
    ).toContain('nullif-uuid-cast');
    expect(
      rules(
        `${GOOD} CREATE POLICY p ON products FOR SELECT TO multistore_app USING (current_setting('app.role', true)='CUSTOMER' AND user_id = current_setting('app.user_id', true)::uuid);`,
      ),
    ).toContain('nullif-uuid-cast');
  });
});

describe('source lint: transaction-local context only (6.4)', () => {
  it('accepts set_config with the local flag true', () => {
    expect(
      lintContextSource({
        'a.ts': "await tx.$executeRaw`SELECT set_config('app.role', ${role}, true)`;",
      }),
    ).toEqual([]);
    expect(lintContextSource({ 'a.ts': "SELECT set_config('app.role', 'X', true)" })).toEqual([]);
  });
  it('rejects set_config with false or no flag, SET SESSION and bare SET', () => {
    expect(
      lintContextSource({ 'a.ts': "SELECT set_config('app.role', 'X', false)" })[0]?.rule,
    ).toBe('set-config-local');
    expect(lintContextSource({ 'a.ts': 'SET SESSION app.role = 1' })[0]?.rule).toBe(
      'no-session-set',
    );
    expect(lintContextSource({ 'a.ts': 'const q = `SET app.tenant_id = 1`;' })[0]?.rule).toBe(
      'no-session-set',
    );
  });
});
