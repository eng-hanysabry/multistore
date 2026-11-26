# IP-4 acceptance evidence (identity and tenancy — local database round)

Date: 26 Nov 2026, updated after checklist steps 5–11. Scope: IP-4 schema, migration, Prisma schema and tenant-scoped transaction runner, authentication/session modules, role guards and tenant resolution, STM-01..20 + 6.4/6.6 tests, reruns, CI/coverage, OpenAPI/dependencies — all on local PostgreSQL only. Repo: https://github.com/eng-hanysabry/multistore, main at the commit that carries this file.
Authority: your IP-4 approval and checklist (Telegram 21341113/21341125), schema review A–G (21435287), step-2 authorization (21446009), updated approval with corrections A–D (21512898). Boundaries honored: no migration on real Supabase, no Vercel deploy, no real data, no new dependencies beyond the ones you approved, DI-1 stays Deferred, no Security Gate closed by this document, no IP-5 work.

## What was done, in order
1. Step 2 (read-only Supabase metadata): clean, details in `docs/ip4/IP4_schema_design.md` section 11. Raw output preserved in the task workspace (`supabase_metadata_out.txt`, query timestamps 26 Nov 14:06:39–40 UTC, run as multistore_owner over the pooler, TLS verified). No writes of any kind were run.
2. Corrections A–D applied to the approved v2 SQL; two gaps found and fixed during testing (owner policies for the approved 7-day cleanup and manual ops; admin policies to make the approved admin grants effective). All seven changes are listed in `IP4_schema_design.md` section 0 (v3).
3. Migration written: `api/prisma/migrations/20261126160002_ip4_identity_tenancy/migration.sql`. No seeds inside it.
4. Migration applied from scratch on a clean local database (fresh `ip4_clean` database, applied as multistore_owner, after the IP-3 base migration) — success, 27 policies created. Full Jest run on real local PostgreSQL 16.2, plus lint, typecheck and format checks.
5. Step 5 — Prisma schema for the 7 IP-4 tables plus the tenant-scoped transaction runner (`SET LOCAL` of the `app.*` context keys inside every tenant transaction, so RLS applies to the app's own queries). Commit `f86887c`.
6. Step 6 — Authentication and session modules: Argon2id hashing, registration, email verification codes, login, sessions, refresh rotation, logout, password reset and change, outbox mail for codes. Commits `43111e0`, `c25dc39`, `f4da5f1`. Four issues found during testing and fixed:
   - Expiry inserts on `auth_codes`/`sessions`/`refresh_tokens` use `LEAST(jsValue, now() + interval)` in the raw SQL: the JS clock runs milliseconds ahead of the DB clock and violated the migration CHECK constraints.
   - Refresh-reuse detection commits the session revocation before the request fails (post-commit throw); a rollback would have silently un-revoked the session.
   - STM-12 scope: reuse and logout revoke only their own session (new `AuthStore.revokeSession`), not every session of the user.
   - Refresh token TTL is 14 days, capped at the parent session expiry (design doc v3 section 8). Daily verification/reset code cap: `DAILY_CODE_CAP = 10` per login email.
7. Step 7 — Role guards and tenant resolution, three commits:
   - `d1ebbc1`: JWT claims contract pinned (HS256 only, `iss=multistore-api`, `aud=multistore-app`, claims `{sub, role, sid}`) and the `common/auth` kernel: `AccessTokenVerifier` port, `JwtAuthGuard`, `RolesGuard`, `@Public()` / `@Roles()` decorators.
   - `74d3a25`: `TenantResolver` with a 60-second cache, `TenantResolverGuard`, `MembershipChecker`, `MerchantMembershipGuard`, RLS e2e tests.
   - `b6cf49d`: `AuthModule` + `AuthController` + DTOs, global `ValidationPipe` with `whitelist`, `AuthErrorFilter`, HTTP e2e. Found and fixed: with a pool of one connection, sending mail inside the tenant transaction deadlocked; outbox mail is now queued after commit, never inside the runner transaction.
8. Step 8 — STM tests over HTTP: `902a5b5` (STM-14 replay, STM-16 mass assignment, STM-18 credential-isolation tripwire).
9. Step 9 — reruns on the final code (26 Nov ~17:00 Cairo): `ip4.rls.spec.ts` 35/35 (STM-09 RLS-only rerun), `matrix.rls.spec.ts` 26/26 (STM-19 pool-of-one interleave), `migration-lints.spec.ts` 8/8, `npm run lint:migrations` 0 violations.
10. Step 10 — CI and coverage: every commit listed below is green on CI (lint, format, typecheck, migration lint, contract check, full tests with the coverage gate). Local full run `jest --runInBand --coverage`: **22 suites, 205 tests, all passed**; coverage: statements 97.03%, branches 93.82%, functions 94.59%, lines 97.77% (configured gates: 80/70/80/80).
11. Step 11 — OpenAPI contract regenerated with all nine `/auth/*` routes (`ContractModule` now lists `AuthController`; `npm run contract:check` is enforced in CI): `96d85d2`. `docs/dependencies.md` verified complete against `api/package.json`: argon2 and @nestjs/jwt carry your IP-4 approvals (Telegram 21341113); passport, @nestjs/passport, passport-jwt and @nestjs/throttler are recorded as not added, by your decision.

## Files changed
- `api/prisma/migrations/20261126160002_ip4_identity_tenancy/migration.sql` (new; 7 tables, trigger, grants, 32 policies, default-privilege revokes)
- `api/prisma/schema.prisma` (7 IP-4 models)
- `api/src/common/tenancy/` (tenant context, runner, resolver, membership guard), `api/src/common/auth/` (verifier port, guards, decorators, request security)
- `api/src/modules/auth/` (application services/stores, presentation controller and DTOs, infrastructure adapters)
- `api/test/rls/ip4.rls.spec.ts` (new; 35 tests), `api/test/rls/harness.ts` (extended: context keys `app.tenant_code`, `app.login_email`, `app.token_hash`; no change to existing behavior), plus new suites `auth-flows.rls.spec.ts`, `auth-http.rls.spec.ts`, `tenant-resolution.rls.spec.ts`, `tenancy-runner.rls.spec.ts`, `matrix.rls.spec.ts` and unit suites `jwt-guards`, `tenant-guards`, `tenant-context`, `auth-service`, `argon2-secret-hasher`, `credential-isolation`
- `api/scripts/generate-openapi.ts` (ContractModule lists `AuthController`), `contracts/openapi.json` (regenerated)
- `docs/ip4/IP4_schema_design.md` (v2 -> v3: corrections A–D, the two gap fixes, step-2 metadata results, status)
- `docs/evidence/ip4/IP4_acceptance_evidence.md` (this file)

## Environment
Local sandbox PostgreSQL 16.2 (pgserver), roles `multistore_owner`, `multistore_app` (NOBYPASSRLS, NOSUPERUSER), `multistore_admin` (NOBYPASSRLS, NOSUPERUSER, CONNECTION LIMIT 3). Migrations applied through the same code path as deploy (`applyMigration` runs the SQL as multistore_owner). Seeds are inserted by the test superuser because FORCE RLS binds the owner; no seed rows ship in the migration. Nothing touched your real Supabase project.

## Test results (all real, nothing marked from code alone)
- Full suite `jest --runInBand --coverage` on real local PostgreSQL 16.2: **22 suites, 205 tests, all passed**, coverage 97.03/93.82/94.59/97.77 (statements/branches/functions/lines) against gates 80/70/80/80.
- IP-4 database suite breakdown (`test/rls/ip4.rls.spec.ts`):
  - 6.6 role/privilege model: RLS enabled+forced on all 7 tables; table-level grants exactly the approved minimum; correction B column-restricted UPDATEs (app cannot update `token_hash`, `user_id`, `session_id`, `code_hash`, `purpose`, `expires_at`); zero grants to PUBLIC/anon/authenticated/service_role; admin fully blocked from `auth_codes`/`sessions`/`refresh_tokens`; admin users read limited to `(id, email, status, created_at)`; STM-19 admin connection cap = 3.
  - 6.4 policy matrix per table: tenants (resolve-by-code, self, suspended hidden, no-context zero rows), users (login lookup, register constraints, self-read), memberships (MERCHANT/CUSTOMER self, admin manage), auth_codes (GUEST scoped to login email, 10-minute CHECK, immutable fields), sessions (issue/lookup/revoke, 30-day CHECK, correction D scope), refresh_tokens (hash lookup, rotation FK order, correction A negatives, revoked-session containment), audit_log (own-tenant write, admin read, owner 90-day prune).
  - Correction C trigger tests: GUEST self-activation without a consumed code rejected; full verification flow (consume code, then activate) accepted; authenticated user changing own status/email_verified_at rejected; is_super_admin change rejected; reviewed owner operation works.
- Migration lint (`npm run lint:migrations`, STM-20): 0 violations (also enforced by `test/unit/migration-lints.spec.ts`, 8 tests).
- Typecheck `tsc --noEmit`: clean. ESLint: clean. Prettier: clean.

## Correction evidence map (your item 3)
- A (refresh_issue): qualified columns + `s.expires_at = session_expires_at` in the EXISTS; negative tests "issue rejects a forged session_expires_at or a foreign session" and "revoked session cannot mint new refresh tokens" — both rejected by RLS; valid issue accepted.
- B (UPDATE privileges): column list asserted exactly from `information_schema.column_privileges`; attempts to update immutable columns raise permission denied (tests in the auth_codes/sessions/refresh_tokens describes).
- C (D-S2): owner exemption + consumed-code requirement, tests listed above.
- D (session_guest_lookup): zero rows with no key; only own sessions via login_email or token-resolved user; scope rationale recorded in the migration SQL comment and design doc v3 item 4.

## STM coverage, honestly mapped (checklist: STM-01..20 plus 6.4/6.6)
- Covered: STM-09 (RLS-only rerun), STM-10 (valid-token happy paths in `auth-http.rls.spec.ts`), STM-11 (missing/expired/tampered/algorithm-confusion tokens rejected — `jwt-guards` unit tests and over HTTP), STM-12 (refresh reuse revokes the session; old pair dies), STM-13 (password change revokes every session), STM-14 (code replay, attempt cap, 10-minute expiry — database mechanics and over HTTP), STM-16 (mass assignment of `role`/`is_super_admin`/`tenant_id` rejected by the DTO whitelist, no row created), STM-18 (runtime cannot read `ADMIN_DATABASE_URL` outside `AdminModule` — config tripwire), STM-19 (pool-of-one interleave, 40 rounds), STM-20 (migration lints, 0 violations). 6.4 policy matrix and 6.6 privilege model for the 7 IP-4 tables (step 4). Also tested though outside STM-01..20: login failures are enumeration-proof (8.6.8).
- N/A in IP-4 — the attack surface does not exist yet, recorded rather than faked: STM-01..07 (product, favorites, cart, order, export/analytics, search/list endpoints are IP-5+ scope; the step-7 tenant-resolution groundwork they will build on is in place and tested), STM-08 (no tenant-scoped background jobs exist in IP-4), STM-15 (no `/admin/*` or Merchant-only endpoints exist yet; role rejection itself is unit-tested in the guards), STM-17 (no admin routes exist yet; forged role claims are already rejected by the STM-11 signature checks, and the membership database re-check is unit-tested).
- Open: STM-24 / spec 8.6.7 per-IP throttling. Application-level caps exist (code attempt cap, `DAILY_CODE_CAP = 10`), but per-IP rate limiting would need `@nestjs/throttler`, which you have not approved. Held pending your decision; nothing was added.

## Commits and CI (all https://github.com/eng-hanysabry/multistore/actions/runs/<id>)
- `a932cf5` step 4: migration + suites + doc v3 (run 45837146266 failed format:check only; fixed by `caa70ff`).
- `caa70ff` style: prettier. `c23e6d1` fix: conditional revokes for Supabase platform roles (run 45837400846 failed because CI's vanilla postgres:16 has no anon/authenticated/service_role roles; revokes are now per-existing-role; verified locally in both shapes). Run 45837833023 — success.
- `f86887c` step 5: Prisma schema + tenant runner — run 45838436609 success.
- `43111e0` step 6 parts 1–2 — run 45838896687 success; `c25dc39` — run 45839901305 success; `f4da5f1` step 6 part 3 (auth-flows e2e + the four fixes) — run 45840961395 success.
- `d1ebbc1` step 7 (JWT contract + auth kernel) — run 45841966379 success; `74d3a25` (tenant resolution) — run 45842312410 success; `b6cf49d` (AuthModule + HTTP e2e) — run 45843049392 success.
- `902a5b5` step 8 — run 45843576419 success.
- `96d85d2` step 11 (OpenAPI contract with auth routes) — run 45844187850 success.

## Security Gates
All gates remain **OPEN**. This document is evidence for your review, not a closure request.

## Caveats
1. Local PostgreSQL is 16.2; your Supabase project is PG 17.12. The SQL uses no version-specific features beyond RLS/triggers; the real-Supabase run remains subject to your separate approval.
2. The `audit_log.request_id` column is uuid (lint `uuid-fk` requires every `*_id` to be uuid); the API will generate UUIDv4 request ids. Noted in design v3 item 7.
3. The two gap fixes (owner policies, admin policies) are additions to the reviewed v2 SQL. They widen nothing beyond the grants you already approved, but they are new policy rows; they are listed in design v3 items 5–6 for your review.
4. A `session_expires_at` round-tripped through a JavaScript Date loses sub-millisecond precision and fails the correction-A equality check; the code passes the value read from the session row through as exact text (the step 5–7 modules follow this).
5. STM items marked N/A above have no IP-4 attack surface; each will need its test when the corresponding endpoints land (IP-5+). They are listed here so nothing is silently skipped.
6. STM-24 / spec 8.6.7 per-IP throttling is an open decision with you (see the STM coverage section). No dependency was added.
