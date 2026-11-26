import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { toSafeError } from '../../../common/errors/safe-error';
import { AuthError, AuthErrorCode } from '../domain/auth-errors';

interface HttpResponseLike {
  status(code: number): { json(body: unknown): unknown };
}

/**
 * Maps the domain error codes to HTTP with safe, enumeration-proof bodies (8.6.8):
 * login failures never say which part was wrong; code failures never say whether the
 * account exists. The one documented exception is EMAIL_NOT_VERIFIED (section 9).
 */
const MAP: Record<AuthErrorCode, { status: number; message: string }> = {
  INVALID_CREDENTIALS: { status: 401, message: 'Invalid email or password.' },
  EMAIL_NOT_VERIFIED: { status: 403, message: 'Verify your email before signing in.' },
  CODE_INVALID: { status: 400, message: 'The code is invalid.' },
  CODE_EXPIRED: { status: 400, message: 'The code has expired.' },
  CODE_TOO_MANY_ATTEMPTS: { status: 400, message: 'Too many attempts. Request a new code.' },
  RESEND_COOLDOWN: { status: 429, message: 'Please wait before requesting another code.' },
  DAILY_CODE_CAP: { status: 429, message: 'Too many codes requested today.' },
  TOKEN_INVALID: { status: 401, message: 'Authentication required.' },
};

@Catch(AuthError)
export class AuthErrorFilter implements ExceptionFilter {
  catch(exception: AuthError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<HttpResponseLike>();
    const mapped = MAP[exception.code] ?? { status: 400, message: 'The request failed.' };
    res.status(mapped.status).json(toSafeError(exception.code, mapped.message));
  }
}
