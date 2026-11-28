import { ArgumentsHost, Catch, ExceptionFilter, PayloadTooLargeException } from '@nestjs/common';
import { toSafeError } from '../../../common/errors/safe-error';

interface HttpResponseLike {
  status(code: number): { json(body: unknown): unknown };
}

/**
 * Normalizes the multer/Nest payload-limit rejection (a multipart body over the 5 MB
 * cap) into the standard safe error shape (5.4, 6.8) instead of Nest's default body.
 */
@Catch(PayloadTooLargeException)
export class PayloadTooLargeFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<HttpResponseLike>();
    res
      .status(413)
      .json(toSafeError('PAYLOAD_TOO_LARGE', 'The image exceeds the 5 MB upload limit.'));
  }
}
