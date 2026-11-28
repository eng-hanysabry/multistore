import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { toSafeError } from '../../../common/errors/safe-error';

interface HttpResponseLike {
  status(code: number): { json(body: unknown): unknown };
}

/**
 * 429 responses use the same safe error envelope as every other API error (5.4, 6.8):
 * a code, a safe message and a requestId, with no internal detail. The throttler guard
 * has already set the Retry-After header on this same response before throwing, and this
 * filter only rewrites the body, so the header survives (authorization 30039263/B5).
 */
@Catch(ThrottlerException)
export class ThrottlerErrorFilter implements ExceptionFilter {
  catch(_exception: ThrottlerException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<HttpResponseLike>();
    res.status(429).json(toSafeError('RATE_LIMITED', 'Too many requests. Retry later.'));
  }
}
