# IP-5 acceptance evidence (catalog, media, public API, rate limiting — local rounds)

Status labels used throughout: **PASS** (executed and green in the runs cited below), **FAIL**, **NOT RUN**, **NOT VERIFIED** (no direct evidence exists), **DEFERRED**. Local implementation evidence is kept separate from external operational evidence, which IP-5 does not have. No Security Gate is closed by anything in this file; all gates remain OPEN (DI-1 Deferred).

## 1. Scope and implementation summary

IP-5 delivered, in six local batches/steps on `main`:

- Step 2: catalog/media schema + RLS (migration `20261127221500_ip5_catalog_and_media`, applied as `multistore_owner` only).
- Step 3: merchant catalog backend core (service, repositories, idempotency, lifecycle).
- Step 4: public catalog APIs (categories, products, `?q=` search, cursor pagination) with tenant resolution and optional auth.
- Step 5: `StorageProvider` port + `LocalStorageDouble`.
- Steps 6+7 (Batch 3): media pipeline (sharp processing, upload/replace/delete, D3 image route, M-8 cache headers/ETag).
- Step 8: `DriveStorageProvider` using the googleapis public root only, with a fake Drive client (no real Google contact).
- Step 9: G-12 rate limiting on the three public catalog routes (`@nestjs/throttler` 6.8.0, the only new dependency), controller-scoped, no global guard.

## 2. Commit references (origin/main)

| Commit | Content |
|---|---|
| `34a8e79` | IP-5 batch 1: schema + RLS (step 2) + merchant catalog core (step 3) |
| `08b65b4` | IP-5 batch 2: public catalog APIs (step 4) + storage abstraction + local double (step 5) |
| `a369bf2` | IP-5 batch 3: media pipeline (steps 6+7) |
| `8c57118` | `feat(storage): add Google Drive storage provider` (step 8, 9 files) |
| `e8aec56` | `feat(catalog): add public catalog rate limiting` (step 9, 12 files) |

CI on `e8aec56` (head_sha verified for both): **api SUCCESS** https://github.com/eng-hanysabry/multistore/actions/runs/46183274493 — **app SUCCESS** https://github.com/eng-hanysabry/multistore/actions/runs/46183274501 (app triggered because `contracts/openapi.json` is in its path filter). Step 8 CI: api SUCCESS on `8c57118` (run 46146239234); app SKIPPED_BY_PATH_FILTER with byte-identical app tree, inherited SUCCESS on `a369bf2` (run 46144286007) — accepted as equivalent by her, Telegram 31673372.

## 3. Test execution environment and exact commands

- Repo `/home/sandbox/multistore`, HEAD `e8aec56`; runtime `npx -y node@24` (Node 24); real PostgreSQL 16 (local pgserver) at `127.0.0.1:54400`; RLS tests connect as `multistore_app` (migrations as `multistore_owner`; seeds as superuser because FORCE RLS binds the owner).
- Env for test runs: `PGHOST=127.0.0.1 PGPORT=54400 PGUSER=postgres PGDATABASE=postgres`.
- Commands used exactly as defined in `api/package.json`:
  - Coverage gate: `npx -y node@24 --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --coverage` (the `test:all` script form)
  - Unit: same runner with `--selectProjects unit --runInBand --forceExit` (`test`)
  - RLS/HTTP: `--selectProjects rls --runInBand --forceExit` (`test:rls`)
  - `npm run lint:migrations`, `npm run contract:check`, `npm run typecheck`, `npm run lint`, `npm run format:check`
- No script was invented; no threshold, jest config, or exclusion was changed; no test was added or removed for this evidence round.

## 4. Test results and coverage gate (executed 28 Nov 2026, ~21:55–21:57 UTC+2)

| Check | Result |
|---|---|
| Coverage gate (both projects, one run) | **PASS** — 39 suites, 398 tests, 0 failures |
| — of which unit project | 24 suites, 218 tests PASS |
| — of which rls project (real HTTP + real PG/RLS) | 15 suites, 180 tests PASS |
| Coverage vs thresholds (`coverageThreshold.global` in `api/jest.config.js`, unchanged) | **PASS** — statements 95.09% (≥80), branches 89.15% (≥70), functions 94.76% (≥80), lines 96.94% (≥80). Percentages computed from `coverage/coverage-final.json` totals (the json-summary reporter is not configured; coverage dir is git-ignored and was not committed) |
| Migration lint | **PASS** — 3 sql files, 102 source files, 0 violations |
| `contract:check` | **PASS** — contracts/openapi.json is up to date |
| TypeScript (`tsc --noEmit`) | **PASS** — 0 errors |
| ESLint | **PASS** — 0 findings |
| Prettier (`format:check`) | **PASS** — all matched files conform |

## 5. STM acceptance evidence (B3 matrix)

