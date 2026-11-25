import {
  redactString,
  redactValue,
  safeDatabaseUrl,
  REDACTED,
} from '../../src/common/logging/redact';
import { SafeLogger } from '../../src/common/logging/safe-logger';
import { describeConfig, parseConfig, ConfigError } from '../../src/common/config/app-config';
import { toSafeError } from '../../src/common/errors/safe-error';

// Seeded test-only secrets (6.8 tests).
const DB_URL =
  'postgresql://multistore_app.abcdefgh:Zq9-seeded-DB-pass-77@aws-0-eu.pooler.example.com:6543/postgres';
const DB_PASS = 'Zq9-seeded-DB-pass-77';
const ACCESS = 'ya29.a0SeededGoogleAccessTokenValue_123456';
const REFRESH = '1//0gSeededGoogleRefreshTokenValue_abcdefghijk';
const JWT_SECRET = 'seeded-jwt-secret-value-0123456789abcdef';
const ENV = { NODE_ENV: 'test', PORT: '3000', DATABASE_URL: DB_URL, JWT_SECRET };

function capture(): { lines: string[]; logger: SafeLogger } {
  const lines: string[] = [];
  return {
    lines,
    logger: new SafeLogger((l) => lines.push(l), {
      knownSecrets: [DB_PASS, JWT_SECRET, ACCESS, REFRESH],
    }),
  };
}
const leaks = (lines: string[]): string[] =>
  lines.filter((l) =>
    [
      DB_PASS,
      'Zq9-seeded',
      JWT_SECRET,
      'seeded-jwt-secret',
      ACCESS,
      'SeededGoogleAccess',
      REFRESH,
      'SeededGoogleRefresh',
    ].some((s) => l.includes(s)),
  );

describe('log redaction (6.8)', () => {
  it('removes credentials from URLs, tokens and known secrets', () => {
    expect(redactString(`connect to ${DB_URL} failed`)).not.toContain(DB_PASS);
    expect(redactString(`token ${ACCESS} and ${REFRESH}`)).not.toMatch(/ya29|1\/\/0g/);
    expect(redactString('Authorization: Bearer abcdefghijklmnop')).not.toContain(
      'abcdefghijklmnop',
    );
    expect(redactString('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcdefghijk')).toContain(
      REDACTED,
    );
  });

  it('removes recognizable parts of a known secret', () => {
    const out = redactString(`partial ${DB_PASS.slice(3, 14)} here`, { knownSecrets: [DB_PASS] });
    expect(out).not.toContain(DB_PASS.slice(3, 14));
  });

  it('ignores short known secrets and tolerates deep or odd values', () => {
    expect(redactString('abc', { knownSecrets: ['abc'] })).toBe('abc');
    let deep: unknown = 'x';
    for (let i = 0; i < 12; i++) deep = { a: deep };
    expect(JSON.stringify(redactValue(deep))).toContain('TRUNCATED');
    expect(redactValue(5)).toBe(5);
  });

  it('redacts secret-named keys by name and never emits stack traces', () => {
    const v = redactValue({
      DATABASE_URL: DB_URL,
      refreshToken: REFRESH,
      ok: 'fine',
      err: new Error(`bad ${DB_URL}`),
    }) as Record<string, unknown>;
    expect(v['DATABASE_URL']).toBe(REDACTED);
    expect(v['refreshToken']).toBe(REDACTED);
    expect(v['ok']).toBe('fine');
    expect(JSON.stringify(v)).not.toContain(DB_PASS);
    expect(JSON.stringify(v)).not.toContain('at ');
  });

  it('logs a careless logger.log(config) without secrets (sink-level redaction)', () => {
    const { lines, logger } = capture();
    logger.log(parseConfig(ENV));
    logger.log('cfg', { DATABASE_URL: DB_URL, nested: { token: ACCESS } });
    logger.error(new Error(`db down at ${DB_URL}`));
    logger.warn(`oauth ${REFRESH}`);
    logger.debug('d', DB_URL);
    logger.verbose('v', { s: JWT_SECRET });
    expect(lines).toHaveLength(6);
    expect(leaks(lines)).toEqual([]);
  });

  it('successful and failed request paths emit scanned, clean lines', () => {
    const { lines, logger } = capture();
    for (const role of ['GUEST', 'CUSTOMER', 'MERCHANT', 'SUPER_ADMIN'])
      logger.log('request ok', { role, authorization: `Bearer ${ACCESS}` });
    for (const failure of [
      'validation error',
      'authentication failure',
      `database unreachable ${DB_URL}`,
      'timeout',
      `upstream Gmail failure ${REFRESH}`,
    ]) {
      logger.error(failure, { stack: `Error: x\n    at ${DB_URL}` });
    }
    expect(lines.length).toBe(9);
    expect(leaks(lines)).toEqual([]);
  });

  it('safeDatabaseUrl drops credentials, and bad URLs are fully redacted', () => {
    expect(safeDatabaseUrl(DB_URL)).toBe('postgresql://aws-0-eu.pooler.example.com:6543/postgres');
    expect(safeDatabaseUrl('not a url')).toBe(REDACTED);
  });
});

