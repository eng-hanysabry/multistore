/**
 * Catalog domain error codes. API responses carry the code with a safe message only
 * (spec 5.4, 6.8): no row data, no stack, no hint about other tenants' content.
 */
export type CatalogErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'INVALID_STATE'
  | 'CATEGORY_NOT_PUBLISHED'
  | 'IMAGE_REQUIRED'
  | 'CATEGORY_HAS_PUBLISHED_PRODUCTS'
  | 'CATEGORY_IN_USE'
  | 'PRODUCT_HAS_MEDIA'
  | 'IDEMPOTENCY_CONFLICT';

export class CatalogError extends Error {
  constructor(public readonly code: CatalogErrorCode) {
    super(code);
    this.name = 'CatalogError';
  }
}
