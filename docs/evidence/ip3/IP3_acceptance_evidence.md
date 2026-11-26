# IP-3 acceptance evidence (Deployment and Mail)

Date: 26 Nov 2026. Scope: IP-3 only. Repo: https://github.com/eng-hanysabry/multistore, main at the commit that carries this file.
Host change: Render Free and Northflank both asked for a card, so you chose Vercel Hobby plus GitHub Actions (your message 20663749, relayed by the main agent). Spec amendment: section 10.6a in `docs/spec/MultiStore_Final_Technical_Document_v4.9.md`, changelog entry v4.9.1.

## Acceptance criteria (spec 21.2, IP-3)
| Criterion | Result | Evidence |
|---|---|---|
| G-02 resolved | **Resolved by design change.** Render Free asked for a card, so its health-check path could not be tested. Vercel Hobby has no health-check path setting, so the fallback named in gate 2 (external check of `/health/live` and `/health/ready`) is the design. Both answer on the live URL. | `vercel_checks.txt`; spec 10.6a; G-02 row. Mark G-02 closed only on your review. |
| G-03 resolved | **Recorded, watched.** Supabase docs: Free projects pause after about 7 days of low activity (https://supabase.com/docs/guides/platform/free-project-pausing). I cannot trigger a pause, so the first-user behavior is not measured. The 5-minute GitHub sweep calls `/internal/outbox/drain` (a database read) and keeps the project active. Restore: dashboard > Restore project. | Spec 22.1 G-03 stays "recorded, watched". Honest limit: not observed. |
| OAuth callback tests (9.1.1) pass | Pass. 9 tests: allowed account stored with an audit log that has no secrets; case-insensitive match; different account rejected, nothing stored, token revoked; look-alike address rejected; unverified email rejected and revoked; pinned sub must match; missing, wrong, reused or expired state never exchanges the code; PKCE S256; denied consent, failed exchange, missing refresh token. | `api/test/unit/gmail-authorization.spec.ts`; CI api run https://github.com/eng-hanysabry/multistore/actions/runs/45803817200 |
| Outbox drains after a Gmail outage and after a restart | Pass. "drains after a simulated Gmail outage, nothing is lost"; "after a restart a new worker takes over a SENDING row whose lease expired"; backoff 1/5/30/120 s and FAILED after 5 attempts; circuit on invalid_grant; daily-limit pause. Serverless path: `OutboxService` and `/internal/outbox/drain` tests (auth 404/401/200, passes until empty, failing or slow immediate attempt never fails the caller). Real PostgreSQL tests for the store. | `outbox-worker.spec.ts`, `outbox-sweep.spec.ts`, `test/rls/ip3.rls.spec.ts` |
| Readiness 503 with the database stopped, liveness 200 | Pass (local, real stop). Not repeated on Vercel (I cannot stop your Supabase project). | `local_health_db_stop.txt`; `health.spec.ts` |

## Live checks on Vercel
URL: https://multistore-api-three.vercel.app (Hobby, function region fra1, Node 24).
- `/health/live` 200. `/health/ready` 200: database up, RLS canary ok, mail OK (three checks about 0.25 to 0.4 s). Helmet headers present.
- Drain endpoint: 401 with no token and a wrong token; a real token drained one queued test row.
- End to end: a test row queued in Supabase as `multistore_app`, one authenticated drain call sent it through Gmail (status SENT, attempts 1, body cleared). One email "MultiStore outbox sweep test" went to hanysabry0024@gmail.com only. Earlier a direct send test from the project's `GmailApiMailSender` also passed (token refresh check and one email).
Details: `docs/evidence/ip3/vercel_checks.txt`, `supabase_pooler_health.txt`.

## Other IP-3 scope
- helmet installed (D1). pg and @types/pg dev only, recorded in `docs/dependencies.md` and spec section 13.
- Three Supabase role passwords rotated (owner, admin, app): logins verified, no superuser, no BYPASSRLS. Values only in the vault.
- Migration `20261125000001_ip3_mail_and_health` applied by the owner role: `email_outbox`, `rls_canary` (FORCE RLS, NULLIF policy). No grants to anon, authenticated, service_role.
- OAuth: dedicated account hanysabry0024@gmail.com authorized once; account id pinned (sub 107726097712981748249); refresh token only in the vault and Vercel secrets. Privacy, terms and home pages: https://eng-hanysabry.github.io/multistore/ (privacy.html, terms.html).
- bad-* branches deleted. Gmail authorize script has a paste mode.

## Test and CI numbers
Local `npm run test:all` with real PostgreSQL 16: 11 suites, 104 tests passed; coverage 96.6% statements, 93.1% branches, 92.6% functions, 97.2% lines. CI api run on the latest commit: success (link above). Lint, format, typecheck, migration lint, contract check all clean.

## Caveats and open items (honest list)
1. **GitHub Actions sweep: secrets set, manual run verified, scheduled (cron) run NOT yet observed.** `API_BASE_URL` and `CRON_SECRET` were added on 2026-11-26 (PAT permission granted). A manual `workflow_dispatch` run succeeded with `status 200` and `{"sent":0,"passes":1}`: https://github.com/eng-hanysabry/multistore/actions/runs/45807200065. In the 30 minutes after, no `schedule` event run appeared (GitHub often delays cron on a new workflow). Automatic 5-minute retry is therefore unverified. **Status: Pending / Deferred (user decision, Telegram 21297475). Not Verified, not Completed.** Tracked in docs/DEFERRED_ISSUES.md (DI-1).
2. Retry timing is about every 5 minutes at best; GitHub can delay scheduled runs. A login code (5 min validity, D3) that fails its immediate send may expire before the sweep; the user asks for a new code.
3. Vercel needs `NODE_OPTIONS=--experimental-require-module` (set in the project) because Nest 12 is ESM only and the build is CommonJS. Node version is pinned to 24.x on the project. Node 24 itself is outside spec 13 (platform requirement, recorded).
4. Prisma pinned to 6.19.3 so no `pg` adapter is needed at runtime.
5. Vercel Hobby terms are personal, non-commercial. Re-check before commercial use. Project runs on an `*.vercel.app` URL.
6. Not measured: Supabase pause (G-03), cold-start latency after long idle, a database-down test on Vercel itself.
7. Deployment is by Vercel CLI from this repo, not Git-connected (no auto-deploy on push).
8. I granted `multistore_owner` CREATE and USAGE on schema public, and `multistore_app/admin` USAGE, so migrations and runtime work on your Supabase project.
