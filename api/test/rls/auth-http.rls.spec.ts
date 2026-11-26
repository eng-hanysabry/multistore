import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/common/http/configure-app';
import { applyMigration, appDatabaseUrl, setupDatabase, superClient } from './harness';

/**
 * The auth endpoints over real HTTP against real PostgreSQL with RLS on: the full guard
 * chain (JwtAuthGuard, RolesGuard, tenant resolution) plus DTO whitelisting, error-shape
 * safety and STM-11/12/13 behavior through the API surface. Mail is not configured, so
 * the outbox rows are read directly (superuser) to obtain the emailed codes.
 */

const JWT_SECRET = 'http-spec-secret-0123456789abcdef0123456789';

let app: INestApplication;

const su = async <T>(fn: (c: ReturnType<typeof superClient>) => Promise<T>): Promise<T> => {
  const c = superClient();
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
};

const lastCode = async (): Promise<string> => {
  const body = await su(
    async (c) =>
      (await c.query('SELECT body_text FROM email_outbox ORDER BY created_at DESC LIMIT 1')).rows[0]
        ?.body_text as string,
  );
  return /code is (\d{6})/.exec(body)?.[1] ?? '';
};

const http = () => request(app.getHttpServer() as never);

beforeAll(async () => {
  await setupDatabase();
  await applyMigration('20261125000001_ip3_mail_and_health');
  await applyMigration('20261126160002_ip4_identity_tenancy');
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_URL'] = appDatabaseUrl();
  process.env['JWT_SECRET'] = JWT_SECRET;
  process.env['OUTBOX_MODE'] = 'sweep';
  process.env['CRON_SECRET'] = 'http-spec-cron-secret-0123456789abcdef';
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.init();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await su((c) =>
    c.query(
      'TRUNCATE tenants, users, memberships, auth_codes, sessions, refresh_tokens, audit_log, email_outbox CASCADE',
    ),
  );
});