| STM | Verifies | Tests (file → location) | Last run result | Uncovered / deferred |
|---|---|---|---|---|
| STM-04 | Unauthorized draft/media access; draft visibility | `test/rls/public-catalog.rls.spec.ts` (`guest sees only published categories and products of the URL tenant`, line 163; `detail: draft, cross-tenant and unknown ids are the same NOT_FOUND`, line 181); `test/rls/public-catalog-http.rls.spec.ts` (draft-access block, line 138); media draft access in `test/rls/media-http.rls.spec.ts` | PASS (all suites green; 180/180 rls) | none known |
| STM-21 | SQL injection safety | `test/rls/public-catalog.rls.spec.ts` line 239 (`STM-21: injection payloads are safe and leave the database unchanged`); `test/rls/public-catalog-http.rls.spec.ts` line 257 (payloads over HTTP); `test/rls/media-http.rls.spec.ts` line 358; unit: `catalog-rules.spec.ts` line 91, `public-catalog-rules.spec.ts` line 76 | PASS | none known |
| STM-22 | XSS: inert storage, output encoding, `javascript:` URL rejection | none found: no IP-5 test references STM-22, XSS, or URL-scheme rejection | **NOT VERIFIED** — spec state remains "test specified". Not inferred from other suites. |
| STM-23 | File upload validation (disguised/malformed/oversized/over-dimension, cross-tenant, Guest) | `test/rls/media-http.rls.spec.ts` (11 tests; STM-23 tags at lines 105, 173, 305, 358) | PASS | none known |
| STM-24 | Rate limiting (public catalog scope) | `test/rls/public-catalog-rate-limit.rls.spec.ts` — 8 tests, real HTTP, two trusted-proxy modes | PASS 8/8 | `::ffff:` mapped forms not HTTP-tested (verified at library level only — see §10.1); no test can prove real origin protection (deployment property) |
| STM-27 | Cache tenant isolation, conditional requests, invalidation | `test/rls/cache.rls.spec.ts` (14 tests; header cites STM-27/M-8/8.6.12) | PASS | none known |
| STM-29 | Race conditions, idempotency | `test/rls/catalog-integration.rls.spec.ts` line 132 (`idempotency: sequential replay, hash conflict, and concurrent duplicate`); `test/rls/media-http.rls.spec.ts` line 219 (idempotent upload replay); `test/unit/media-service.spec.ts` line 259; `test/rls/ip3.rls.spec.ts` line 98 (concurrent claims); `test/rls/matrix.rls.spec.ts` line 268 (concurrent requests on one connection) | PASS | none known |

## 6. Tenant and role isolation matrix (B4)

Evidence lives in `test/rls/ip5.rls.spec.ts` (33 tests: GUEST/CUSTOMER/MERCHANT/`multistore_admin`/`multistore_owner` across all four IP-5 tables), `test/rls/matrix.rls.spec.ts` (26 tests), and the public-catalog/media HTTP suites. All rows PASS in the cited runs.

| Scenario | Expected | Proving test(s) | Actual |
|---|---|---|---|
| Guest reads only published rows of the URL tenant | 200 with published-only items | public-catalog.rls line 163 | PASS |
| Draft product detail (Guest/Customer) | same 404 as unknown id | public-catalog.rls line 181 | PASS |
| Cross-tenant reads (tenant A vs B), all roles | no row visible | ip5.rls.spec.ts cross-tenant matrix rows | PASS |
| Cross-tenant writes | rejected (RLS/composite FK) | ip5.rls.spec.ts composite-FK rejection rows | PASS |
| Unknown/suspended tenant in URL | 404, no detail | public-catalog-http.rls.spec.ts tenant-resolution tests | PASS |
| Bad/expired Bearer on public routes | 401, never silent Guest downgrade | public-catalog-http.rls.spec.ts | PASS |
| Merchant without membership on URL tenant | 403/404 per guard chain | catalog-http.rls.spec.ts guard-chain tests | PASS |
| Categories: published vs draft visibility | published only to public | public-catalog.rls line 232 | PASS |
| Media assets: draft served only to owning merchant | 404/403 otherwise | media-http.rls.spec.ts | PASS |
| Idempotency records: GUEST | no read/insert | ip5.rls.spec.ts line 309 | PASS |
| Idempotency records: CUSTOMER | own (tenant, user) scope only | ip5.rls.spec.ts line 321 | PASS |
| `multistore_admin` on catalog/media | read-only | matrix.rls.spec.ts line 401 | PASS |
| `multistore_admin` on idempotency_keys | no access | ip5.rls.spec.ts line 573 | PASS |
| Concurrent requests on one pooled connection | no tenant mixing | matrix.rls.spec.ts line 268 | PASS |

## 7. StorageProvider contract evidence (B5)

- Shared 9-test contract suite: `test/contract/storage-provider.contract.ts`.
- `LocalStorageDouble`: **9/9 PASS** (`test/unit/local-storage-double.spec.ts`, in the 218/218 unit run).
- `DriveStorageProvider` with fake/stub Drive client: **9/9 PASS** (`test/unit/drive-storage-provider.spec.ts` — "The full 9-test contract suite, unchanged, against the Drive adapter (B8, target 9/9)").
- Plus adapter-specific tests: key mapping via `appProperties.key`, duplicate-key conflict, vanishing-file race, provider failures never becoming null/false, error mapper passthrough, public-API-only client construction (offline).
- **Explicit caveat:** the Drive adapter was verified against a fake client only. This does not prove real Google Drive connectivity, OAuth, refresh tokens, folder permissions, or `drive.file` scope behavior on a real account. No Google operation was executed.

