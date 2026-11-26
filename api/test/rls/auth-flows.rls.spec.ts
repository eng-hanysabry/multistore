import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { AuthService, GENERIC_CODE_MESSAGE } from '../../src/modules/auth/application/auth-service';
import { Argon2SecretHasher } from '../../src/modules/auth/infrastructure/argon2-secret-hasher';
import { JwtAccessTokenSigner } from '../../src/modules/auth/infrastructure/jwt-access-token-signer';
import { PrismaAuthStore } from '../../src/modules/auth/infrastructure/prisma-auth-store';
import { PrismaTenantTransactionRunner } from '../../src/infrastructure/prisma/tenant-transaction-runner';
import { applyMigration, appDatabaseUrl, setupDatabase, superClient } from './harness';

/**
 * AuthService end-to-end on real PostgreSQL as multistore_app: the full stack of runner,
 * store, RLS policies and the sensitive-field trigger, with real Argon2id hashing and a
 * real signed JWT. The outbox is a capturing fake (mail sending is IP-3 covered).
 */

const JWT_SECRET = 'rls-spec-secret-0123456789abcdef';

let db: PrismaClient; // pool of ONE connection
let svc: AuthService;
let outbox: { queue: jest.Mock };

const lastCode = (): string => {
  const text: string = outbox.queue.mock.calls.at(-1)?.[0]?.text ?? '';
  return /code is (\d{6})/.exec(text)?.[1] ?? '';
};

const su = async <T>(fn: (c: ReturnType<typeof superClient>) => Promise<T>): Promise<T> => {
  const c = superClient();
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
};
const userRow = (email: string) =>
  su(
    async (c) =>
      (
        await c.query(
          'SELECT id::text, email, status, password_hash, email_verified_at IS NOT NULL AS verified FROM users WHERE email=$1',
          [email],
        )
      ).rows[0],
  );

beforeAll(async () => {
  await setupDatabase();
  await applyMigration('20261125000001_ip3_mail_and_health');
  await applyMigration('20261126160002_ip4_identity_tenancy');
  db = new PrismaClient({ datasourceUrl: appDatabaseUrl() });
  const runner = new PrismaTenantTransactionRunner(db);
  svc = new AuthService(
    runner,
    new PrismaAuthStore(),
    new Argon2SecretHasher(),
    new JwtAccessTokenSigner(JWT_SECRET),
    (outbox = { queue: jest.fn().mockResolvedValue('outbox-id') }) as never,
  );
});
afterAll(async () => {
  await db.$disconnect();
});
beforeEach(async () => {
  outbox.queue.mockClear();
  await su((c) =>
    c.query(
      'TRUNCATE tenants, users, memberships, auth_codes, sessions, refresh_tokens, audit_log CASCADE',
    ),
  );
});

