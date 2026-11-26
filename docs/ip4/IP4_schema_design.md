# IP-4 schema design (FOR REVIEW. No migration written, nothing applied)

Date: 26 Nov 2026. Basis: spec v4.9 sections 5.6, 6.2 to 6.7, 9, 19.4, 22; your approval Telegram 21341113 and 21341125 (section 5: review before any migration). Anything marked **DECISION** is a point where the spec is silent or needs a small addition. I will not build those parts until you answer.

## 1. Rules applied to every table
- Primary key `id uuid`, no database default (Prisma `@default(uuid())` on the client; seeds use fixed UUIDs). Every FK is `uuid` referencing a `uuid` PK. No INT or BIGINT keys.
- Enumerations are `text` with `CHECK` (same style as the IP-3 migration), not PostgreSQL enums, so adding a value is a plain migration.
- `created_at timestamptz NOT NULL DEFAULT now()`; `updated_at` set by the application.
- Migrations run as `multistore_owner` only. Never `postgres` or `service_role`.
- RLS `ENABLE` and `FORCE` on every table below. Policies are role-exclusive and use the NULLIF form for every uuid cast. `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` on every table.

## 2. Tables and responsibilities
### tenants (a store)
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| code | text NOT NULL | URL path code, lowercase `[a-z0-9-]`, 3 to 40 chars, CHECK; UNIQUE index |
| name | text NOT NULL | |
| status | text NOT NULL | `ACTIVE`, `SUSPENDED`, `DELETED` |
| created_at, updated_at | timestamptz | |
No `tenant_id` column (it is the tenant). Store details (branding, categories) belong to IP-5.

### users (global identity, not owned by a store; 6.7)
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| email | text NOT NULL | stored lowercase, CHECK `email = lower(email)`, UNIQUE |
| password_hash | text NOT NULL | Argon2id (approved), PHC string, never logged |
| status | text NOT NULL | `PENDING_VERIFICATION`, `ACTIVE`, `DISABLED` |
| is_super_admin | boolean NOT NULL DEFAULT false | set only by a migration or reviewed manual step, never by an endpoint (STM-16). App role has no UPDATE or INSERT right on this column |
| email_verified_at | timestamptz | |
| password_changed_at | timestamptz | used to revoke sessions (STM-13) |
| created_at, updated_at | timestamptz | |
A user is a Customer, a Merchant, or both, depending on `memberships`. Super Admin is a separate account (19.1).

### memberships (join table: Merchant belongs to a store)
| id uuid PK | tenant_id uuid FK tenants | user_id uuid FK users | role text CHECK `MERCHANT` | status text `ACTIVE`/`REVOKED` | created_at |
UNIQUE (tenant_id, user_id). Index on (user_id). Tenant table (has `tenant_id`), so RLS and the lint apply.

### auth_codes (verification and reset codes, 9)
| id uuid PK | user_id uuid FK users | purpose text `VERIFY_EMAIL`/`RESET_PASSWORD` | code_hash text (Argon2id of the 6-digit code) | expires_at (created + **10 minutes**, STM-14) | attempts int NOT NULL DEFAULT 0 (max 5) | consumed_at timestamptz | created_at |
Single use: set `consumed_at` on success; a new code for the same user and purpose supersedes older ones (older rows marked consumed). Resend cooldown 60 s and the daily cap per address are computed from `created_at` of this table. Index (user_id, purpose, created_at desc).