## 8. Media security and leakage evidence (B6)

- Response-projection leakage scan: `test/rls/public-catalog.rls.spec.ts` line 297 (`response projection carries no internal or storage fields (leakage scan)`) — PASS.
- HTTP response-shape scan on every public endpoint: `expectSafeShape` in `test/rls/public-catalog-http.rls.spec.ts` forbids `drive_file_key`, `drive`, `tenant_id`, `created_by`, `updated_at`, `media_assets`, `googleapis`, `stack` in any public payload — PASS.
- Public image URLs expose only the D3 route (`/t/:tenantCode/products/:productId/media/:mediaId/image`); no Drive file IDs, canonical storage keys, internal paths, or provider internals appear (same scans) — PASS.
- Public vs draft media access and media tenant isolation: `test/rls/media-http.rls.spec.ts` (11 tests) — PASS.
- ORPHANED records and partial-failure behavior (external-object delete after commit, G-4): `test/unit/media-service.spec.ts` and media RLS suites — PASS locally.
- **Not claimed:** real Drive storage behavior of any kind.

## 9. Cache, ETag and OpenAPI evidence (B7)

`test/rls/cache.rls.spec.ts` (14 tests, all PASS) covers: published catalog `Cache-Control: no-cache` + strong ETag (line 107); ETag changes with the representation (line 125); unpublish removes content with no stale 304 (line 150); cross-tenant isolation of the same path (line 165); selected-image changes moving the ETag (lines 247, 278, 298); published image bytes `max-age=60`, drafts `private, no-store` (line 318); unpublish stops public serving immediately (line 346); replacement serves new bytes under the same URL (line 361); authorization re-evaluated on every request (line 377); merchant endpoints `private, no-store` (line 388). D3 route and `imageUrl` projection: `public-catalog.rls` lines 266, `cache.rls` line 230. Conditional 304 only after the RLS-backed rebuild (M-8, 8.6.12) is the suite's stated design.

OpenAPI: `contract:check` PASS on `e8aec56`; the Step 9 diff added exactly one 429 response (documenting `Retry-After` and the safe error schema) to each of the three public catalog routes — full-path scan confirms no other path carries 429. Consistent with decisions D2 (key structure), D3 (image route), M-8 (no server-side response cache).

## 10. Rate limiting and STM-24 evidence

See §5 STM-24 row and `docs/ip5/IP5_step9_notes.md`. Guard `PublicCatalogThrottlerGuard` on `PublicCatalogController` only; provisional 60 req / 60 s per client IP per endpoint (config-driven, documented provisional); default unnamed throttler → suffix-free `Retry-After`; safe-envelope 429 (`RATE_LIMITED`); per-endpoint and per-client counters; 8/8 STM-24 HTTP tests PASS.

## 11. Known limitations and deferred items (B8, verbatim substance, no softening)

1. **IPv4-mapped IPv6 HTTP test:** no direct HTTP test exists for `::ffff:192.0.2.10` / `::ffff:198.51.100.20`. Normalization was verified hands-on against the installed `@nestjs/throttler` 6.8.0 `normalizeIp`: a mapped address becomes its embedded IPv4 identity. This is **verified library behavior with HTTP coverage absent** — not HTTP-tested.
2. **Vercel origin protection:** not implemented and not operationally proven. The code documents the precondition for trusting `x-vercel-forwarded-for` in `vercel` mode, but a condition in code or docs does not prove deployment protection. `PUBLIC_CATALOG_TRUSTED_PROXY=vercel` must not be considered safe to enable in any real environment until origin protection is operationally demonstrated.
3. **In-memory per-instance rate limiting:** throttler counters are in-memory, per application instance/process; not global, not distributed; no Redis or shared store; the effective quota can scale with instance count. **G-12 remains OPEN.**
4. **Google Drive / OAuth:** Step 8 verified with a fake/stub Drive client only. Not done: real Google Drive testing, OAuth flow, real refresh token, real folder permissions or `drive.file` scope, real upload/retrieve/delete of files.
5. **Vercel validation:** no Vercel deployment verification, no Vercel configuration verification, no operational proof of the trusted-proxy path or origin protection. The Linux sharp smoke test is not Vercel validation and is not described as such.
6. **Other deferred items:** DI-1 = **DEFERRED**; G-12 = **OPEN**; G-21 = **OPEN**; all other Security Gates remain **OPEN**.

## 12. Final acceptance status

- **Recommendation: Evidence complete with documented gaps** — specifically: STM-22 NOT VERIFIED (no test), IPv4-mapped forms not HTTP-tested, and no external operational evidence (Drive, OAuth, Vercel) by design.
- CI, coverage gate, and all suites pass on `e8aec56`. Security Gates: **all OPEN**, none closed by this file. DI-1: **DEFERRED**.
- Step 10 was local only: the only file created is this one. It is **unstaged, uncommitted, unpushed**; HEAD remains `e8aec56`.