describe('auth endpoints over HTTP (section 9, STM-11..13)', () => {
  it('register -> verify -> login -> refresh -> reuse -> logout, and health stays public', async () => {
    await http().get('/health/live').expect(200);

    // register: generic response, code queued in the outbox
    const reg = await http()
      .post('/auth/register')
      .send({ email: 'User@Example.com', password: 'pw-12345' })
      .expect(201);
    expect(reg.body.message).toBeTruthy();
    const code = await lastCode();
    expect(code).toMatch(/^\d{6}$/);

    // login before verification: the one documented exception (section 9)
    const early = await http()
      .post('/auth/login')
      .send({ email: 'user@example.com', password: 'pw-12345' })
      .expect(403);
    expect(early.body.code).toBe('EMAIL_NOT_VERIFIED');

    // wrong code: 400; right code: tokens
    await http()
      .post('/auth/verify-email')
      .send({ email: 'user@example.com', code: code === '000000' ? '000001' : '000000' })
      .expect(400);
    const verified = await http()
      .post('/auth/verify-email')
      .send({ email: 'user@example.com', code })
      .expect(200);
    expect(verified.body.accessToken).toBeTruthy();
    expect(verified.body.refreshToken).toBeTruthy();

    const login = await http()
      .post('/auth/login')
      .send({ email: 'user@example.com', password: 'pw-12345' })
      .expect(200);
    const rotated = await http()
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);
    expect(rotated.body.refreshToken).not.toEqual(login.body.refreshToken);

    // STM-12: reuse of the rotated token -> 401, session revoked
    const reuse = await http()
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);
    expect(reuse.body.code).toBe('TOKEN_INVALID');
    const revoked = await su(
      async (c) =>
        (
          await c.query(
            "SELECT count(*)::int AS n FROM sessions WHERE revoked_reason = 'REUSE_DETECTED'",
          )
        ).rows[0].n,
    );
    expect(Number(revoked)).toBe(1);

    // logout: 204, then the token is dead
    await http().post('/auth/logout').send({ refreshToken: rotated.body.refreshToken }).expect(204);
    await http()
      .post('/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);
  });

  it('login failures are enumeration-proof (8.6.8)', async () => {
    await http().post('/auth/register').send({ email: 'a@example.com', password: 'pw-12345' });
    for (const body of [
      { email: 'a@example.com', password: 'wrong-pw' },
      { email: 'nobody@example.com', password: 'pw-12345' },
    ]) {
      const res = await http().post('/auth/login').send(body).expect(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
      expect(res.body.message).toBe('Invalid email or password.');
    }
    // register of an existing address returns the same generic shape
    const again = await http()
      .post('/auth/register')
      .send({ email: 'a@example.com', password: 'pw-12345' })
      .expect(201);
    expect(again.body.message).toBeTruthy();
  });

  it('STM-11 over HTTP: the protected change-password route rejects missing and forged tokens', async () => {
    await http()
      .post('/auth/password/change')
      .send({ currentPassword: 'x', newPassword: 'y-123456' })
      .expect(401);
    const forged =
      'eyJhbGciOiJub25lIn0.' +
      Buffer.from(JSON.stringify({ sub: 'x', role: 'CUSTOMER' })).toString('base64url') +
      '.';
    const res = await http()
      .post('/auth/password/change')
      .set('authorization', `Bearer ${forged}`)
      .send({ currentPassword: 'x', newPassword: 'y-123456' })
      .expect(401);
    // the safe body never names the failed check (6.8)
    expect(JSON.stringify(res.body)).not.toMatch(/signature|algorithm|issuer|audience|expired/i);
  });

  it('STM-13 over HTTP: password change revokes every session; old tokens die', async () => {
    await http().post('/auth/register').send({ email: 'b@example.com', password: 'pw-12345' });
    const code = await lastCode();
    await http().post('/auth/verify-email').send({ email: 'b@example.com', code }).expect(200);
    const login = await http()
      .post('/auth/login')
      .send({ email: 'b@example.com', password: 'pw-12345' })
      .expect(200);
    const token = login.body.accessToken as string;

    // wrong current password: 401 INVALID_CREDENTIALS
    await http()
      .post('/auth/password/change')
      .set('authorization', `Bearer ${token}`)
      .send({ currentPassword: 'nope-nope', newPassword: 'new-pw-123' })
      .expect(401);

    await http()
      .post('/auth/password/change')
      .set('authorization', `Bearer ${token}`)
      .send({ currentPassword: 'pw-12345', newPassword: 'new-pw-123' })
      .expect(204);

    // old refresh token is dead; old password no longer signs in
    await http().post('/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(401);
    await http()
      .post('/auth/login')
      .send({ email: 'b@example.com', password: 'pw-12345' })
      .expect(401);
    await http()
      .post('/auth/login')
      .send({ email: 'b@example.com', password: 'new-pw-123' })
      .expect(200);
  });

  it('DTO whitelist: unknown fields (including tenant_id) are rejected, never read (5.4, 6.3)', async () => {
    const res = await http()
      .post('/auth/register')
      .send({ email: 'c@example.com', password: 'pw-12345', tenant_id: 'anything' })
      .expect(400);
    expect(JSON.stringify(res.body)).not.toContain('anything');
  });

  it('STM-16: mass assignment of role, is_super_admin or tenant_id is rejected; no row created', async () => {
    for (const extra of [
      { role: 'SUPER_ADMIN' },
      { is_super_admin: true },
      { tenant_id: '11111111-1111-4111-8111-111111111111' },
      { status: 'ACTIVE' },
    ]) {
      await http()
        .post('/auth/register')
        .send({ email: 'mass@example.com', password: 'pw-12345', ...extra })
        .expect(400);
    }
    const row = await su(
      async (c) =>
        (await c.query("SELECT count(*)::int AS n FROM users WHERE email = 'mass@example.com'"))
          .rows[0].n,
    );
    expect(Number(row)).toBe(0);
  });

  it('STM-14 over HTTP: a consumed verification code cannot be replayed', async () => {
    await http().post('/auth/register').send({ email: 'r@example.com', password: 'pw-12345' });
    const code = await lastCode();
    await http().post('/auth/verify-email').send({ email: 'r@example.com', code }).expect(200);
    // replay: the consumed code is invalid and the account state does not change again
    const replay = await http()
      .post('/auth/verify-email')
      .send({ email: 'r@example.com', code })
      .expect(400);
    expect(replay.body.code).toBe('CODE_INVALID');
    const codes = await su(
      async (c) =>
        (
          await c.query(
            "SELECT count(*)::int AS n FROM auth_codes WHERE consumed_at IS NOT NULL AND purpose = 'VERIFY_EMAIL'",
          )
        ).rows[0].n,
    );
    expect(Number(codes)).toBe(1);
  });

  it('DTO shape: bad email, short password, malformed code and bad token length are 400', async () => {
    await http()
      .post('/auth/register')
      .send({ email: 'not-an-email', password: 'pw-12345' })
      .expect(400);
    await http()
      .post('/auth/register')
      .send({ email: 'd@example.com', password: 'short' })
      .expect(400);
    await http()
      .post('/auth/verify-email')
      .send({ email: 'd@example.com', code: '12345' })
      .expect(400);
    await http().post('/auth/refresh').send({ refreshToken: 'too-short' }).expect(400);
  });
});
