# IP-4 acceptance evidence (identity and tenancy — local database round)

Date: 26 Nov 2026. Scope: IP-4 schema, migration and database-level RLS/privilege suites only. Repo: https://github.com/eng-hanysabry/multistore, main at the commit that carries this file.
Authority: your IP-4 approval and checklist (Telegram 21341113/21341125), schema review A–G (21435287), step-2 authorization (21446009), updated approval with corrections A–D (21512898). Boundaries honored: no migration on real Supabase, no Vercel deploy, no real data, no new dependencies, DI-1 stays Deferred, no Security Gate closed by this document, no IP-5 work.

## What was done, in order
1. Step 2 (read-only Supabase metadata): clean, details in `docs/ip4/IP4_schema_design.md` section 11. Raw output preserved in the task workspace (`supabase_metadata_out.txt`, query timestamps 26 Nov 14:06:39–40 UTC, run as multistore_owner over the pooler, TLS verified). No writes of any kind were run.
2. Corrections A–D applied to the approved v2 SQL; two gaps found and fixed during testing (owner policies for the approved 7-day cleanup and manual ops; admin policies to make the approved admin grants effective). All seven changes are listed in `IP4_schema_design.md` section 0 (v3).
3. Migration written: `api/prisma/migrations/20261126160002_ip4_identity_tenancy/migration.sql`. No seeds inside it.
4. Migration applied from scratch on a clean local database (fresh `ip4_clean` database, applied as multistore_owner, after the IP-3 base migration) — success, 27 policies created.
5. Full Jest run on real local PostgreSQL 16.2, plus lint, typecheck and format checks.

## Files changed
- `api/prisma/migrations/20261126160002_ip4_identity_tenancy/migration.sql` (new; 7 tables, trigger, grants, 32 policies, default-privilege revokes)
- `api/test/rls/ip4.rls.spec.ts` (new; 35 tests)
- `api/test/rls/harness.ts` (extended: context keys `app.tenant_code`, `app.login_email`, `app.token_hash`; no change to existing behavior)
- `docs/ip4/IP4_schema_design.md` (v2 -> v3: corrections A–D, the two gap fixes, step-2 metadata results, status)
- `docs/evidence/ip4/IP4_acceptance_evidence.md` (this file)

## Environment
Local sandbox PostgreSQL 16.2 (pgserver), roles `multistore_owner`, `multistore_app` (NOBYPASSRLS, NOSUPERUSER), `multistore_admin` (NOBYPASSRLS, NOSUPERUSER, CONNECTION LIMIT 3). Migrations applied through the same code path as deploy (`applyMigration` runs the SQL as multistore_owner). Seeds are inserted by the test superuser because FORCE RLS binds the owner; no seed rows ship in the migration. Nothing touched your real Supabase project.

## Test results (all real, nothing marked from code alone)
- Full suite `npx jest --runInBand` (unit + rls projects): **12 suites, 139 tests, all passed** (baseline before IP-4 was 11 suites / 104 tests; the IP-4 file adds 35).
- IP-4 suite breakdown (`test/rls/ip4.rls.spec.ts`):
  - 6.6 role/privilege model: RLS enabled+forced on all 7 tables; table-level grants exactly the approved minimum; correction B column-restricted UPDATEs (app cannot update `token_hash`, `user_id`, `session_id`, `code_hash`, `purpose`, `expires_at`); zero grants to PUBLIC/anon/authenticated/service_role; admin fully blocked from `auth_codes`/`sessions`/`refresh_tokens`; admin users read limited to `(id, email, status, created_at)`; STM-19 admin connection cap = 3.
  - 6.4 policy matrix per table: tenants (resolve-by-code, self, suspended hidden, no-context zero rows), users (login lookup, register constraints, self-read), memberships (MERCHANT/CUSTOMER self, admin manage), auth_codes (GUEST scoped to login email, 10-minute CHECK, immutable fields), sessions (issue/lookup/revoke, 30-day CHECK, correction D scope), refresh_tokens (hash lookup, rotation FK order, correction A negatives, revoked-session containment), audit_log (own-tenant write, admin read, owner 90-day prune).
  - Correction C trigger tests: GUEST self-activation without a consumed code rejected; full verification flow (consume code, then activate) accepted; authenticated user changing own status/email_verified_at rejected; is_super_admin change rejected; reviewed owner operation works.
- Migration lint (`npm run lint:migrations`, STM-20): 2 SQL files, 31 source files, **0 violations** (also enforced by `test/unit/migration-lints.spec.ts`).
- Typecheck `tsc --noEmit`: clean. ESLint: clean.

## Correction evidence map (your item 3)
- A (refresh_issue): qualified columns + `s.expires_at = session_expires_at` in the EXISTS; negative tests "issue rejects a forged session_expires_at or a foreign session" and "revoked session cannot mint new refresh tokens" — both rejected by RLS; valid issue accepted.
- B (UPDATE privileges): column list asserted exactly from `information_schema.column_privileges`; attempts to update immutable columns raise permission denied (tests in the auth_codes/sessions/refresh_tokens describes).
- C (D-S2): owner exemption + consumed-code requirement, tests listed above.
- D (session_guest_lookup): zero rows with no key; only own sessions via login_email or token-resolved user; scope rationale recorded in the migration SQL comment and design doc v3 item 4.

## STM coverage, honestly mapped
- Covered at the database level now: STM-09 (tenancy isolation on the new tables), STM-12/13/14 database mechanics (session issue/revoke, rotation order and reuse containment, code expiry and consumption), STM-19 (admin connection cap), STM-20 (migration lint, 0 violations), 6.4 matrix and 6.6 privilege model for the 7 new tables.
- **Not covered yet:** the API-level parts of STM-01..STM-20 (HTTP endpoints, DTOs, guards, Argon2 hashing in the modules, outbox integration for codes). Those need checklist steps 5–7 (Prisma schema, tenant runner, auth modules), which are the next approved steps in order. Nothing about them is claimed here.

## Commits and CI
- `a932cf5` IP-4 step 4: migration + suites + doc v3 + this evidence file.
- `caa70ff` style: prettier (first CI run 45837146266 failed format:check only).
- `c23e6d1` fix: conditional revokes for Supabase platform roles (second CI run 45837400846 failed at the test step because CI's vanilla postgres:16 has no anon/authenticated/service_role roles; revokes are now per-existing-role; verified locally in both shapes).
- CI: https://github.com/eng-hanysabry/multistore/actions/runs/45837833023 — **success** on `c23e6d1` (lint, format, typecheck, migration lint, contract check, 139 tests with coverage gate).

## Security Gates
All gates remain **OPEN**. This document is evidence for your review, not a closure request.

## Caveats
1. Local PostgreSQL is 16.2; your Supabase project is PG 17.12. The SQL uses no version-specific features beyond RLS/triggers; the real-Supabase run remains subject to your separate approval.
2. The `audit_log.request_id` column is uuid (lint `uuid-fk` requires every `*_id` to be uuid); the API will generate UUIDv4 request ids. Noted in design v3 item 7.
3. The two gap fixes (owner policies, admin policies) are additions to the reviewed v2 SQL. They widen nothing beyond the grants you already approved, but they are new policy rows; they are listed in design v3 items 5–6 for your review.
4. One test detail observed during development: a `session_expires_at` round-tripped through a JavaScript Date loses sub-millisecond precision and fails the correction-A equality check. The suite passes the timestamp as text. The step 5–7 modules must do the same (pass the value read from the session row, not a re-parsed Date).
