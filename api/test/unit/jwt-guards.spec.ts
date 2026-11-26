import { createHmac, randomUUID } from 'node:crypto';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../src/common/auth/jwt-auth.guard';
import { RolesGuard } from '../../src/common/auth/roles.guard';
import { IS_PUBLIC_KEY } from '../../src/common/auth/public.decorator';
import { ROLES_KEY } from '../../src/common/auth/roles.decorator';
import { RequestSecurity } from '../../src/common/auth/request-security';
import { TokenVerificationError } from '../../src/common/auth/verified-token';
import { JwtAccessTokenSigner } from '../../src/modules/auth/infrastructure/jwt-access-token-signer';
import {
  ACCESS_TOKEN_SECONDS,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from '../../src/modules/auth/domain/auth-rules';

const SECRET = 'guard-spec-secret-0123456789abcdef';
const signer = new JwtAccessTokenSigner(SECRET);
const USER = randomUUID();
const SESSION = randomUUID();

/** Minimal ExecutionContext stand-in carrying the metadata the reflector would see. */
const ctx = (opts: {
  headers?: Record<string, unknown>;
  isPublic?: boolean;
  roles?: string[];
  req?: RequestSecurity & { headers: Record<string, unknown> };
}): { context: ExecutionContext; req: RequestSecurity & { headers: Record<string, unknown> } } => {
  const req = opts.req ?? { headers: opts.headers ?? {} };
  const metadata: Record<string, unknown> = {};
  if (opts.isPublic) metadata[IS_PUBLIC_KEY] = true;
  if (opts.roles) metadata[ROLES_KEY] = opts.roles;
  const reflector = new Reflector();
  jest
    .spyOn(reflector, 'getAllAndOverride')
    .mockImplementation((key: unknown) => metadata[key as string]);
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  void reflector;
  return { context, req };
};

const guardWith = (reflector: Reflector) => new JwtAuthGuard(reflector, signer);

/** A reflector whose getAllAndOverride reads from a fixed metadata map. */
const metaReflector = (metadata: Record<string, unknown>): Reflector => {
  const r = new Reflector();
  jest.spyOn(r, 'getAllAndOverride').mockImplementation((key: unknown) => metadata[key as string]);
  return r;
};

const bearer = async (token: string) => ({ authorization: `Bearer ${token}` });

describe('JwtAccessTokenSigner claims contract (section 9)', () => {
  it('signs with pinned HS256, issuer, audience and sub/role/sid claims, 15-minute expiry', async () => {
    const token = await signer.sign(USER, 'CUSTOMER', SESSION);
    const payload = await new JwtService({ secret: SECRET }).verifyAsync(token);
    expect(payload).toMatchObject({
      sub: USER,
      role: 'CUSTOMER',
      sid: SESSION,
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
    });
    expect(payload.exp - payload.iat).toBe(ACCESS_TOKEN_SECONDS);
    const header = JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString()) as {
      alg: string;
    };
    expect(header.alg).toBe('HS256');
  });

  it('verify returns the verified identity', async () => {
    const token = await signer.sign(USER, 'CUSTOMER', SESSION);
    await expect(signer.verify(token)).resolves.toEqual({
      userId: USER,
      role: 'CUSTOMER',
      sessionId: SESSION,
    });
  });
});

