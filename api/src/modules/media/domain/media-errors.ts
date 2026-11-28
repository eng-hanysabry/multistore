/**
 * Media domain error codes (IP-5 Step 6). API responses carry the code with a safe
 * message only (spec 5.4, 6.8): no row data, no storage keys, no stack, no hint about
 * other tenants' content.
 */
export type MediaErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'INVALID_IMAGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'PAYLOAD_TOO_LARGE'
  | 'DIMENSIONS_TOO_LARGE'
  | 'MEDIA_ON_PUBLISHED_PRODUCT'
  | 'STORAGE_FAILURE'
  | 'IDEMPOTENCY_CONFLICT';

export class MediaError extends Error {
  constructor(public readonly code: MediaErrorCode) {
    super(code);
    this.name = 'MediaError';
  }
}
