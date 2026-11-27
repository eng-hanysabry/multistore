import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { toSafeError } from '../../../common/errors/safe-error';
import { CatalogError, CatalogErrorCode } from '../domain/catalog-errors';

interface HttpResponseLike {
  status(code: number): { json(body: unknown): unknown };
}

/**
 * Domain errors to HTTP with safe bodies (5.4, 6.8). NOT_FOUND is deliberately the same
 * shape for "no such row in your tenant" and "no such row at all": the existence of other
 * tenants' content is never revealed (8.3).
 */
const MAP: Record<CatalogErrorCode, { status: number; message: string }> = {
  NOT_FOUND: { status: 404, message: 'Not found.' },
  VALIDATION: { status: 400, message: 'The request is invalid.' },
  INVALID_STATE: { status: 409, message: 'The record is not in a state that allows this.' },
  CATEGORY_NOT_PUBLISHED: {
    status: 409,
    message: 'Publish the category before publishing this product.',
  },
  IMAGE_REQUIRED: {
    status: 409,
    message: 'Add at least one active product image before publishing.',
  },
  CATEGORY_HAS_PUBLISHED_PRODUCTS: {
    status: 409,
    message: 'Unpublish the products in this category first.',
  },
  CATEGORY_IN_USE: {
    status: 409,
    message: 'Remove the products from this category before deleting it.',
  },
  PRODUCT_HAS_MEDIA: {
    status: 409,
    message: 'Remove the product images before deleting it.',
  },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    message: 'This idempotency key was used with a different request.',
  },
};

@Catch(CatalogError)
export class CatalogErrorFilter implements ExceptionFilter {
  catch(exception: CatalogError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<HttpResponseLike>();
    const mapped = MAP[exception.code] ?? { status: 400, message: 'The request failed.' };
    res.status(mapped.status).json(toSafeError(exception.code, mapped.message));
  }
}