describe('typed config (fails fast, never prints values)', () => {
  it('parses a valid config and describes it safely', () => {
    const cfg = parseConfig(ENV);
    expect(cfg.port).toBe(3000);
    const text = JSON.stringify(
      describeConfig({
        ...cfg,
        adminDatabaseUrl: DB_URL.replace('multistore_app', 'multistore_admin'),
      }),
    );
    expect(text).not.toContain(DB_PASS);
    expect(text).not.toContain(JWT_SECRET);
  });

  it('rejects the owner/postgres role, bad URLs, short JWT secret, bad port and env', () => {
    const bad = (e: Record<string, string | undefined>): string[] => {
      try {
        parseConfig(e);
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        return (err as ConfigError).problems as string[];
      }
      return [];
    };
    expect(
      bad({ ...ENV, DATABASE_URL: DB_URL.replace('multistore_app', 'postgres') }).join(),
    ).toMatch(/must log in as multistore_app/);
    expect(bad({ ...ENV, DATABASE_URL: 'mysql://x' }).join()).toMatch(/postgresql/);
    expect(bad({ ...ENV, DATABASE_URL: 'nope' }).join()).toMatch(/valid URL/);
    expect(bad({ ...ENV, DATABASE_URL: undefined }).join()).toMatch(/DATABASE_URL is required/);
    expect(bad({ ...ENV, JWT_SECRET: 'short' }).join()).toMatch(/JWT_SECRET/);
    expect(bad({ ...ENV, PORT: '99999' }).join()).toMatch(/PORT/);
    expect(bad({ ...ENV, NODE_ENV: 'staging' }).join()).toMatch(/NODE_ENV/);
    expect(bad({ ...ENV, ADMIN_DATABASE_URL: DB_URL }).join()).toMatch(/multistore_admin/);
    const msg = bad({ ...ENV, DATABASE_URL: DB_URL.replace('multistore_app', 'postgres') }).join();
    expect(msg).not.toContain(DB_PASS);
  });

  it('accepts a valid admin URL and an optional absent one', () => {
    expect(
      parseConfig({
        ...ENV,
        ADMIN_DATABASE_URL: DB_URL.replace('multistore_app', 'multistore_admin'),
      }).adminDatabaseUrl,
    ).toBeDefined();
    expect(parseConfig(ENV).adminDatabaseUrl).toBeUndefined();
  });
});

describe('error responses', () => {
  it('carry a safe message and requestId only, no stack, no secrets', () => {
    const e = toSafeError('INTERNAL', 'Something went wrong', 'req-1');
    expect(Object.keys(e).sort()).toEqual(['code', 'message', 'requestId']);
    expect(toSafeError('X', 'y').requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(e)).not.toMatch(/stack|postgres/i);
  });
});