describe('auth flows end-to-end on real PostgreSQL + RLS (section 9)', () => {
  it('register -> verify -> login -> refresh -> reuse detection -> logout, all through RLS', async () => {
    // register
    const reg = await svc.register({ email: 'User@Example.com', password: 'pw-12345' });
    expect(reg).toEqual({ message: GENERIC_CODE_MESSAGE });
    const row = await userRow('user@example.com');
    expect(row.status).toBe('PENDING_VERIFICATION');
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    expect(outbox.queue).toHaveBeenCalledTimes(1);

    // login before verification: no tokens (section 9)
    await expect(svc.login({ email: 'user@example.com', password: 'pw-12345' })).rejects.toThrow(
      'EMAIL_NOT_VERIFIED',
    );

    // wrong code counts an attempt; right code activates and issues tokens
    const code = lastCode();
    const wrong = code === '000000' ? '000001' : '000000';
    await expect(svc.verifyEmail({ email: 'user@example.com', code: wrong })).rejects.toThrow(
      'CODE_INVALID',
    );
    const first = await svc.verifyEmail({ email: 'user@example.com', code });
    const after = await userRow('user@example.com');
    expect(after.status).toBe('ACTIVE');
    expect(after.verified).toBe(true);
    const payload = await new JwtService({ secret: JWT_SECRET }).verifyAsync(first.accessToken);
    expect(payload.sub).toBe(after.id);
    expect(payload.iss).toBe('multistore-api');
    expect(payload.aud).toBe('multistore-app');
    expect(typeof payload.sid).toBe('string');
    expect(payload.role).toBe('CUSTOMER');
    expect(payload.exp - payload.iat).toBe(900);
    const sessionCount = () =>
      su(async (c) => Number((await c.query('SELECT count(*)::int AS n FROM sessions')).rows[0].n));
    expect(await sessionCount()).toBe(1);

    // login now works and adds a second session
    const second = await svc.login({ email: 'user@example.com', password: 'pw-12345' });
    expect(second.refreshToken).not.toEqual(first.refreshToken);
    expect(await sessionCount()).toBe(2);

    // a refresh token lives 14 days and never outlives its session (design doc section 8)
    const tok = await su(
      async (c) =>
        (
          await c.query(
            "SELECT expires_at > now() + interval '13 days' AND expires_at < now() + interval '15 days' AS two_weeks, expires_at <= session_expires_at AS capped FROM refresh_tokens WHERE status = 'ACTIVE' ORDER BY issued_at DESC LIMIT 1",
          )
        ).rows[0],
    );
    expect(tok.two_weeks).toBe(true);
    expect(tok.capped).toBe(true);

    // refresh rotates; the old token is then rejected and its reuse revokes the session
    const third = await svc.refresh({ refreshToken: second.refreshToken });
    expect(third.refreshToken).not.toEqual(second.refreshToken);
    await expect(svc.refresh({ refreshToken: second.refreshToken })).rejects.toThrow(
      'TOKEN_INVALID',
    );
    const revoked = await su(
      async (c) =>
        (
          await c.query(
            "SELECT count(*)::int AS n FROM sessions WHERE revoked_reason = 'REUSE_DETECTED'",
          )
        ).rows[0].n,
    );
    expect(Number(revoked)).toBe(1);
    // the still-ACTIVE first token is unaffected (its own session was not the reused one)
    await expect(svc.refresh({ refreshToken: first.refreshToken })).resolves.toBeTruthy();

    // logout revokes; that token can no longer refresh
    await svc.logout({ refreshToken: third.refreshToken });
    await expect(svc.refresh({ refreshToken: third.refreshToken })).rejects.toThrow(
      'TOKEN_INVALID',
    );
  }, 30_000);

  it('duplicate register is generic and silent; reset changes the password and kills sessions', async () => {
    await svc.register({ email: 'user@example.com', password: 'pw-12345' });
    const again = await svc.register({ email: 'user@example.com', password: 'other-pw' });
    expect(again).toEqual({ message: GENERIC_CODE_MESSAGE });
    expect(outbox.queue).toHaveBeenCalledTimes(1);

    await svc.verifyEmail({ email: 'user@example.com', code: lastCode() });
    const tokens = await svc.login({ email: 'user@example.com', password: 'pw-12345' });

    const req = await svc.requestPasswordReset({ email: 'user@example.com' });
    expect(req).toEqual({ message: GENERIC_CODE_MESSAGE });
    await svc.confirmPasswordReset({
      email: 'user@example.com',
      code: lastCode(),
      newPassword: 'new-pw-678',
    });
    await expect(svc.refresh({ refreshToken: tokens.refreshToken })).rejects.toThrow(
      'TOKEN_INVALID',
    );
    await expect(svc.login({ email: 'user@example.com', password: 'pw-12345' })).rejects.toThrow(
      'INVALID_CREDENTIALS',
    );
    await expect(
      svc.login({ email: 'user@example.com', password: 'new-pw-678' }),
    ).resolves.toBeTruthy();
  }, 30_000);

  it('authenticated changePassword works under the self policies and revokes sessions', async () => {
    await svc.register({ email: 'user@example.com', password: 'pw-12345' });
    await svc.verifyEmail({ email: 'user@example.com', code: lastCode() });
    const tokens = await svc.login({ email: 'user@example.com', password: 'pw-12345' });
    const row = await userRow('user@example.com');
    await svc.changePassword(
      { role: 'CUSTOMER', userId: row.id },
      { currentPassword: 'pw-12345', newPassword: 'new-pw-678' },
    );
    await expect(svc.refresh({ refreshToken: tokens.refreshToken })).rejects.toThrow(
      'TOKEN_INVALID',
    );
    await expect(
      svc.login({ email: 'user@example.com', password: 'new-pw-678' }),
    ).resolves.toBeTruthy();
  }, 30_000);
});
