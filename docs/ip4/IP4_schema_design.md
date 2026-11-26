# IP-4 schema design v3 (applied locally 26 Nov 2026 — corrections A–D of your updated approval incorporated; migration written and tested on a clean local PostgreSQL only)

## 0. v3 changes vs the reviewed v2 (all from your 26 Nov updated approval, item 3, plus two gaps found while testing)

The canonical final SQL is `api/prisma/migrations/20261126160002_ip4_identity_tenancy/migration.sql`. It is the v2 SQL with exactly these changes:

1. Correction A (refresh_issue): outer columns are qualified explicitly (`refresh_tokens.session_id`, `.user_id`, `.session_expires_at`); the WITH CHECK additionally requires `s.expires_at = refresh_tokens.session_expires_at`, so an inserted row must prove its user and session-expiry against the real parent session row. Negative tests for a forged `session_expires_at` and a foreign session are in `api/test/rls/ip4.rls.spec.ts`.
2. Correction B (narrow UPDATE column grants): `auth_codes(attempts, consumed_at)`, `sessions(revoked_at, revoked_reason)`, `refresh_tokens(status, replaced_by_id)`. The app cannot change immutable fields (`token_hash`, `user_id`, `session_id`, `code_hash`, `purpose`, `expires_at`); attempting it raises permission denied. Verified by the privilege matrix test.
3. Correction C (D-S2 trigger hardening): the trigger skips when `current_user = 'multistore_owner'` so reviewed owner operations are not broken; the GUEST activation path now additionally requires a consumed `VERIFY_EMAIL` auth code for that user within the last 10 minutes, so a GUEST context alone is not proof of a valid code. Tests cover self-activation without a code (rejected), the full verification flow (accepted), an authenticated user changing their own status/email_verified_at (rejected), and an is_super_admin change (rejected).
4. Correction D (session_guest_lookup review): the policy reads sessions only for the user being authenticated (`app.login_email`) or the user a presented token resolved to (`app.user_id`, set in the same transaction after the token lookup). No other user's rows are visible, no token material is exposed (token_hash lives in refresh_tokens), and with neither key the policy matches zero rows. Tests cover all three cases.
5. Gap found while testing (owner operations): FORCE RLS binds the owner, so with no owner policies the approved owner-only cleanup of expired auth codes/sessions (7 days) and reviewed manual user operations were impossible. Added: `users_owner_all` (FOR ALL), `codes_owner_select` + `codes_owner_cleanup` (DELETE only where `expires_at < now() - interval '7 days'`), `sessions_owner_select` + `sessions_owner_cleanup` (same 7-day rule). Tests verify the cleanup deletes expired rows and cannot touch fresh ones.
6. Gap found while reviewing grants (admin policies): the approved admin grants on `tenants`/`memberships` are ineffective without admin RLS policies, because FORCE RLS applies to every non-superuser. Added `tenants_admin_all` and `memberships_admin_all` (FOR ALL, `USING (true) WITH CHECK (true)`) plus `users_admin_read` (SELECT) so the approved admin column grant on users works. No grants were widened; the policies only make the already-approved grants effective.
7. `audit_log.request_id` is `uuid` (nullable) instead of text: the repo lint rule `uuid-fk` requires every `*_id` column to be uuid. The API will generate UUIDv4 request ids per request. No spec impact.

Sections 4–6 below still show the reviewed v2 SQL; apply the seven changes above when reading them.

Date: 26 Nov 2026 (v2). Basis: spec v4.9, your IP-4 approval (Telegram 21341113 + 21341125), and your schema review (Telegram 21435287). v1 was commit 3535350.

Changes v1 → v2:
- Your five decisions applied (D-S1 keys; transaction-local context only, no SECURITY DEFINER; 30-day session / 15-minute access token / refresh never outlives session; minimum admin Phase 1 grants; 7-day owner cleanup of expired codes/sessions, 90-day audit retention kept).
- Requirement E: the v1 `ALTER DEFAULT PRIVILEGES` example was invalid syntax (one object type list). Corrected to three separate statements (section 5), executed locally.
- Requirement D: `refresh_tokens` gains `session_expires_at` (denormalized from the parent session) with `CHECK (expires_at <= session_expires_at)` so the rule is enforced by the database, not only by code.
- Requirement A: the v1 `refresh_issue` draft referenced `refresh_tokens` inside its own policy (recursive RLS risk). The v2 policy references only `sessions` and `users`; verified non-recursive locally.
- New finding (v2): UPDATE and DELETE statements that read rows also apply SELECT policies. Two supporting SELECT policies added (`session_guest_lookup`, `audit_owner_select`), section 6.
- New element needing your explicit OK: D-S2, a plain (SECURITY INVOKER) BEFORE UPDATE trigger on `users` guarding `status`, `email_verified_at`, `is_super_admin` (section 7). Pure RLS cannot compare old vs new row values; this is the only database-level enforcement. Alternative: application-layer enforcement plus tests only.
- All SQL below was executed on local PostgreSQL 16.2 with test data (scratch database, not the migration). Results in section 9.