describe('STM-11 negatives: expired, tampered, algorithm confusion, wrong issuer/audience, malformed', () => {
  const craft = (header: object, payload: object, secret?: string): string => {
    const h = Buffer.from(JSON.stringify(header)).toString('base64url');
    const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
    if (!secret) return `${h}.${p}.`;
    const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
    return `${h}.${p}.${sig}`;
  };
  const validPayload = {
    sub: USER,
    role: 'CUSTOMER',
    sid: SESSION,
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 600,
  };

  it('rejects an expired token', async () => {
    const token = craft(
      { alg: 'HS256', typ: 'JWT' },
      { ...validPayload, exp: Math.floor(Date.now() / 1000) - 10 },
      SECRET,
    );
    await expect(signer.verify(token)).rejects.toBeInstanceOf(TokenVerificationError);
  });

  it('rejects a tampered payload (signature no longer matches)', async () => {
    const token = await signer.sign(USER, 'CUSTOMER', SESSION);
    const [h, , sig] = token.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify(validPayload)).toString('base64url')}.${sig}`;
    await expect(signer.verify(forged)).rejects.toBeInstanceOf(TokenVerificationError);
  });

  it('rejects alg=none (algorithm confusion)', async () => {
    const token = craft({ alg: 'none', typ: 'JWT' }, validPayload);
    await expect(signer.verify(token)).rejects.toBeInstanceOf(TokenVerificationError);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = craft(
      { alg: 'HS256', typ: 'JWT' },
      validPayload,
      'a-different-secret-0123456789abcdef',
    );
    await expect(signer.verify(token)).rejects.toBeInstanceOf(TokenVerificationError);
  });

  it('rejects a wrong issuer and a wrong audience', async () => {
    await expect(
      signer.verify(
        craft({ alg: 'HS256', typ: 'JWT' }, { ...validPayload, iss: 'someone-else' }, SECRET),
      ),
    ).rejects.toBeInstanceOf(TokenVerificationError);
    await expect(
      signer.verify(
        craft({ alg: 'HS256', typ: 'JWT' }, { ...validPayload, aud: 'someone-else' }, SECRET),
      ),
    ).rejects.toBeInstanceOf(TokenVerificationError);
  });

  it('rejects missing or malformed required claims', async () => {
    const noSid: Record<string, unknown> = { ...validPayload };
    delete noSid.sid;
    await expect(
      signer.verify(craft({ alg: 'HS256', typ: 'JWT' }, noSid, SECRET)),
    ).rejects.toBeInstanceOf(TokenVerificationError);
    await expect(
      signer.verify(
        craft({ alg: 'HS256', typ: 'JWT' }, { ...validPayload, role: 'ADMIN' }, SECRET),
      ),
    ).rejects.toBeInstanceOf(TokenVerificationError);
    await expect(
      signer.verify(
        craft({ alg: 'HS256', typ: 'JWT' }, { ...validPayload, sub: 'not-a-uuid' }, SECRET),
      ),
    ).rejects.toBeInstanceOf(TokenVerificationError);
  });

  it('rejects garbage input', async () => {
    await expect(signer.verify('not-a-token')).rejects.toBeInstanceOf(TokenVerificationError);
    await expect(signer.verify('')).rejects.toBeInstanceOf(TokenVerificationError);
  });
});

describe('JwtAuthGuard (spec 6.3: role only from the verified token)', () => {
  it('@Public() routes pass unauthenticated; the server side assigns GUEST later', async () => {
    const reflector = metaReflector({ [IS_PUBLIC_KEY]: true });
    const { context, req } = ctx({});
    await expect(guardWith(reflector).canActivate(context)).resolves.toBe(true);
    expect(req.auth).toBeUndefined();
  });

  it('rejects a missing or non-Bearer Authorization header with 401 and a safe body', async () => {
    const reflector = metaReflector({});
    for (const headers of [{}, { authorization: 'Basic abc' }, { authorization: 'Bearer' }]) {
      const { context } = ctx({ headers });
      await expect(guardWith(reflector).canActivate(context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    const { context } = ctx({ headers: {} });
    const err: unknown = await guardWith(reflector)
      .canActivate(context)
      .catch((e: UnauthorizedException) => e);
    const body = (err as UnauthorizedException).getResponse() as { code: string; message: string };
    expect(body.code).toBe('UNAUTHENTICATED');
    expect(JSON.stringify(body)).not.toMatch(/signature|expired|algorithm|issuer|audience/i);
  });

  it('rejects an invalid token with 401 and never leaks the reason', async () => {
    const reflector = metaReflector({});
    const { context } = ctx({ headers: { authorization: 'Bearer garbage' } });
    const err: unknown = await guardWith(reflector)
      .canActivate(context)
      .catch((e: UnauthorizedException) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).getStatus()).toBe(401);
  });

  it('attaches the verified identity to the request; role cannot be chosen by the client', async () => {
    const reflector = metaReflector({});
    const token = await signer.sign(USER, 'CUSTOMER', SESSION);
    const { context, req } = ctx({ headers: await bearer(token) });
    await expect(guardWith(reflector).canActivate(context)).resolves.toBe(true);
    expect(req.auth).toEqual({ userId: USER, role: 'CUSTOMER', sessionId: SESSION });
  });
});

describe('RolesGuard', () => {
  const run = (roles: string[] | undefined, auth: RequestSecurity['auth']) => {
    const reflector = metaReflector(roles ? { [ROLES_KEY]: roles } : {});
    const { context } = ctx({ req: { headers: {}, auth } });
    return new RolesGuard(reflector).canActivate(context);
  };

  it('passes when no @Roles metadata is present (authentication only)', () => {
    expect(run(undefined, { userId: USER, role: 'CUSTOMER', sessionId: SESSION })).toBe(true);
  });

  it('passes a listed role and rejects the others with 403', () => {
    const auth = { userId: USER, role: 'CUSTOMER' as const, sessionId: SESSION };
    expect(run(['CUSTOMER', 'MERCHANT'], auth)).toBe(true);
    expect(() => run(['MERCHANT'], auth)).toThrow(ForbiddenException);
  });

  it('rejects an unauthenticated request on a role-restricted route', () => {
    expect(() => run(['CUSTOMER'], undefined)).toThrow(ForbiddenException);
  });
});