### sessions and refresh_tokens (rotation and reuse detection, STM-12, STM-13)
- `sessions`: id uuid PK, user_id FK, created_at, expires_at (**DECISION: 30 days absolute**), revoked_at, revoked_reason (`LOGOUT`,`REUSE_DETECTED`,`PASSWORD_CHANGED`,`ADMIN`).
- `refresh_tokens`: id uuid PK, session_id FK, user_id FK, token_hash text UNIQUE (SHA-256 of a 256-bit random value; the raw token is never stored), status `ACTIVE`/`ROTATED`/`REVOKED`, issued_at, expires_at, replaced_by_id uuid nullable FK refresh_tokens.
- Flow: refresh with an `ACTIVE` token marks it `ROTATED` and issues a new one. Presenting a `ROTATED` token revokes the whole session (both tokens rejected, STM-12). Password change or reset revokes every session of the user (STM-13).
- Why SHA-256 and not Argon2 here: the token is high-entropy random, and we must look it up by its hash. Passwords and the low-entropy 6-digit codes use Argon2id as you approved.
- Access token (JWT via `@nestjs/jwt`): pinned algorithm (HS256 with `JWT_SECRET`), issuer, audience, `sub`, role, session id, expiry **DECISION: 15 minutes**. No tenant id (6.7). Customer tokens never hold a tenant.

### audit_log (D4: 90 days)
| id uuid PK | occurred_at timestamptz | actor_user_id uuid nullable (no FK, so deleting users never breaks history) | actor_role text | action text | tenant_id uuid nullable | target_type text | target_id uuid nullable | outcome text `ALLOWED`/`REJECTED` | request_id text | detail jsonb (checked by redaction test, no secrets or personal data) |
Index (occurred_at), (tenant_id, occurred_at). INSERT and SELECT only for the admin role; INSERT only for the app role; **no UPDATE or DELETE for anyone except `multistore_owner`**, which prunes rows older than 90 days (policy `owner_prune` FOR DELETE, same pattern as the IP-3 canary seed policy). A monthly size check is a documented owner task.

### Existing from IP-3, unchanged
`email_outbox` (internal, app only, no tenant_id), `rls_canary`.

## 3. Tenant and personal data boundaries
- Tenant data: `memberships`, `audit_log` (when `tenant_id` set). Policy compares `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`.
- Personal data: `users`, `auth_codes`, `sessions`, `refresh_tokens`. Policy compares `user_id`/`id = NULLIF(current_setting('app.user_id', true), '')::uuid`.
- Global lookup: `tenants` (by code).

## 4. RLS policies (all `TO multistore_app` unless stated; every one carries an `app.role` check)
Context keys: `app.tenant_id`, `app.role`, `app.user_id` (spec). **DECISION D-S1: three narrow lookup keys are added for flows that run before identity exists:** `app.tenant_code` (resolve the store from the URL), `app.login_email` (login, register, verify, reset), `app.token_hash` (refresh). They are used only in `GUEST` policies, only for exact-match SELECTs, and return zero rows when unset or empty (NULLIF form). Alternative: `SECURITY DEFINER` functions owned by `multistore_owner`. I recommend the keys because they keep every access visible as a policy and avoid definer privileges. The lint will allowlist exactly these six keys.

| table | policy | role | operation | condition (all with NULLIF) |
|---|---|---|---|---|
| tenants | tenant_resolve | GUEST, CUSTOMER, MERCHANT | SELECT | `code = app.tenant_code` AND status = 'ACTIVE' |
| tenants | tenant_self | CUSTOMER, MERCHANT | SELECT | `id = app.tenant_id` AND status = 'ACTIVE' |
| users | user_login_lookup | GUEST | SELECT | `email = app.login_email` |
| users | user_register | GUEST | INSERT | `status = 'PENDING_VERIFICATION'` AND `is_super_admin = false` AND `email = app.login_email` |
| users | user_auth_update | GUEST | UPDATE | `email = app.login_email` (verify, reset); column grant limits what can change |
| users | user_self | CUSTOMER, MERCHANT | SELECT, UPDATE | `id = app.user_id` (password change; column grant) |
| memberships | membership_self | MERCHANT | SELECT | `user_id = app.user_id` (the application also checks the tenant; RLS context is validated) |
| memberships | membership_customer_self | CUSTOMER | SELECT | `user_id = app.user_id` AND `tenant_id = app.tenant_id` |
| auth_codes | code_auth | GUEST | SELECT, INSERT, UPDATE | `EXISTS (SELECT 1 FROM users u WHERE u.id = auth_codes.user_id AND u.email = app.login_email)` |
| sessions | session_self | CUSTOMER, MERCHANT | SELECT, UPDATE | `user_id = app.user_id` (logout, revoke) |
| sessions | session_issue | GUEST | INSERT | user belongs to `app.login_email` (login issues a session) |
| refresh_tokens | refresh_lookup | GUEST | SELECT, UPDATE | `token_hash = app.token_hash` |
| refresh_tokens | refresh_issue | GUEST | INSERT | user belongs to `app.login_email` or token row follows a rotation in the same transaction (see note) |
| audit_log | audit_write | GUEST, CUSTOMER, MERCHANT | INSERT | `tenant_id IS NULL OR tenant_id = app.tenant_id` |
| audit_log | audit_admin | `multistore_admin` | SELECT, INSERT | true (history cannot be rewritten) |
| audit_log | owner_prune | `multistore_owner` | DELETE | `occurred_at < now() - interval '90 days'` |
Note on the refresh rotation insert: the rotation transaction already holds `app.token_hash`; the new row is inserted with `session_id` equal to the old row's session via `WITH CHECK EXISTS (...)` on `refresh_tokens` visible under that hash. Exact SQL will be shown in the migration review (section 6 of your approval).
Default deny: no policy means no access (zero rows, writes fail). Guest and Customer have no write policy on tenant data.

