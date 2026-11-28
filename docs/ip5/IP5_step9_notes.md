# IP-5 Step 9 notes — G-12 public catalog rate limiting (local, uncommitted)

Authorization: Telegram 30039255 / 30039259 / 30039263 / 30039264 (28 Nov 2026 14:44),
proceed decision 31673372 (28 Nov 2026 21:32). Local implementation only — not staged,
not committed, not pushed. G-12 and G-21 remain OPEN; passing STM-24 does not close
G-12 (her explicit condition). DI-1 remains Deferred.

## Scope

Throttling is applied with `@UseGuards(PublicCatalogThrottlerGuard)` on
`PublicCatalogController` only. There is no global `APP_GUARD`, so nothing else is
affected.

Protected routes (all three are in the authorized scope — public listing, categories,
product detail, and public search via `q`):

- `GET /t/:tenantCode/categories`
- `GET /t/:tenantCode/products` (also the public search route: `?q=`)
- `GET /t/:tenantCode/products/:id`

Explicitly unaffected (verified by test: no throttle headers, no 429):

- All merchant routes (`/t/:tenantCode/merchant/**`)
- Customer-authenticated routes (auth module)
- Authentication endpoints
- Media upload / replace / delete
- The public image-serving route (`/t/:tenantCode/products/:productId/media/:mediaId/image`) — not named in J5/A-07, not added
- Health/readiness (`/health/live`, `/health/ready`)

## Dependency

`@nestjs/throttler` **6.8.0**, pinned exact (no range). Compatibility verified against
the registry at install time: peer dependencies `@nestjs/core` and `@nestjs/common`
`^7 || ^8 || ^9 || ^10 || ^11 || ^12` (repo runs NestJS 12.6.x) and `reflect-metadata`
`^0.1.13 || ^0.2.0`; engines `node ^20.19 || ^22.12 || >=24` (repo runs Node 24). 6.8.0
is also the latest published version. Installed with a plain pinned `npm install` — no
`--force`, no `--legacy-peer-deps`, no overrides; no conflict appeared. Zero new runtime
transitive dependencies. No Redis, no database counters, no external service, no extra
background cleanup jobs (the library's own in-memory sweep interval is internal to its
storage service and was left at its default).

## Limits and TTL (provisional)

- 60 requests per 60 seconds (`ttl: 60_000` ms) per client IP **per endpoint**.
- Source: no numeric limits were fixed in the spec, J5, or A-07, so this is the
  provisional conservative default suggested by the authorization (B3). It is
  configuration, not logic: `PUBLIC_CATALOG_RATE_LIMIT` and
  `PUBLIC_CATALOG_RATE_LIMIT_TTL_MS` (milliseconds; the config validator rejects
  non-positive integers). **Provisional — needs tuning from real usage; it is not
  evidence for closing G-12.**
- Tests use 3 requests / 60 s so no test waits on the real TTL.
- Counter key = SHA-256 of `ControllerName-handlerName-throttlerName + clientIdentity`
  (library `generateKey`), so counters are independent per endpoint and per client.

## Trusted client IP (B4)

Expected request path: client → Vercel edge (rewrites `x-vercel-forwarded-for` and
`x-forwarded-for` at the edge; a direct client cannot inject them through Vercel) → API
origin. Mode comes from `PUBLIC_CATALOG_TRUSTED_PROXY`:

- `none` (default; local runs, tests, and any deployment where the origin is reachable
  directly): the tracker is the socket IP. Every client-sent forwarded header is
  ignored, so spoofing a header cannot mint a fresh counter (tested).
- `vercel`: only the **leftmost** value of `x-vercel-forwarded-for` is trusted (the
  client IP the Vercel edge observed). `x-forwarded-for` is never read. A missing or
  malformed value falls back to the socket IP — fail-closed, the fallback shares one
  counter instead of handing out fresh ones (tested). `x-vercel-id` is never used as
  proof of origin.

**Origin-protection condition (assumption, not verified on any deployment):** `vercel`
mode is only valid while the API origin cannot be reached from the internet except
through Vercel. If the origin is directly reachable, a client can spoof
`x-vercel-forwarded-for` and mint unlimited identities — in that topology the deployment
must run `none` (socket IP) or pin a proxy policy first. No Vercel configuration or
deployment was performed; this behavior was not verified against a real Vercel
deployment. `app.set('trust proxy', true)` is **not** set anywhere.

IPv4 is used as observed. IPv6 is normalized to its `/64` subnet (library `normalizeIp`,
`DEFAULT_IPV6_SUBNET_PREFIX = 64`) so rotating interface identifiers within a subscriber
prefix cannot reset the quota (tested).

## 429 behavior (B5)

- HTTP 429 with the project's safe error envelope: `{ code: "RATE_LIMITED", message,
  requestId }` via `ThrottlerErrorFilter` (added to the controller's `@UseFilters`). No
  internal detail (limit, key, tracker) is exposed.
- The default (unnamed) throttler is used, so the guard emits the standard, suffix-free
  `Retry-After` header (named throttlers would emit `Retry-After-<name>`). The header is
  set on the response before the exception is thrown, and the filter only rewrites the
  body, so `Retry-After` survives. Value: whole seconds until the window resets,
  positive and ≤ TTL (tested).
- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` are also emitted by
  the library on passing responses; they do not conflict with `Retry-After`.
- No 429 is converted to a 500 (the filter is controller-scoped and tested). No
  server-side automatic retries were added.

## OpenAPI (B8)

`@ApiTooManyRequestsResponse` was added at the controller level, documenting the 429
body (the same safe error schema) and the `Retry-After` header. Regenerated with the
project's official path (`npm run contract:generate`); the resulting diff touches only
the three public catalog routes (one added `429` response each, nothing removed).
`contract:check` passes.

## In-memory, per-instance limitation (B7)

Counters live in the throttler's default in-memory storage:

- They are local to each application instance/process — **not global**.
- With N instances, each instance has its own counter and the effective total request
  budget scales by N.
- This is **not** distributed or global rate limiting and must not be described as such.
- No Redis, database counters, external rate-limiting service, shared storage, or extra
  background cleanup jobs were added.

## STM-24 (B6) — executed, real HTTP against the real Nest application

`api/test/rls/public-catalog-rate-limit.rls.spec.ts` (8 tests, all passing). The suite
uses test-only limits (3/60 s), two app instances (one per trusted-proxy mode, each with
fresh in-memory storage so no test pollution), and covers: under-limit pass with
rate-limit headers; over-limit 429; Retry-After positive and ≤ TTL; envelope unchanged;
endpoint isolation; per-IP independent counters; same-IP counter reuse; Vercel forwarded
IP in trusted mode; spoofed forwarded headers ignored in `none` mode; malformed/missing
header fallback without fresh-counter bypass; IPv4 and IPv6 (/64 normalization); merchant
and health routes unaffected (no headers, no 429).

## Gates

G-12 stays OPEN pending her independent review and acceptance. G-21 stays OPEN. DI-1
Deferred.