## 1. Rules applied to every table
- PK `id uuid`, no database default (Prisma `@default(uuid())` client-side; seeds use fixed UUIDs). Every FK is `uuid` referencing a `uuid` PK.
- Enumerations are `text` with `CHECK`, not PostgreSQL enums.
- `created_at timestamptz NOT NULL DEFAULT now()`; `updated_at` set by the application.
- Migrations run as `multistore_owner` only. Never `postgres` or `service_role`.
- RLS `ENABLE` and `FORCE` on every table. Every `multistore_app` policy carries an `app.role` check; every uuid cast uses the NULLIF form. `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` on every table.
- Context keys (six, all transaction-local via `set_config(key, value, true)`, never session-level): `app.tenant_id`, `app.user_id`, `app.role` (existing) plus `app.tenant_code`, `app.login_email`, `app.token_hash` (D-S1, approved). The lint allowlists exactly these six. No SECURITY DEFINER functions.

## 2. Tables
(unchanged from v1 except where noted)

- **tenants**: id PK; code text CHECK `^[a-z0-9-]{3,40}$` UNIQUE; name; status `ACTIVE|SUSPENDED|DELETED`; created_at/updated_at.
- **users**: id PK; email text CHECK `email = lower(email)` UNIQUE; password_hash (Argon2id PHC, never logged); status `PENDING_VERIFICATION|ACTIVE|DISABLED`; is_super_admin bool DEFAULT false — never writable by any application role (no column grant, RLS WITH CHECK, and D-S2 trigger); email_verified_at; password_changed_at; created_at/updated_at.
- **memberships**: id PK; tenant_id FK; user_id FK; role `MERCHANT`; status `ACTIVE|REVOKED`; UNIQUE (tenant_id, user_id); index (user_id).
- **auth_codes**: id PK; user_id FK; purpose `VERIFY_EMAIL|RESET_PASSWORD`; code_hash (Argon2id of 6-digit code); expires_at with `CHECK (expires_at <= created_at + interval '10 minutes')`; attempts int DEFAULT 0 (cap 5 enforced atomically, section 8); consumed_at; created_at. Index (user_id, purpose, created_at DESC). Single use: `consumed_at` set on success; a new code supersedes older ones in the same transaction. Resend: 60-second cooldown and daily cap checked under a per-user+purpose transaction advisory lock.
- **sessions**: id PK; user_id FK; created_at; expires_at with `CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 days')` (approved 30-day absolute cap); revoked_at; revoked_reason `LOGOUT|REUSE_DETECTED|PASSWORD_CHANGED|ADMIN`. Password change/reset revokes every session of the user (STM-13).
- **refresh_tokens**: id PK; session_id FK; user_id FK (denormalized for policy checks); token_hash text UNIQUE (SHA-256 of a 256-bit random value; raw token never stored); status `ACTIVE|ROTATED|REVOKED`; issued_at; expires_at; **session_expires_at** (denormalized copy of the parent session's expiry) with `CHECK (expires_at <= session_expires_at)`; replaced_by_id self-FK. Rotation writes `replaced_by_id` in a separate statement after the successor insert, because an immediate FK check fails if the successor row does not exist yet (found in the local race test).
- **audit_log**: id PK; occurred_at; actor_user_id uuid (no FK); actor_role; action; tenant_id nullable; target_type; target_id nullable; outcome `ALLOWED|REJECTED`; request_id; detail jsonb (redaction test, no secrets or personal data). Indexes (occurred_at), (tenant_id, occurred_at). INSERT only for app; SELECT+INSERT for admin; DELETE only via the owner prune policy (>90 days); no UPDATE for anyone.
- Existing from IP-3, unchanged: `email_outbox`, `rls_canary`.

Access token (JWT via `@nestjs/jwt`): HS256 pinned, `JWT_SECRET`, issuer, audience, `sub`, role, session id, 15-minute expiry (approved). No tenant id in customer tokens (6.7).

## 3. Tenant and personal data boundaries
- Tenant data: `memberships`, `audit_log` (when tenant_id set). Policies compare `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`.
- Personal data: `users`, `auth_codes`, `sessions`, `refresh_tokens`. Policies compare against `app.user_id`, `app.login_email`, or `app.token_hash`.
- Global lookup: `tenants` by `app.tenant_code`.

## 4. Exact grants SQL (verified locally; snapshot in section 9)
```sql
GRANT SELECT ON tenants TO multistore_app;
GRANT SELECT ON users TO multistore_app;
GRANT INSERT ON users TO multistore_app;
GRANT UPDATE (password_hash, status, email_verified_at, password_changed_at, updated_at)
  ON users TO multistore_app;   -- never is_super_admin, id, email, created_at
GRANT SELECT ON memberships TO multistore_app;
GRANT SELECT, INSERT, UPDATE ON auth_codes TO multistore_app;
GRANT SELECT, INSERT, UPDATE ON sessions TO multistore_app;
GRANT SELECT, INSERT, UPDATE ON refresh_tokens TO multistore_app;
GRANT INSERT ON audit_log TO multistore_app;

GRANT SELECT, INSERT, UPDATE ON tenants TO multistore_admin;
GRANT SELECT (id, email, status, created_at) ON users TO multistore_admin;  -- never password_hash
GRANT SELECT, INSERT, UPDATE, DELETE ON memberships TO multistore_admin;
GRANT SELECT, INSERT ON audit_log TO multistore_admin;                     -- read-only history
-- admin has NO grant on auth_codes, sessions, refresh_tokens (approved minimum Phase 1)
```
Note on `users` INSERT: table-level INSERT grant (Prisma compatibility); the `is_super_admin = false` guarantee is enforced by the RLS WITH CHECK (test B2) and the D-S2 trigger, not by the column list.

## 5. Exact revokes and default privileges (requirement E, corrected)
```sql
REVOKE ALL ON tenants, users, memberships, auth_codes, sessions, refresh_tokens, audit_log
  FROM PUBLIC, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE multistore_owner IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE multistore_owner IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE multistore_owner IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;
```
One object type per statement (the v1 combined form was invalid). SEQUENCES is future-proofing (no sequences exist; UUID keys). TYPES/SCHEMAS are not applicable (no custom types; text+CHECK enums). Local verification (section 9): after these statements, `pg_default_acl` holds no entries for `multistore_owner` (a probe GRANT created an entry and the REVOKE removed it, confirming the statements take effect), and `information_schema.role_table_grants` shows zero privileges for PUBLIC/anon/authenticated/service_role on all seven tables.

## 6. Exact RLS policy SQL (all executed locally)
```sql
CREATE POLICY tenant_resolve ON tenants FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) IN ('GUEST','CUSTOMER','MERCHANT')
  AND code = NULLIF(current_setting('app.tenant_code', true), '')
  AND status = 'ACTIVE');
CREATE POLICY tenant_self ON tenants FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) IN ('CUSTOMER','MERCHANT')
  AND id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND status = 'ACTIVE');

CREATE POLICY user_login_lookup ON users FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) = 'GUEST'
  AND email = NULLIF(current_setting('app.login_email', true), ''));
CREATE POLICY user_register ON users FOR INSERT TO multistore_app WITH CHECK (
  current_setting('app.role', true) = 'GUEST'
  AND status = 'PENDING_VERIFICATION' AND is_super_admin = false
  AND email = NULLIF(current_setting('app.login_email', true), ''));
CREATE POLICY user_auth_update ON users FOR UPDATE TO multistore_app
  USING (current_setting('app.role', true) = 'GUEST'
         AND email = NULLIF(current_setting('app.login_email', true), ''))
  WITH CHECK (current_setting('app.role', true) = 'GUEST'
              AND is_super_admin = false
              AND email = NULLIF(current_setting('app.login_email', true), ''));
CREATE POLICY user_self ON users FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) IN ('CUSTOMER','MERCHANT')
  AND id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY user_self_update ON users FOR UPDATE TO multistore_app
  USING (current_setting('app.role', true) IN ('CUSTOMER','MERCHANT')
         AND id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (current_setting('app.role', true) IN ('CUSTOMER','MERCHANT')
              AND is_super_admin = false
              AND id = NULLIF(current_setting('app.user_id', true), '')::uuid);

CREATE POLICY membership_self ON memberships FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) = 'MERCHANT'
  AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY membership_customer_self ON memberships FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) = 'CUSTOMER'
  AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY code_auth ON auth_codes FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) = 'GUEST'
  AND EXISTS (SELECT 1 FROM users u WHERE u.id = auth_codes.user_id
              AND u.email = NULLIF(current_setting('app.login_email', true), '')));
CREATE POLICY code_auth_insert ON auth_codes FOR INSERT TO multistore_app WITH CHECK (
  current_setting('app.role', true) = 'GUEST'
  AND EXISTS (SELECT 1 FROM users u WHERE u.id = auth_codes.user_id
              AND u.email = NULLIF(current_setting('app.login_email', true), '')));
CREATE POLICY code_auth_update ON auth_codes FOR UPDATE TO multistore_app
  USING (current_setting('app.role', true) = 'GUEST'
         AND EXISTS (SELECT 1 FROM users u WHERE u.id = auth_codes.user_id
                     AND u.email = NULLIF(current_setting('app.login_email', true), '')))
  WITH CHECK (current_setting('app.role', true) = 'GUEST'
              AND EXISTS (SELECT 1 FROM users u WHERE u.id = auth_codes.user_id
                          AND u.email = NULLIF(current_setting('app.login_email', true), '')));

CREATE POLICY session_issue ON sessions FOR INSERT TO multistore_app WITH CHECK (
  current_setting('app.role', true) = 'GUEST'
  AND user_id = (SELECT u.id FROM users u WHERE u.email = NULLIF(current_setting('app.login_email', true), '')));
-- GUEST reads sessions only after a valid token lookup (app.user_id set in the same
-- transaction) or during login (app.login_email). Also required because UPDATE/DELETE
-- statements apply SELECT policies when they read rows.
CREATE POLICY session_guest_lookup ON sessions FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) = 'GUEST'
  AND ( user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        OR user_id = (SELECT u.id FROM users u
                      WHERE u.email = NULLIF(current_setting('app.login_email', true), '')) ));
CREATE POLICY session_guest_revoke ON sessions FOR UPDATE TO multistore_app
  USING (current_setting('app.role', true) = 'GUEST'
         AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (current_setting('app.role', true) = 'GUEST'
              AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
              AND revoked_at IS NOT NULL);   -- GUEST can only revoke, never un-revoke
CREATE POLICY session_self ON sessions FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) IN ('CUSTOMER','MERCHANT')
  AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY session_self_update ON sessions FOR UPDATE TO multistore_app
  USING (current_setting('app.role', true) IN ('CUSTOMER','MERCHANT')
         AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (current_setting('app.role', true) IN ('CUSTOMER','MERCHANT')
              AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- refresh policies reference only sessions/users, never refresh_tokens itself (requirement A)
CREATE POLICY refresh_lookup ON refresh_tokens FOR SELECT TO multistore_app USING (
  current_setting('app.role', true) = 'GUEST'
  AND token_hash = NULLIF(current_setting('app.token_hash', true), ''));
CREATE POLICY refresh_update ON refresh_tokens FOR UPDATE TO multistore_app
  USING (current_setting('app.role', true) = 'GUEST'
         AND token_hash = NULLIF(current_setting('app.token_hash', true), ''))
  WITH CHECK (current_setting('app.role', true) = 'GUEST'
              AND token_hash = NULLIF(current_setting('app.token_hash', true), ''));
CREATE POLICY refresh_issue ON refresh_tokens FOR INSERT TO multistore_app WITH CHECK (
  current_setting('app.role', true) = 'GUEST'
  AND EXISTS (SELECT 1 FROM sessions s
              WHERE s.id = session_id AND s.user_id = user_id
                AND s.revoked_at IS NULL AND s.expires_at > now())
  AND ( user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        OR user_id = (SELECT u.id FROM users u
                      WHERE u.email = NULLIF(current_setting('app.login_email', true), '')) ));

CREATE POLICY audit_write ON audit_log FOR INSERT TO multistore_app WITH CHECK (
  current_setting('app.role', true) IN ('GUEST','CUSTOMER','MERCHANT')
  AND (tenant_id IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
CREATE POLICY audit_admin_select ON audit_log FOR SELECT TO multistore_admin USING (true);
CREATE POLICY audit_admin_insert ON audit_log FOR INSERT TO multistore_admin WITH CHECK (true);
-- owner SELECT so the prune DELETE can read rows; the DELETE policy itself restricts to >90 days
CREATE POLICY audit_owner_select ON audit_log FOR SELECT TO multistore_owner USING (true);
CREATE POLICY owner_prune ON audit_log FOR DELETE TO multistore_owner
  USING (occurred_at < now() - interval '90 days');
```
Default deny holds: no policy, no access. Guest and Customer have no write policy on tenant data.

## 7. D-S2 (NEW, needs your explicit OK): sensitive-field trigger on users
Requirement B asks that users can never self-activate or set `email_verified_at` outside the verification flow. RLS cannot compare old and new row values, and column grants are role-wide (the verify flow legitimately sets those columns as GUEST). The only database-level enforcement is a trigger. Proposed: a plain SECURITY INVOKER function (NOT SECURITY DEFINER; no extra privileges), owned by `multistore_owner`:
```sql
CREATE OR REPLACE FUNCTION users_protect_sensitive() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER AS $f$
BEGIN
  IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
    RAISE EXCEPTION 'is_super_admin can never change via application roles';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.email_verified_at IS DISTINCT FROM OLD.email_verified_at THEN
    IF current_setting('app.role', true) IS DISTINCT FROM 'GUEST' THEN
      RAISE EXCEPTION 'status/email_verified_at change only inside the verification flow';
    END IF;
    IF NOT (OLD.status = 'PENDING_VERIFICATION' AND NEW.status = 'ACTIVE'
            AND NEW.email_verified_at IS NOT NULL) THEN
      RAISE EXCEPTION 'only PENDING_VERIFICATION -> ACTIVE with email_verified_at is allowed';
    END IF;
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER users_protect_sensitive_trg BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION users_protect_sensitive();
```
Verified locally (tests B3a/B3b/B3c). If you prefer no trigger, the alternative is application-layer enforcement plus tests; say which.

## 8. Flows (exact SQL shapes the modules will use)
Rotation (single transaction, GUEST): `SELECT ... FROM refresh_tokens WHERE token_hash=$1 FOR UPDATE` (row lock serializes concurrent refreshes) → if ACTIVE: `UPDATE ... SET status='ROTATED'`; `set_config('app.user_id', <looked-up user>, true)`; `INSERT` successor with `expires_at = LEAST(now()+interval '14 days', session_expires_at)`; then `UPDATE ... SET replaced_by_id` (FK order); COMMIT. If already ROTATED/REVOKED: reuse detected → `UPDATE sessions SET revoked_at=now(), revoked_reason='REUSE_DETECTED'`; the whole session dies, so every token of it fails `refresh_issue` from then on.

Consume code: one atomic statement `UPDATE auth_codes SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL AND expires_at > now() RETURNING id` — a second concurrent consume finds zero rows.

Attempt counting: `UPDATE auth_codes SET attempts=attempts+1 WHERE id=$1 AND consumed_at IS NULL AND expires_at > now() AND attempts < 5 RETURNING attempts` — the cap lives in the same atomic statement; attempts can never exceed 5.

New code (supersede + cooldown + daily cap): one transaction: `SELECT pg_advisory_xact_lock(hashtext(user_id || ':' || purpose))` → check last `created_at` (60-second cooldown) and count today (daily cap) → `UPDATE ... SET consumed_at=now() WHERE user_id AND purpose AND consumed_at IS NULL` → `INSERT` new code → COMMIT. The advisory lock serializes resends per user+purpose.

## 9. Local test evidence (PostgreSQL 16.2, scratch DB, test data, 26 Nov 2026)
Every requirement A–F was executed against the exact SQL above. Formal Jest/RLS suites land in step 8 per the approved sequence; these are the specifications they will encode, with preliminary results:

| Req | Test | Result |
|---|---|---|
| A | A1a lint: no `refresh_tokens` policy references the table as a relation (`FROM`/`JOIN`) | 0 rows |
| A | A1b rotation transaction under FORCE RLS as multistore_app | UPDATE 1, INSERT 0 1, COMMIT; no recursion error |
| A | A2/A3 two concurrent refreshes of one token (Node harness, row lock) | winner rotated (3 ms); loser blocked 17 ms, saw ROTATED; exactly 1 ACTIVE successor |
| A | A4 reuse of rotated token | session revoked (`REUSE_DETECTED`) |
| A+D | A5a/A5b refresh against expired / revoked session | both rejected: RLS WITH CHECK violation |
| D | D1 token `expires_at` > session expiry | CHECK violation 23514 |
| B | B1a/B1b app (CUSTOMER or GUEST) UPDATE `is_super_admin` | permission denied (no column grant) |
| B | B2 registration with `is_super_admin=true` | RLS WITH CHECK violation |
| B | B3a CUSTOMER self-activation | trigger rejects |
| B | B3b GUEST verify flow PENDING→ACTIVE + email_verified_at | UPDATE 1 (allowed) |
| B | B3c GUEST other status transition (ACTIVE→DISABLED) | trigger rejects |
| B | B3d CUSTOMER self password change | UPDATE 1 (allowed) |
| C | C1 consume twice | first 1 row, second 0 rows |
| C | C1b two concurrent consumes (race) | exactly one `consumed_rows=1` |
| C | C2 seven-attempt sequence | attempts 1–5 succeed, 6th blocked |
| C | C2b two concurrent increments at attempts=4 | one reaches 5, one rejected; never 6 |
| C | C3 supersede in one transaction | both old codes consumed, new code active |
| C | C4 resend inside 60 s under advisory lock | check returns recent code → no insert |
| E | E2 grants snapshot PUBLIC/anon/authenticated/service_role | 0 rows on all 7 tables |
| E | E2b/E2c app/admin grants and column privileges | exactly as section 4 |
| E | E1 default-privilege mechanism | probe GRANT recorded in pg_default_acl; REVOKE removed it; final state: no entries |
| F | F1 app UPDATE/DELETE audit_log | permission denied (both) |
| F | F2 admin SELECT audit_log; admin UPDATE/DELETE | SELECT ok; both denied |
| F | F3 owner prune | recent row DELETE 0 (policy blocks); >90-day row DELETE 1 |
| G | Argon2 | section 10 (no deploy) |
| — | V5 RLS state | enabled and forced on all 7 tables |

The step-8 Jest suites will encode every row above as automated tests on real PostgreSQL (RLS harness), plus STM-01..STM-20, the 6.4 matrix, and the 6.6 suite, unchanged.

## 10. Argon2 deployment-verification plan (requirement G; NO Vercel deploy without your separate approval)
Accepted preliminary evidence: Node 24.22.3 linux x64, `npm ci` from the committed lockfile, Argon2id hash `$argon2id$v=19$m=19456,t=2,p=1` and verify true/false (~75 ms), commit 3118147, CI run 45829104269.

Deployment-compatible plan (no deploy):
1. Reproduce Vercel's runtime locally: Amazon Linux 2023 container with Node 24 (the Vercel Node 24 runtime family), `npm ci` from the committed lockfile, then `require('argon2')` load plus a real hash/verify. Records glibc and the loaded prebuilt binary.
2. Inspect the argon2 package's bundled prebuilds (`node_modules/argon2/prebuilds`) and confirm a linux-x64 glibc build ships from the lockfile-pinned version.
3. Optional, only with your approval later: `vercel build` locally to produce the serverless bundle and confirm the native binary is included.
4. Only if you separately approve: a Vercel preview deployment hitting an argon2 self-test route. Not requested now.
If Argon2 fails on the Vercel-equivalent runtime: stop, report the exact failure and evidence; no scrypt or other substitute without your explicit approval.

## 11. Step 2 (Supabase read-only metadata) — results (26 Nov 2026, run as multistore_owner via the eu-central-1 pooler, PG 17.12, project ouaydsyuwmngfahuwjlw)

Q1 (existing grants in public): only the IP-3 objects carry grants — `email_outbox` (multistore_app: INSERT, SELECT, UPDATE) and `rls_canary` (multistore_app: SELECT). Zero grants to anon, authenticated, service_role or PUBLIC on any multistore object. No grants to multistore_admin yet (correct: IP-4 introduces them).
Q2 (default ACLs): entries granting anon/authenticated/service_role exist only for objects created by `postgres`/`supabase_admin` (Supabase platform defaults, not ours). There are no default ACLs for `multistore_owner`, which confirms the migrations-only-as-owner design: our default-privilege REVOKEs in the migration close the gap going forward.
No conflicts found; no INSERT/UPDATE/DELETE/DDL was run. Raw output is preserved in the task evidence (`/tmp/ip4_scratch/supabase_metadata_out.txt`, query timestamps 26 Nov 14:06:39–40 UTC).

## 12. Status
All v2 review items are resolved: D-S2 approved and hardened (item 3.C of your approval), sections 4–6 SQL approved with corrections A–D applied, step-2 metadata clean. The migration was written and verified on a clean local PostgreSQL 16.2 only. Nothing was applied to Supabase; no Vercel deploy; no new dependencies; DI-1 remains Deferred; all Security Gates remain OPEN pending your evidence review.
