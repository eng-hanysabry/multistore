import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * STM-18: the ordinary API runtime must not read the admin credential. In IP-4 there is
 * no AdminModule and no admin client at all (IP-8 introduces both); this test is the
 * tripwire that keeps the runtime app-only until then: only the config parser may
 * mention the admin URL, and no source file may define an admin Prisma client.
 */

const src = join(__dirname, '..', '..', 'src');

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });

describe('STM-18: credential isolation (configuration)', () => {
  it('only the config parser references the admin database URL', () => {
    const offenders = sources(src).filter((p) => {
      if (p.endsWith(join('common', 'config', 'app-config.ts'))) return false;
      const text = readFileSync(p, 'utf8');
      return /ADMIN_DATABASE_URL|adminDatabaseUrl/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it('no admin Prisma client or module exists in the runtime source', () => {
    const offenders = sources(src).filter((p) => {
      if (p.endsWith(join('common', 'config', 'app-config.ts'))) return false; // the login check
      return /AdminPrisma|AdminModule|multistore_admin/.test(readFileSync(p, 'utf8'));
    });
    expect(offenders).toEqual([]);
  });

  it('the runtime database URL logs in as multistore_app (config rule)', () => {
    const config = readFileSync(join(src, 'common', 'config', 'app-config.ts'), 'utf8');
    expect(config).toContain("REQUIRED_APP_ROLE = 'multistore_app'");
    expect(config).toContain('ADMIN_DATABASE_URL must log in as multistore_admin');
  });
});
