import { createHash } from 'node:crypto';

/**
 * M-8 cache header values (Batch 1 decision, implemented in Step 7). Published catalog
 * JSON revalidates on every request (no-cache + ETag, so publish/unpublish is visible
 * immediately at the catalog layer); published image bytes may be cached for at most 60
 * seconds; anything private or authorization-dependent is never stored. No
 * stale-while-revalidate or stale-if-error directive is used anywhere: the approved
 * stale-content window can never be extended.
 */
export const PUBLISHED_CATALOG_CACHE_CONTROL = 'no-cache';
export const PUBLISHED_IMAGE_MAX_AGE_SECONDS = 60;
export const PRIVATE_CACHE_CONTROL = 'private, no-store';

/** Strong ETag over the exact serialized representation. */
export function etagFor(serialized: string): string {
  return `"${createHash('sha256').update(serialized).digest('hex')}"`;
}

/** RFC 7232 If-None-Match comparison (list syntax; strong comparison for GET). */
export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (ifNoneMatch === undefined) return false;
  return ifNoneMatch
    .split(',')
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === etag || candidate === `W/${etag}`);
}
