import {
  PUBLIC_DEFAULT_PAGE_SIZE,
  PUBLIC_MAX_CURSOR_LENGTH,
  PUBLIC_MAX_PAGE_SIZE,
  PUBLIC_MAX_QUERY_LENGTH,
  assertPageSize,
  assertSearchQuery,
  decodeCursor,
  encodeCursor,
  escapeLikePattern,
} from '../../src/modules/catalog/domain/public-catalog-rules';
import { CatalogError } from '../../src/modules/catalog/domain/catalog-errors';

const code = (fn: () => void): string => {
  try {
    fn();
  } catch (e) {
    return (e as CatalogError).code;
  }
  return '';
};

/** Public search and cursor rules (approved limits: q <= 100 chars, page <= 50). */
describe('cursor encode/decode', () => {
  it('round-trips a valid cursor', () => {
    const c = {
      createdAt: '2026-11-27 12:34:56.789+00',
      id: '11111111-1111-4111-8111-111111111111',
    };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it('rejects malformed cursors safely', () => {
    expect(code(() => decodeCursor(''))).toBe('VALIDATION');
    expect(code(() => decodeCursor('not-base64!!!'))).toBe('VALIDATION');
    expect(code(() => decodeCursor(Buffer.from('{"c":1}').toString('base64url')))).toBe(
      'VALIDATION',
    );
    expect(
      code(() => decodeCursor(Buffer.from('{"c":"yesterday","i":"x"}').toString('base64url'))),
    ).toBe('VALIDATION');
    expect(
      code(() =>
        decodeCursor(
          Buffer.from('{"c":"2026-11-27 12:00:00+00","i":"not-a-uuid"}').toString('base64url'),
        ),
      ),
    ).toBe('VALIDATION');
    expect(code(() => decodeCursor(Buffer.from('[1,2]').toString('base64url')))).toBe('VALIDATION');
    expect(code(() => decodeCursor('x'.repeat(PUBLIC_MAX_CURSOR_LENGTH + 1)))).toBe('VALIDATION');
  });
  it('rejects injection-shaped cursor content', () => {
    const evil = Buffer.from(
      JSON.stringify({ c: "2026-01-01' OR '1'='1", i: '11111111-1111-4111-8111-111111111111' }),
    ).toString('base64url');
    expect(code(() => decodeCursor(evil))).toBe('VALIDATION');
  });
});

describe('search and page-size limits', () => {
  it('query length 1..100', () => {
    expect(code(() => assertSearchQuery(''))).toBe('VALIDATION');
    expect(code(() => assertSearchQuery('x'.repeat(PUBLIC_MAX_QUERY_LENGTH + 1)))).toBe(
      'VALIDATION',
    );
    expect(() => assertSearchQuery('x'.repeat(PUBLIC_MAX_QUERY_LENGTH))).not.toThrow();
  });
  it('page size 1..50, integers only', () => {
    expect(code(() => assertPageSize(0))).toBe('VALIDATION');
    expect(code(() => assertPageSize(PUBLIC_MAX_PAGE_SIZE + 1))).toBe('VALIDATION');
    expect(code(() => assertPageSize(2.5))).toBe('VALIDATION');
    expect(code(() => assertPageSize(Number.NaN))).toBe('VALIDATION');
    expect(() => assertPageSize(1)).not.toThrow();
    expect(() => assertPageSize(PUBLIC_MAX_PAGE_SIZE)).not.toThrow();
    expect(PUBLIC_DEFAULT_PAGE_SIZE).toBeLessThanOrEqual(PUBLIC_MAX_PAGE_SIZE);
  });
  it('escapes LIKE wildcards literally (STM-21)', () => {
    expect(escapeLikePattern('100% cotton')).toBe('100\\% cotton');
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
    expect(escapeLikePattern('back\\slash')).toBe('back\\\\slash');
    expect(escapeLikePattern('plain')).toBe('plain');
    expect(escapeLikePattern('%_\\')).toBe('\\%\\_\\\\');
  });
});
