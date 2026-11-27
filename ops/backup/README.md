# Backup and restore rehearsal (V-05 / G-21, spec 22.2)

Status: **local rehearsal EXECUTED and PASSED on 27 Nov 2026** (evidence:
`docs/evidence/ip4/IP4_backup_rehearsal.md`). IP-4 is accepted as a completed
local implementation (Telegram 26530265/26530286); all Security Gates remain
OPEN, including G-12. No real Supabase project was touched, no second project
created, no real data used. The real rehearsal, the second Supabase project and
every real export each wait for their own separate approval.

This directory holds the scripts and the runbook.

## Requirements

- PostgreSQL client tools 16+ (`psql`, `pg_dump`, `pg_restore`) on the operator machine.
- `age` (free, https://age-encryption.org) for `--encrypt`. If age is unavailable,
  the export runs unencrypted and the limitation is reported (per your instruction).
- Credentials at run time only, from the secret store: the operator/superuser connection
  through `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD` (or `.pgpass`), and for role handling
  `OWNER_PASSWORD`, `APP_PASSWORD`, `ADMIN_PASSWORD`. Nothing is read from files in the repo.
- For the real rehearsal only (your separate approval): the second Supabase Free project
  slot (decision D2a) and the owner credentials.

## The scripts

| Script | Purpose | Spec |
|---|---|---|
| `export.sh OUT_DIR [--encrypt]` | One `multistore-<utc>.tar` containing the `pg_dump` custom-format dump, the manifest (row counts per table, dump SHA-256, versions, timestamp) and six metadata snapshots. `--encrypt` seals the archive once with a single `age --passphrase` prompt. | R-3, R-4 |
| `restore.sh DUMP TARGET_DB [--create-roles]` | Restores into a FRESH database only; refuses an existing one (R-5); validates the target name and refuses non-local hosts unless `ALLOW_REMOTE_RESTORE=1`; prints server identity before any write; re-creates roles and resets passwords from the secret store (R-6); verifies role attributes. | R-5, R-6 |
| `verify-restore.sh MANIFEST TARGET_DB` | Fails on any mismatch: dump SHA-256 vs manifest, row counts, snapshot diffs (table grants incl. anon/authenticated/service_role, column grants, policies, RLS flags, UUID columns, default privileges), role attributes, readiness as `multistore_app`. | R-7 |
| `lib-snapshot.sh` | Shared snapshot queries and the role-attribute check (not run directly). | R-7 |

Safety properties: `umask 077` and `mktemp -d` staging everywhere; temporary files
are removed on success and on failure. Removal is ordinary filesystem deletion —
no secure-erasure guarantee is claimed on SSD storage. Export and verification must
run as the operator/superuser role: FORCE RLS binds even `multistore_owner`, and the
`information_schema` privilege views show each role only its own grants, so a
snapshot taken as a lesser role is silently incomplete and missing rows are never
proof that privileges do not exist. Verification treats an empty grants, policies
or RLS snapshot as a failure (insufficient visibility), not as a pass.

## Local rehearsal commands (what was run on 27 Nov 2026)

```bash
export PGHOST=127.0.0.1 PGPORT=54400 PGUSER=postgres PGDATABASE=postgres
ops/backup/export.sh ops/backup/out                      # add --encrypt when age is available
mkdir <workdir> && tar -xf ops/backup/out/multistore-<ts>.tar -C <workdir>
ops/backup/restore.sh <workdir>/multistore-<ts>.dump multistore_rehearsal --create-roles
ops/backup/verify-restore.sh <workdir>/multistore-<ts>.manifest.txt multistore_rehearsal
# afterwards: dropdb multistore_rehearsal; remove <workdir>
```

Role passwords for the local run come from the test harness (`rls-harness-test-only`).
Time the whole run (V-05 step 4) and record manifest, check output, timing and date.

## Real-Supabase rehearsal (later, separate approval)

Identical mechanics, encrypted output, into the second project slot — never the live
project (R-5):

```bash
# 1. Export from the live project, encrypted (R-4) — needs your per-export vault approval
export PGHOST=<pooler-host> PGPORT=5432 PGUSER=postgres PGDATABASE=postgres
ops/backup/export.sh <secure-out-dir> --encrypt

# 2. Deliver the encrypted archive to you; on the SECOND project, restore (R-6 roles)
age --decrypt <archive>.tar.age | tar -x -C <workdir>
export PGHOST=<second-project-host> PGUSER=postgres
export OWNER_PASSWORD=... APP_PASSWORD=... ADMIN_PASSWORD=...   # vault, run time only
ALLOW_REMOTE_RESTORE=1 ops/backup/restore.sh <workdir>/multistore-<ts>.dump <target_db> --create-roles

# 3. Verify (R-7)
ops/backup/verify-restore.sh <workdir>/multistore-<ts>.manifest.txt <target_db>

# 4. Record manifest, check output, timing, date (V-05 evidence). Plaintext working
#    copies are deleted afterwards (ordinary deletion, no SSD erasure claim), and all
#    credentials are cleared from the sandbox immediately, success or failure.
```

## How restored-copy integrity is verified

- Dump SHA-256 must equal the manifest; row counts per table must equal exactly.
- Snapshot diffs must be empty for: table grants (including the Supabase platform
  roles anon, authenticated, service_role — they must hold zero unintended privileges
  on application tables), column grants, every RLS policy with its expression text,
  RLS enabled+forced flags per table, UUID column types, and default privileges
  (`pg_default_acl`).
- Role attributes must match the approved set exactly (LOGIN, NOSUPERUSER,
  NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, INHERIT or NOINHERIT, connection limit).
- Readiness: `multistore_app` connects to the restored database.
- Known limitation: the Jest RLS suites provision their own fixtures (`DROP OWNED BY …`),
  so they are not pointed at a restored copy; the snapshot diff plus the role-attribute
  check covers the 6.4/6.6 privilege surface for a restored database. In the 27 Nov
  rehearsal a live spot check on the restored copy additionally confirmed RLS behavior
  (zero rows without tenant context; tenant-scoped GUEST sees only own-tenant published rows).

## Rollback and recovery

| Scenario | Steps | Spec |
|---|---|---|
| Bad migration or accidental deletion (live) | Restore the latest export into a new project, apply R-6 role handling, run `verify-restore.sh`, switch the API connection string only after all checks pass | R-5/R-6/R-7 |
| Supabase project paused | Restore from the dashboard; if unavailable, restore from the latest export; API reports 503 meanwhile | 10.1, G-03 |
| Rehearsal fails or is interrupted | Drop the rehearsal database/project; the live project was never touched (R-5), so nothing rolls back | — |
| Pre-migration safety (D2) | `export.sh` runs before every migration; a failed migration rolls back to the pre-migration export as in row 1 | D2, R-3 |

## Storage and retention (your decisions, Telegram 26530286 item 5)

- Backups are stored on your own computer: one encrypted copy plus one separate offline copy.
- Retention: the last 3 pre-migration exports and 4 weekly exports; the first rehearsal
  export is kept until G-21 is signed off.
- Every real Supabase export needs its own separate, explicit vault approval; approvals
  are never reused. The agent delivers the encrypted archive to you, then immediately
  clears all credentials and sensitive material from the sandbox, success or failure,
  and reports the cleanup without exposing any value. No credentials, passphrases or
  unencrypted backups are ever stored in Git or left in the sandbox.

## Known limits

- Supabase Free has no point-in-time recovery; worst-case data loss is the time since the
  last export (D2 sets a 7-day recovery point, so weekly exports are the maximum gap).
- Logical dumps do not carry role passwords (reset from the secret store, R-6) or server
  settings and extensions.
- Default privileges are recorded against the creating role; restoring as a different
  superuser can shift them — the default-acl snapshot diff catches this.
- A plaintext archive exists on the operator machine between export and encryption;
  `--encrypt` removes it (ordinary deletion, no SSD erasure claim).
- The free project pauses after about a week of low activity (10.1); the rehearsal
  project may need a dashboard wake before use.
- The 27 Nov 2026 local rehearsal ran without encryption because `age` is not available
  in the sandbox; the encryption path is prepared but untested.

## Secrets-exposure review

Reviewed line by line after the 27 Nov changes: the scripts and this plan contain no
passwords, passphrases, tokens, hosts or account names. All credentials enter through
environment variables at run time; the encryption passphrase is only ever typed into
`age`'s own prompt. The repository `.gitignore` blocks `ops/backup/out/`, `*.dump`,
`*.age`, `*.gpg` and the manifest pattern, so rehearsal output cannot be committed by
accident. No backup file or passphrase is in Git.

## Open decisions (yours)

1. Review of the 27 Nov local rehearsal report (sent with the evidence file).
2. Per-export vault approval for each real Supabase export (never reused).
3. Approval to create the second Supabase Free project for the real restore target.
4. Approval of the real (V-05) rehearsal itself; G-21 stays OPEN until its evidence
   is reviewed and signed off.
