import { CatalogError } from '../../src/modules/catalog/domain/catalog-errors';
import {
  CATEGORY_NAME_MAX,
  IDEMPOTENCY_KEY_MAX,
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_NAME_MAX,
  assertCategoryDeletable,
  assertCategoryName,
  assertCategoryUnpublishable,
  assertIdempotencyKey,
  assertProductDeletable,
  assertProductDraft,
  assertProductFields,
  assertProductPublishable,
  assertProductUnpublishable,
  assertPublishableCategory,
  assertUuidParam,
  assertValidPrice,
} from '../../src/modules/catalog/domain/catalog-rules';

/** Pure catalog rules (spec 8.6/8.7, approved decisions M-1, M-3, M-4, J9). */
const code = (fn: () => void): string => {
  try {
    fn();
  } catch (e) {
    return (e as CatalogError).code;
  }
  return '';
};

describe('assertValidPrice (M-1)', () => {
  it('accepts both null and both populated', () => {
    expect(() => assertValidPrice({})).not.toThrow();
    expect(() => assertValidPrice({ priceAmount: null, priceCurrency: null })).not.toThrow();
    expect(() => assertValidPrice({ priceAmount: 0, priceCurrency: 'EGP' })).not.toThrow();
    expect(() => assertValidPrice({ priceAmount: 12.345, priceCurrency: 'USD' })).not.toThrow();
  });
  it('rejects a half-populated pair', () => {
    expect(code(() => assertValidPrice({ priceAmount: 10 }))).toBe('VALIDATION');
    expect(code(() => assertValidPrice({ priceCurrency: 'EGP' }))).toBe('VALIDATION');
    expect(code(() => assertValidPrice({ priceAmount: null, priceCurrency: 'EGP' }))).toBe(
      'VALIDATION',
    );
  });
  it('rejects negative, non-finite and malformed currency', () => {
    expect(code(() => assertValidPrice({ priceAmount: -1, priceCurrency: 'EGP' }))).toBe(
      'VALIDATION',
    );
    expect(code(() => assertValidPrice({ priceAmount: Number.NaN, priceCurrency: 'EGP' }))).toBe(
      'VALIDATION',
    );
    expect(code(() => assertValidPrice({ priceAmount: 1, priceCurrency: 'egp' }))).toBe(
      'VALIDATION',
    );
    expect(code(() => assertValidPrice({ priceAmount: 1, priceCurrency: 'EG' }))).toBe(
      'VALIDATION',
    );
  });
});

describe('field limits', () => {
  it('category name 1..120', () => {
    expect(code(() => assertCategoryName(''))).toBe('VALIDATION');
    expect(code(() => assertCategoryName('x'.repeat(CATEGORY_NAME_MAX + 1)))).toBe('VALIDATION');
    expect(() => assertCategoryName('x'.repeat(CATEGORY_NAME_MAX))).not.toThrow();
  });
  it('product name 1..200, description <= 5000', () => {
    expect(code(() => assertProductFields({ name: '' }))).toBe('VALIDATION');
    expect(code(() => assertProductFields({ name: 'x'.repeat(PRODUCT_NAME_MAX + 1) }))).toBe(
      'VALIDATION',
    );
    expect(
      code(() =>
        assertProductFields({ name: 'ok', description: 'x'.repeat(PRODUCT_DESCRIPTION_MAX + 1) }),
      ),
    ).toBe('VALIDATION');
    expect(() =>
      assertProductFields({ name: 'ok', description: 'x'.repeat(PRODUCT_DESCRIPTION_MAX) }),
    ).not.toThrow();
    expect(() => assertProductFields({ name: 'ok', description: null })).not.toThrow();
  });
  it('idempotency key 1..128', () => {
    expect(code(() => assertIdempotencyKey(''))).toBe('VALIDATION');
    expect(code(() => assertIdempotencyKey('x'.repeat(IDEMPOTENCY_KEY_MAX + 1)))).toBe(
      'VALIDATION',
    );
    expect(() => assertIdempotencyKey('x'.repeat(IDEMPOTENCY_KEY_MAX))).not.toThrow();
  });
});

