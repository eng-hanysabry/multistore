import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/common/http/configure-app';
import { JwtAccessTokenSigner } from '../../src/modules/auth/infrastructure/jwt-access-token-signer';
import { applyMigration, appDatabaseUrl, seedId, setupDatabase, superClient } from './harness';

/**
 * STM-24 (G-12, IP-5 Step 9): public catalog rate limiting over real HTTP against the
 * real Nest application and the real PublicCatalogThrottlerGuard — not configuration
 * unit tests. Test-only limits (3 requests / 60s per IP per endpoint) come from
 * PUBLIC_CATALOG_RATE_LIMIT / PUBLIC_CATALOG_RATE_LIMIT_TTL_MS so no test waits on the
 * production TTL. Two app instances cover the two trusted-proxy modes; each instance
 * gets a fresh in-memory throttler storage, so no state leaks between them.
 */

const JWT_SECRET = 'rate-limit-spec-secret-0123456789abcdef';

const TENANT = seedId(7100);
const USER_M = seedId(7101);
const MEMBERSHIP = seedId(7102);
const CAT = seedId(7110);

let app: INestApplication;
let merchant: string;

const http = () => request(app.getHttpServer() as never);

const boot = async (trustedProxy: 'none' | 'vercel'): Promise<void> => {
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_URL'] = appDatabaseUrl();
  process.env['JWT_SECRET'] = JWT_SECRET;
  process.env['OUTBOX_MODE'] = 'sweep';
  process.env['CRON_SECRET'] = 'rate-limit-spec-cron-secret-0123456789ab';
  process.env['PUBLIC_CATALOG_RATE_LIMIT'] = '3';
  process.env['PUBLIC_CATALOG_RATE_LIMIT_TTL_MS'] = '60000';
  process.env['PUBLIC_CATALOG_TRUSTED_PROXY'] = trustedProxy;
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.init();
};

const expectRateLimitHeaders = (res: request.Response): void => {
  expect(res.headers['x-ratelimit-limit']).toBe('3');
  expect(Number(res.headers['x-ratelimit-remaining'])).toBeGreaterThanOrEqual(0);
};

const expect429 = (res: request.Response): void => {
  expect(res.status).toBe(429);
  // Retry-After is the standard, suffix-free header of the default throttler (B5).
  const retryAfter = Number(res.headers['retry-after']);
  expect(Number.isInteger(retryAfter)).toBe(true);
  expect(retryAfter).toBeGreaterThan(0);
  expect(retryAfter).toBeLessThanOrEqual(60);
  // Same safe error envelope as every other API error (5.4, 6.8); no internals.
  expect(res.body).toMatchObject({ code: 'RATE_LIMITED' });
  expect(typeof res.body.message).toBe('string');
  expect(typeof res.body.requestId).toBe('string');
  const text = JSON.stringify(res.body);
  for (const forbidden of ['limit', 'ttl', 'key', 'tracker', 'stack', 'throttler']) {
    expect(text.toLowerCase()).not.toContain(`"${forbidden}`);
  }
};

beforeAll(async () => {
  await setupDatabase();
  await applyMigration('20261125000001_ip3_mail_and_health');
  await applyMigration('20261126160002_ip4_identity_tenancy');
  await applyMigration('20261127221500_ip5_catalog_and_media');

  const c = superClient();
  await c.connect();
  try {
    await c.query(
      "INSERT INTO tenants (id, code, name, status) VALUES ($1,'rl-alpha','RL','ACTIVE')",
      [TENANT],
    );
    await c.query(
      "INSERT INTO users (id, email, password_hash, status) VALUES ($1,'rl-m@example.com','h','ACTIVE')",
      [USER_M],
    );
    await c.query(
      "INSERT INTO memberships (id, tenant_id, user_id, role, status) VALUES ($1,$2,$3,'MERCHANT','ACTIVE')",
      [MEMBERSHIP, TENANT, USER_M],
    );
    await c.query(
      "INSERT INTO categories (id, tenant_id, name, status, created_by, published_at) VALUES ($1,$2,'RL Cat','PUBLISHED',$3,now())",
      [CAT, TENANT, USER_M],
    );
  } finally {
    await c.end();
  }

  merchant = await new JwtAccessTokenSigner(JWT_SECRET).sign(USER_M, 'MERCHANT', seedId(7103));
}, 60_000);

afterEach(async () => {
  await app?.close();
});