## 5. Roles and per-table grants
| table | multistore_app | multistore_admin (Phase 1 minimum, IP-8 may extend) | everyone else |
|---|---|---|---|
| tenants | SELECT | SELECT, INSERT, UPDATE | none |
| users | SELECT; INSERT; UPDATE (password_hash, status, email_verified_at, password_changed_at, updated_at) column-level; **no right on is_super_admin** | SELECT (id, email, status, created_at) column-level; **no password_hash** | none |
| memberships | SELECT | SELECT, INSERT, UPDATE, DELETE | none |
| auth_codes | SELECT, INSERT, UPDATE | **none** (19.4 item 5) | none |
| sessions | SELECT, INSERT, UPDATE | **none** | none |
| refresh_tokens | SELECT, INSERT, UPDATE | **none** | none |
| audit_log | INSERT | SELECT, INSERT | none; owner DELETE by policy |
No DELETE, TRUNCATE, REFERENCES, TRIGGER, DDL or `CREATE` on schema for the app. No sequences exist (UUID keys).

**Explicit revokes and default privileges (in the migration):**
```
REVOKE ALL ON <each new table> FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE multistore_owner IN SCHEMA public
  REVOKE ALL ON TABLES, SEQUENCES, FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;
```
Verified locally on PostgreSQL that this drops 21 simulated grants to 0 without affecting `multistore_app`. The read-only Supabase inspection (step 2) will show whether the real project has other defaults (for example default ACLs for the `postgres` or `supabase_admin` roles; those apply only to objects created by those roles, not ours).

## 6. Indexes
tenants(code) unique; users(email) unique; memberships(tenant_id,user_id) unique and (user_id); auth_codes(user_id,purpose,created_at desc); sessions(user_id); refresh_tokens(token_hash) unique, (session_id); audit_log(occurred_at), (tenant_id,occurred_at).

## 7. What the migration lint and tests will enforce
UUID PK and FK, no DB default on `id`, RLS enabled and forced on all tables with a `tenant_id`, every `multistore_app` policy has an `app.role` check, every uuid cast uses NULLIF, `set_config` only with local `true`, key allowlist (six keys), grants snapshot matches the reviewed file, no privileges for `anon`, `authenticated`, `service_role`.

## 8. Decisions for you
1. D-S1: the three lookup keys (recommended) or SECURITY DEFINER functions.
2. Session absolute lifetime 30 days and access token lifetime 15 minutes (spec says only "short-lived").
3. Admin Phase 1 grants as in section 5 (minimum, per 19.4).
4. `users`/`auth_codes`/`sessions` cleanup of expired rows: pruned by the owner like the audit log (proposal: 7 days after expiry).
Nothing is built until you answer.
