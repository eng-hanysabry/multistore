import { CatalogError } from './catalog-errors';

/**
 * Catalog lifecycle and validation rules (spec 8.6, 8.7; approved decisions M-1..M-10 of
 * the Batch 1 authorization). Pure functions: no framework, no database (5.3). The same
 * rules are enforced at the database level by CHECK constraints, RLS policies and the
 * SECURITY INVOKER guard triggers; these checks exist so the API returns clean domain
 * errors instead of raw database failures.
 */

export type CatalogStatus = 'DRAFT' | 'PUBLISHED';
export type MediaKind = 'PRODUCT_IMAGE' | 'STORE_LOGO';
export type MediaStatus = 'UPLOADING' | 'ACTIVE' | 'FAILED' | 'ORPHANED';

export const CATEGORY_NAME_MAX = 120;
export const PRODUCT_NAME_MAX = 200;
export const PRODUCT_DESCRIPTION_MAX = 5000;
export const IDEMPOTENCY_KEY_MAX = 128;

const CURRENCY = /^[A-Z]{3}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * STM-21: a path id that is not a UUID can never name a row. Reject it with the same
 * NOT_FOUND as a nonexistent id so malformed input never reaches a SQL cast (which
 * would surface as a 500).
 */
export function assertUuidParam(id: string): void {
  if (!UUID.test(id)) throw new CatalogError('NOT_FOUND');
}

export interface PriceInput {
  readonly priceAmount?: number | null;
  readonly priceCurrency?: string | null;
}

/** M-1: both price fields NULL together or populated together; amount >= 0; ISO 4217 shape. */
export function assertValidPrice(input: PriceInput): void {
  const amount = input.priceAmount ?? null;
  const currency = input.priceCurrency ?? null;
  if ((amount === null) !== (currency === null)) throw new CatalogError('VALIDATION');
  if (amount !== null && (!Number.isFinite(amount) || amount < 0))
    throw new CatalogError('VALIDATION');
  if (currency !== null && !CURRENCY.test(currency)) throw new CatalogError('VALIDATION');
}

export function assertCategoryName(name: string): void {
  if (name.length < 1 || name.length > CATEGORY_NAME_MAX) throw new CatalogError('VALIDATION');
}

export function assertProductFields(input: { name: string; description?: string | null }): void {
  if (input.name.length < 1 || input.name.length > PRODUCT_NAME_MAX)
    throw new CatalogError('VALIDATION');
  if (
    input.description !== undefined &&
    input.description !== null &&
    input.description.length > PRODUCT_DESCRIPTION_MAX
  )
    throw new CatalogError('VALIDATION');
}

/** 10.7: when a client sends an Idempotency-Key it must fit the stored shape. */
export function assertIdempotencyKey(key: string): void {
  if (key.length < 1 || key.length > IDEMPOTENCY_KEY_MAX) throw new CatalogError('VALIDATION');
}

export function assertPublishableCategory(status: CatalogStatus): void {
  if (status !== 'DRAFT') throw new CatalogError('INVALID_STATE');
}

/** M-4: a category cannot be unpublished while published products reference it. */
export function assertCategoryUnpublishable(
  status: CatalogStatus,
  publishedProducts: number,
): void {
  if (status !== 'PUBLISHED') throw new CatalogError('INVALID_STATE');
  if (publishedProducts > 0) throw new CatalogError('CATEGORY_HAS_PUBLISHED_PRODUCTS');
}

/** J9: categories delete only while DRAFT and unreferenced. */
export function assertCategoryDeletable(status: CatalogStatus, referencingProducts: number): void {
  if (status !== 'DRAFT') throw new CatalogError('INVALID_STATE');
  if (referencingProducts > 0) throw new CatalogError('CATEGORY_IN_USE');
}

/** Product publish gate (8.7 + M-3): DRAFT, published category if assigned, ACTIVE image. */
export function assertProductPublishable(input: {
  status: CatalogStatus;
  categoryPublished: boolean | null; // null: no category assigned
  activeImages: number;
}): void {
  if (input.status !== 'DRAFT') throw new CatalogError('INVALID_STATE');
  if (input.categoryPublished === false) throw new CatalogError('CATEGORY_NOT_PUBLISHED');
  if (input.activeImages === 0) throw new CatalogError('IMAGE_REQUIRED');
}

export function assertProductUnpublishable(status: CatalogStatus): void {
  if (status !== 'PUBLISHED') throw new CatalogError('INVALID_STATE');
}

/** J9: products delete only while DRAFT; updates happen on drafts (unpublish first). */
export function assertProductDraft(status: CatalogStatus): void {
  if (status !== 'DRAFT') throw new CatalogError('INVALID_STATE');
}

/**
 * Product delete also requires that no media assets reference it: the FK is
 * ON DELETE RESTRICT and the media lifecycle (including Drive cleanup) belongs to the
 * media steps, so images must be removed through those endpoints before deletion.
 */
export function assertProductDeletable(status: CatalogStatus, mediaReferences: number): void {
  assertProductDraft(status);
  if (mediaReferences > 0) throw new CatalogError('PRODUCT_HAS_MEDIA');
}
