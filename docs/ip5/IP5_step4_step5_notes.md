# IP-5 Batch 2 notes (Step 4 public catalog, Step 5 storage abstraction)

## Step 4 — public catalog

### Endpoints (all under /t/:tenantCode, tenant resolved server-side by TenantResolverGuard)

- GET /t/:tenantCode/categories?limit=&cursor= — published categories, cursor page.
- GET /t/:tenantCode/products?q=&categoryId=&limit=&cursor= — published products, optional name search and category filter, cursor page.
- GET /t/:tenantCode/products/:id — public product detail.

List envelope: { items: [...], nextCursor: string | null }.

### Authentication model

@Public routes: no token -> server-assigned GUEST context. A supplied Bearer token must
verify; an invalid or expired token is 401, never a silent downgrade to Guest. With any
valid token (Customer or Merchant), reads run under the CUSTOMER RLS context. GUEST and
CUSTOMER policies are both published-only, so no token widens public visibility.

### Search behavior

- Single parameter q, product-name only, case-insensitive contains (ILIKE).
- Max 100 characters; empty rejected; everything parameterized.
- LIKE wildcards (%, _, backslash) are escaped and matched literally with ESCAPE '\'.
- Always scoped to the resolved URL tenant by RLS (products_public_read).
- No fuzzy search, no pg_trgm, no extensions, no external services.

### Pagination behavior

- Keyset (cursor) pagination, ordering (created_at, id) ascending, id as tie-breaker, so
  duplicate created_at values paginate stably with no duplicates or gaps.
- Page size: default 20, max 50; the query fetches limit+1 rows and the extra row only
  decides whether nextCursor exists.
- Cursor: base64url(JSON {c: created_at text, i: id}); strict decode — malformed,
  wrong-shaped, over-long or injection-shaped cursors are a safe 400.
- Malformed id path parameters (non-UUID) are the same safe 404 as a nonexistent id
  (STM-21 covers id fields; also applied to the Batch 1 merchant paths).

### Leakage protection

Public projections contain only: id, name, (products: description, priceAmount,
priceCurrency, categoryId, publishedAt, createdAt). No tenant_id, created_by, status,
updated_at, media or storage fields, and no Drive identifiers anywhere. Automated
response-shape scans cover every public endpoint (integration and HTTP).

## G-12 / STM-24 status (required documentation)

- G-12 remains OPEN. STM-24 has NOT passed.
- Rate limiting is required for the public catalog and search surface (spec 8.6/STM-24:
  per-IP and per-account thresholds, 429 with Retry-After). @nestjs/throttler is
  approved for this surface but its installation is NOT authorized in Batch 2, and no
  rate-limit storage or service may be introduced.
- Outstanding evidence for G-12: dependency installation (separate approval), threshold
  configuration, STM-24 test results (429 + Retry-After + later legitimate success).
- Step 4 routes exist and are tested locally only; they are not deployed or externally
  exposed.

## Step 5 — StorageProvider abstraction

- Port: src/modules/media/domain/storage-provider.ts (store/retrieve/delete, key +
  content-type model, no URLs or provider handles).
- Local double: src/modules/media/infrastructure/local-storage-double.ts (in-memory,
  copy-on-read/write; the only provider implementation authorized in Batch 2).
- Reusable contract suite: test/contract/storage-provider.contract.ts (9 tests). The
  Drive adapter in Step 8 must pass this same suite.
- Key convention: {tenantId}/{productId}/{mediaId} (product images),
  {tenantId}/logo/{mediaId} (logos) — matches media_assets.drive_file_key.
- No Drive adapter, OAuth, credentials, buckets, or public links. No sharp or any
  image processing; the upload pipeline remains Step 6.