describe('STM-24: trustedProxy=none (socket IP; forwarded headers never trusted)', () => {
  it('under-limit requests pass with rate-limit headers; over-limit is 429 with Retry-After and the safe envelope', async () => {
    await boot('none');
    for (let i = 0; i < 3; i += 1) {
      const res = await http().get('/t/rl-alpha/categories');
      expect(res.status).toBe(200);
      expectRateLimitHeaders(res);
    }
    // Same IP keeps using the same counter: the 4th request exceeds the limit.
    expect429(await http().get('/t/rl-alpha/categories'));
  });

  it('an over-limit endpoint does not block a different endpoint (independent counters)', async () => {
    await boot('none');
    for (let i = 0; i < 4; i += 1) {
      await http().get('/t/rl-alpha/categories');
    }
    const res = await http().get('/t/rl-alpha/products');
    expect(res.status).toBe(200);
  });

  it('spoofed forwarded headers do not mint a fresh counter in none mode', async () => {
    await boot('none');
    for (let i = 0; i < 4; i += 1) {
      await http().get('/t/rl-alpha/categories');
    }
    const spoofed = await http()
      .get('/t/rl-alpha/categories')
      .set('X-Forwarded-For', '203.0.113.99')
      .set('X-Vercel-Forwarded-For', '203.0.113.100');
    expect429(spoofed);
  });

  it('merchant and health routes are not throttled', async () => {
    await boot('none');
    for (let i = 0; i < 5; i += 1) {
      await http().get('/t/rl-alpha/categories');
      await http().get('/t/rl-alpha/products');
    }
    const m = await http()
      .get('/t/rl-alpha/merchant/categories')
      .set('Authorization', `Bearer ${merchant}`);
    expect(m.status).toBe(200);
    expect(m.headers['x-ratelimit-limit']).toBeUndefined();
    const h = await http().get('/health/live');
    expect(h.status).toBe(200);
    expect(h.headers['x-ratelimit-limit']).toBeUndefined();
  });
});

describe('STM-24: trustedProxy=vercel (leftmost x-vercel-forwarded-for from the trusted edge)', () => {
  it('different client IPs get independent counters; the same IP reuses its counter', async () => {
    await boot('vercel');
    for (let i = 0; i < 3; i += 1) {
      const res = await http()
        .get('/t/rl-alpha/categories')
        .set('X-Vercel-Forwarded-For', '203.0.113.10');
      expect(res.status).toBe(200);
    }
    expect429(
      await http().get('/t/rl-alpha/categories').set('X-Vercel-Forwarded-For', '203.0.113.10'),
    );
    // Still blocked on the next request (counter persists, not reset by the 429).
    expect429(
      await http().get('/t/rl-alpha/categories').set('X-Vercel-Forwarded-For', '203.0.113.10'),
    );
    // A different client IP is unaffected.
    const other = await http()
      .get('/t/rl-alpha/categories')
      .set('X-Vercel-Forwarded-For', '203.0.113.11');
    expect(other.status).toBe(200);
  });

  it('the leftmost value of a multi-IP chain is the client; x-forwarded-for is ignored', async () => {
    await boot('vercel');
    for (let i = 0; i < 3; i += 1) {
      await http()
        .get('/t/rl-alpha/categories')
        .set('X-Vercel-Forwarded-For', '198.51.100.7, 10.0.0.1')
        .set('X-Forwarded-For', '203.0.113.250');
    }
    expect429(
      await http()
        .get('/t/rl-alpha/categories')
        .set('X-Vercel-Forwarded-For', '198.51.100.7, 10.0.0.2')
        .set('X-Forwarded-For', '203.0.113.251'),
    );
  });

  it('IPv6 clients are normalized to their /64 subnet; another /64 is independent', async () => {
    await boot('vercel');
    for (let i = 0; i < 3; i += 1) {
      const res = await http()
        .get('/t/rl-alpha/categories')
        .set('X-Vercel-Forwarded-For', '2001:db8::1');
      expect(res.status).toBe(200);
    }
    expect429(
      await http().get('/t/rl-alpha/categories').set('X-Vercel-Forwarded-For', '2001:db8::1'),
    );
    // Rotating the interface ID inside the same /64 does not reset the quota.
    expect429(
      await http()
        .get('/t/rl-alpha/categories')
        .set('X-Vercel-Forwarded-For', '2001:db8::dead:beef'),
    );
    // A different /64 is a different client.
    const other = await http()
      .get('/t/rl-alpha/categories')
      .set('X-Vercel-Forwarded-For', '2001:db8:0:1::1');
    expect(other.status).toBe(200);
  });

  it('malformed or missing headers fall back to the socket IP and cannot mint fresh counters', async () => {
    await boot('vercel');
    const garbage = ['not-an-ip', '999.999.999.999', ''];
    for (const g of garbage) {
      const res = await http().get('/t/rl-alpha/categories').set('X-Vercel-Forwarded-For', g);
      expect(res.status).toBe(200);
    }
    // The three malformed requests shared the socket-IP fallback counter: the next one,
    // with no header at all, is blocked instead of getting a fresh identity.
    expect429(await http().get('/t/rl-alpha/categories'));
  });
});
