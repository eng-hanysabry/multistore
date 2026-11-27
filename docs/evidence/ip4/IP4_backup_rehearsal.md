# IP-4 step 12 — V-05 local backup/restore rehearsal evidence

Date: 27 Nov 2026. Authority: Telegram 26530265 + 26530286 (IP-4 final acceptance as
local implementation; script changes; local rehearsal authorization). Scope: LOCAL
PostgreSQL only, seed/test data only. No real Supabase contact, no second project, no
real data, no migration, no deployment. All Security Gates remain OPEN, including G-12.
This document is evidence for your review; it closes nothing.

## Environment and target confirmation (report item 1)

- Server: PostgreSQL 16.2 on x86_64-pc-linux-gnu (pgserver), address 127.0.0.1, port 54400.
- Confirmed local: `restore.sh` printed the server identity before any write and the
  local-host guard was active (`ALLOW_REMOTE_RESTORE` unset, host 127.0.0.1 accepted).
- Source database: local `postgres` database in full IP-4 state (11 public tables,
  40 RLS policies, harness seed data only — tenants, users, memberships, auth_codes,
  sessions, refresh_tokens, audit_log, email_outbox, products, favorites, rls_canary).
- Restore target: fresh database `multistore_rehearsal` (did not exist before; R-5).

## Encryption (report item 2)

NOT tested: `age` is not available in the sandbox and nothing may be installed.
Per your instruction, the rehearsal completed the non-encryption checks only. The
encryption path (`export.sh --encrypt`, one `age --passphrase` prompt over the single
tar archive) is implemented and syntax-checked but untested. Deviation recorded.

## Execution log (report items 3–5)

All times UTC, 27 Nov 2026. Full run: 17:11:36 → 17:11:43.

| Step | Result | Duration |
|---|---|---|
| `export.sh ops/backup/out` | `multistore-20261127T171136Z.tar`, 102,400 bytes; archive sha256 `282eaf5c…514e41` | 0.157 s |
| `restore.sh … multistore_rehearsal --create-roles` | roles verified, fresh database created, `pg_restore --exit-on-error` clean | 0.142 s |
| `verify-restore.sh … multistore_rehearsal` | all checks passed | 0.109 s |

- SHA-256 (item 4): PASS — dump sha256 from the manifest
  (`2314bc6b…be51`) matched the extracted dump exactly; a mismatch fails verification.
- Row counts (item 5): PASS — all 11/11 manifest entries matched the restored copy
  (audit_log 1, auth_codes 1, email_outbox 0, favorites 2, memberships 2, products 4,
  refresh_tokens 1, rls_canary 1, sessions 1, tenants 2, users 3). A manifest with no
  row-count entries fails verification (no silent pass).

## Snapshot comparisons (report items 6–7)

All six snapshot diffs empty (identical between source and restored copy):

- Table grants: PASS — including the anon / authenticated / service_role filter.
  Those roles do not exist on the local server, so they contribute zero rows locally;
  on Supabase the same snapshot lists their grants and any privilege on an application
  table would appear as a diff.
- Column grants: PASS (correction-B column-restricted UPDATE grants identical).
- Policies: PASS — all 40 policies identical including expression text.
- RLS flags: PASS — enabled + forced on all application tables, identical.
- UUID columns: PASS — every `id` / `*_id` column `uuid`, identical.
- Default privileges (`pg_default_acl`): PASS — identical (added per your item 3.5).

Additional live spot check on the restored copy (beyond the required checks): as
`multistore_app` with no tenant context, `tenants` returns 0 rows; with a GUEST
tenant-A context, only tenant A's published product is visible. RLS behaves
identically on the restored copy, not just on paper.

## Role attributes (report item 8)

PASS for all three roles, verified twice (during restore and during verification):
LOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOREPLICATION;
`multistore_owner` and `multistore_app` INHERIT with connection limit -1;
`multistore_admin` NOINHERIT with connection limit 3. Local passwords were the test
harness password, supplied via environment, never written to any file.

## Readiness (report item 9)

PASS — `multistore_app` connected to the restored database and answered `SELECT 1`.

## Warnings, skipped checks, deviations (report item 10)

1. Encryption skipped (age unavailable in the sandbox) — see item 2 above.
2. The archive in `ops/backup/out/multistore-20261127T171136Z.tar` is therefore
   UNENCRYPTED. It contains only local seed/test data, sits in a `.gitignore`d
   directory with mode 0600, and will never be committed. It is kept for your review;
   say the word and it is deleted.
3. Timings are from a small local database; they say nothing about Supabase export
   duration. The real V-05 run must be timed against the R-2 target.
4. Roles are cluster-global: the rehearsal's role handling touched the same three
   roles the test harness uses (same names, same password, attributes verified
   unchanged). No other database or role was modified.

Cleanup after the run: rehearsal database `multistore_rehearsal` dropped; the
extraction directory removed. No credentials remain anywhere in the sandbox beyond
the pre-existing harness password constant in the test code.

## Remaining risks and next approval required (report item 11)

- Remaining risks: encryption path untested (age); SSD deletion is not guaranteed
  erasure (not claimed); real-server behavior (PG 17.12 on Supabase vs local 16.2)
  still unverified and subject to your separate approval; free-project pause behavior.
- Next approvals required before anything further: your review of this report;
  per-export vault approval for any real Supabase export (never reused); approval to
  create the second Supabase project; approval of the real V-05 rehearsal. G-21 and
  every other Security Gate stay OPEN until your explicit sign-off.

## Script changes applied per your items 2 and 3

- `lib-snapshot.sh`: grant filters extended to anon/authenticated/service_role (table
  and column grants); added `pg_default_acl` snapshot; added `verify_role_attributes`
  (LOGIN/SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE/INHERIT/connection limit).
- `export.sh`: single `.tar` archive of dump + manifest + all snapshots; one
  `age --passphrase` encryption of the archive; `umask 077`; `mktemp -d` staging with
  cleanup on success and failure; no secure-erasure claims.
- `restore.sh`: target name validated (`^[a-z_][a-z0-9_]{0,62}$`) and quoted;
  non-local hosts refused unless `ALLOW_REMOTE_RESTORE=1`; server identity printed
  before any write; role attributes verified after role handling.
- `verify-restore.sh`: dump SHA-256 verified against the manifest (mismatch fails);
  fails on missing manifest entries or snapshot files; empty grants/policies/RLS
  snapshots treated as insufficient metadata visibility (failure), never as proof of
  no privileges; every check reports PASS/FAIL explicitly.

Commit: see git history for `ops/backup/` and this file on main.
