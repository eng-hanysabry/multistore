import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { toSafeError } from '../../../common/errors/safe-error';
import { MediaError, MediaErrorCode } from '../domain/media-errors';

interface HttpResponseLike {
  status(code: number): { json(body: unknown): unknown };
}

/**
 * Media domain errors to HTTP with safe bodies (5.4, 6.8). NOT_FOUND is deliberately the
 * same shape for "no such media in your tenant/visibility" and "no such media at all":
 * the existence of other tenants' content or drafts is never revealed (8.3). Storage
 * failures surface as a generic 500 with no provider detail.
 */
const MAP: Record<MediaErrorCode, { status: number; message: string }> = {
  NOT_FOUND: { status: 404, message: 'Not found.' },
  VALIDATION: { status: 400, message: 'The request is invalid.' },
  INVALID_IMAGE: { status: 400, message: 'The file is not a valid image.' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: 'This image format is not supported.' },
  PAYLOAD_TOO_LARGE: { status: 413, message: 'The image exceeds the 5 MB upload limit.' },
  DIMENSIONS_TOO_LARGE: {
    status: 400,
    message: 'The image exceeds the 4000 px dimension limit.',
  },
  MEDIA_ON_PUBLISHED_PRODUCT: {
    status: 409,
    message: 'Unpublish the product before removing this image.',
  },
  STORAGE_FAILURE: { status: 500, message: 'The image could not be stored. Try again.' },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    message: 'This idempotency key was used with a different request.',
  },
};

@Catch(MediaError)
export class MediaErrorFilter implements ExceptionFilter {
  catch(exception: MediaError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<HttpResponseLike>();
    const mapped = MAP[exception.code] ?? { status: 400, message: 'The request failed.' };
    res.status(mapped.status).json(toSafeError(exception.code, mapped.message));
  }
}
