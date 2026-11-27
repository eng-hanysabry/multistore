import { CatalogError } from './catalog-errors';

/**
 * Public catalog search and cursor-pagination rules (IP-5 Step 4; spec 4.2, 8.6, STM-21).
 * Pure functions: no framework, no database. Limits are the approved ones: query length
 * max 100 characters, page size max 50, ordering (created_at, id) with the id as the
 * tie-breaker so duplicate timestamps paginate stably.
 */

export const PUBLIC_MAX_QUERY_LENGTH = 100;
export const PUBLIC_MAX_PAGE_SIZE = 50;
export const PUBLIC_DEFAULT_PAGE_SIZE = 20;
export const PUBLIC_MAX_CURSOR_LENGTH = 400;

export interface Cursor {
  /** created_at of the last row of the previous page, exact timestamptz text. */
  readonly createdAt: string;
  /** id of the last row of the previous page (tie-breaker). */
  readonly id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify({ c: cursor.createdAt, i: cursor.id }), 'utf8').toString(
    'base64url',
  );
}

/** Strict decode; any malformed input is a safe 400, never a query with garbage values. */
export function decodeCursor(raw: string): Cursor {
  if (raw.length < 1 || raw.length > PUBLIC_MAX_CURSOR_LENGTH) throw new CatalogError('VALIDATION');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new CatalogError('VALIDATION');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new CatalogError('VALIDATION');
  const o = parsed as Record<string, unknown>;
  if (typeof o['c'] !== 'string' || typeof o['i'] !== 'string')
    throw new CatalogError('VALIDATION');
  // created_at text must round-trip through Postgres as a timestamp; reject other shapes here.
  if (o['c'].length > 40 || Number.isNaN(Date.parse(o['c']))) throw new CatalogError('VALIDATION');
  if (!UUID.test(o['i'])) throw new CatalogError('VALIDATION');
  return { createdAt: o['c'], id: o['i'] };
}

export function assertSearchQuery(q: string): void {
  if (q.length < 1 || q.length > PUBLIC_MAX_QUERY_LENGTH) throw new CatalogError('VALIDATION');
}

export function assertPageSize(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > PUBLIC_MAX_PAGE_SIZE)
    throw new CatalogError('VALIDATION');
}

/**
 * Escapes LIKE wildcards so %, _ and \ are matched literally (STM-21). The query itself
 * is always parameterized; this is the second layer so user input cannot change the
 * match semantics.
 */
export function escapeLikePattern(q: string): string {
  return q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