describe('assertUuidParam (STM-21 id fields)', () => {
  it('accepts UUIDs, rejects anything else as NOT_FOUND', () => {
    expect(() => assertUuidParam('11111111-1111-4111-8111-111111111111')).not.toThrow();
    expect(code(() => assertUuidParam('not-a-uuid'))).toBe('NOT_FOUND');
    expect(code(() => assertUuidParam("1' OR '1'='1"))).toBe('NOT_FOUND');
    expect(code(() => assertUuidParam(''))).toBe('NOT_FOUND');
  });
});

describe('lifecycle rules (J9, M-3, M-4, 8.7)', () => {
  it('category publish only from DRAFT', () => {
    expect(() => assertPublishableCategory('DRAFT')).not.toThrow();
    expect(code(() => assertPublishableCategory('PUBLISHED'))).toBe('INVALID_STATE');
  });
  it('category unpublish blocked while published products reference it (M-4)', () => {
    expect(code(() => assertCategoryUnpublishable('DRAFT', 0))).toBe('INVALID_STATE');
    expect(code(() => assertCategoryUnpublishable('PUBLISHED', 2))).toBe(
      'CATEGORY_HAS_PUBLISHED_PRODUCTS',
    );
    expect(() => assertCategoryUnpublishable('PUBLISHED', 0)).not.toThrow();
  });
  it('category delete only DRAFT and unreferenced', () => {
    expect(code(() => assertCategoryDeletable('PUBLISHED', 0))).toBe('INVALID_STATE');
    expect(code(() => assertCategoryDeletable('DRAFT', 1))).toBe('CATEGORY_IN_USE');
    expect(() => assertCategoryDeletable('DRAFT', 0)).not.toThrow();
  });
  it('product publish gate: draft, published category, active image (8.7, M-3)', () => {
    expect(
      code(() =>
        assertProductPublishable({ status: 'PUBLISHED', categoryPublished: null, activeImages: 1 }),
      ),
    ).toBe('INVALID_STATE');
    expect(
      code(() =>
        assertProductPublishable({ status: 'DRAFT', categoryPublished: false, activeImages: 1 }),
      ),
    ).toBe('CATEGORY_NOT_PUBLISHED');
    expect(
      code(() =>
        assertProductPublishable({ status: 'DRAFT', categoryPublished: true, activeImages: 0 }),
      ),
    ).toBe('IMAGE_REQUIRED');
    expect(
      code(() =>
        assertProductPublishable({ status: 'DRAFT', categoryPublished: null, activeImages: 0 }),
      ),
    ).toBe('IMAGE_REQUIRED');
    expect(() =>
      assertProductPublishable({ status: 'DRAFT', categoryPublished: true, activeImages: 1 }),
    ).not.toThrow();
    expect(() =>
      assertProductPublishable({ status: 'DRAFT', categoryPublished: null, activeImages: 3 }),
    ).not.toThrow();
  });
  it('product delete blocked while media references exist (ON DELETE RESTRICT)', () => {
    expect(code(() => assertProductDeletable('PUBLISHED', 0))).toBe('INVALID_STATE');
    expect(code(() => assertProductDeletable('DRAFT', 1))).toBe('PRODUCT_HAS_MEDIA');
    expect(() => assertProductDeletable('DRAFT', 0)).not.toThrow();
  });
  it('product unpublish only from PUBLISHED; drafts only for edit/delete', () => {
    expect(code(() => assertProductUnpublishable('DRAFT'))).toBe('INVALID_STATE');
    expect(() => assertProductUnpublishable('PUBLISHED')).not.toThrow();
    expect(code(() => assertProductDraft('PUBLISHED'))).toBe('INVALID_STATE');
    expect(() => assertProductDraft('DRAFT')).not.toThrow();
  });
});
