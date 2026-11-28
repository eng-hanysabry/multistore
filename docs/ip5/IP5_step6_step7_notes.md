# IP-5 Steps 6-7 implementation notes

Batch 3 (Steps 6 + 7) plus the Blocker B fix of 28 Nov 2026. Steps 1-5 notes live in
`IP5_step4_step5_notes.md`; the schema and decisions register in `IP5_schema_design.md`.

## Step 6: media module (upload, processing, serving)

- NestJS `media` module: multipart upload (jpeg/png/webp only, reject SVG/GIF -
  approved deviation D1), sharp processing into three WebP variants, replacement with
  new object keys per generation (approved deviation D2), orphan recording for failed
  external deletes (G-4/G-7; DI-1 retries remain Deferred).
- Object keys: `media/{tenantId}/{assetId}/{variant}/{generationUuid}` - no file
  extension (the StorageProvider port forbids dots in keys) and a fresh generation UUID
  on every replace, so old objects are never overwritten (G-4).
- RLS: `media_public_read` exposes only ACTIVE PRODUCT_IMAGE rows of published products
  to GUEST/CUSTOMER; merchant policies scope the rest. Deleting an image of a PUBLISHED
  product is refused (unpublish first); the publish guard at the database requires at
  least one ACTIVE PRODUCT_IMAGE for any publish transition.

### Public image route (approved deviation D3)

`GET /t/{tenantCode}/products/{productId}/media/{mediaId}/image?size=original|display|thumb`

- `size` selects the variant; **`display` is the default** when the parameter is absent
  (documented in the OpenAPI contract via the `ImageQueryDto` Swagger decorator).
- `display`: WebP rendition capped at 1024 px. `thumb`: WebP rendition capped at 256 px.
- **`original` means the full-size rendition after EXIF orientation correction,
  re-encoded to WebP. It is NOT a byte-for-byte copy of the uploaded file**: metadata is
  stripped, orientation is baked in, dimensions are capped at 4000 px (J10).
- Serving runs under the caller's own RLS context on every request: tenant, product
  publication state and role are re-evaluated per request, so a cached response can
  never widen access (8.6.12). Draft or other-tenant media is the same 404 as
  nonexistent. No storage key, `drive_file_key` or provider URL ever appears in a
  response.
- Cache policy (M-8): published image bytes `public, max-age=60`; draft or
  authorization-dependent bytes `private, no-store`.

## Step 7: cache correctness (M-8)

- Published catalog JSON: `Cache-Control: no-cache` with a **strong ETag** (SHA-256 over
  the exact serialized representation). Conditional requests are answered 304 only after
  the representation has been rebuilt through the RLS-backed read, so visibility is
  always re-evaluated first and a 304 can never return an obsolete or unauthorized
  representation.
- No server-side response cache and no stale-extension directives anywhere; the 60 s
  image window is the maximum approved staleness.

## Blocker B fix (28 Nov 2026): public catalog image URL

The public catalog (listing and detail) now exposes `imageUrl: string | null` on each
product: the D3 route of the product's first eligible image.

- Eligible = ACTIVE PRODUCT_IMAGE. Selection is deterministic: earliest `created_at`,
  `id` as tie-breaker. No eligible image renders `null`.
- The RLS policy (`media_public_read`) already restricts the selection subquery to
  exactly the visible rows; the query repeats the kind/status/tenant predicates
  explicitly. Only the media id leaves the database - never `drive_file_key`, object
  keys or internal paths - and the service converts it into the URL and drops the raw
  field before serialization.
- The `tenantCode` in the URL is the one resolved and validated by
  TenantResolverGuard in the same request context, never request input.
- Merchant responses are unchanged.

### ETag semantics with `imageUrl` (documented decision)

- The strong ETag covers the serialized representation, and `imageUrl` is part of it.
  Changing the **selected** image (first image removed or a new earlier image appears)
  changes the URL, therefore the ETag; an old ETag no longer produces a 304.
- Changes to **non-selected** images do not alter the representation and do not move the
  ETag. The ETag does not claim to track every change in the product's image set - only
  the representation actually returned.
- **Replacing** the selected image keeps the same media id and therefore the same URL:
  the catalog representation and its ETag are unchanged, and a conditional GET can still
  be 304. The new bytes are served under the same URL with `public, max-age=60`, so
  clients pick up the new generation within the approved 60 s window. This is the
  intended trade-off of key-addressed variant URLs under M-8, not a staleness bug.
- Covered by RLS-backed HTTP tests in `api/test/rls/cache.rls.spec.ts`
  (selected-image change, non-selected-image change, replacement, 304 behavior) and
  `api/test/rls/public-catalog.rls.spec.ts` / `public-catalog-http.rls.spec.ts`
  (exposure, null cases, deterministic selection, cross-tenant and leakage scans).

## Linux x64 smoke test (sharp, J11)

Recorded environment and result of the Step 6 smoke test:

- OS: Ubuntu 22.04.5 LTS, x86_64
- glibc: 2.35
- Node.js: v24.22.3
- sharp: 0.35.5 with the native `@img/sharp-linux-x64` binding
- Result: PASS - real uploads processed end to end (orientation correction, variant
  renditions at the documented dimensions, WebP output), served back through the D3
  route.

This is a **Linux x64 smoke test only**. It is NOT a Vercel deployment and NOT evidence
of actual operation on Vercel; no Vercel validation has been performed or claimed.
