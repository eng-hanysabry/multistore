# Backup and restore rehearsal — preparation (V-05 / G-21, spec 22.2)

Status: **PREPARED, NOT EXECUTED.** Authorized scope: local preparation only
(Telegram 21840559, item 3). The actual rehearsal, the storage location for
encrypted copies, the second Supabase project and the review of results each wait
for your separate approval. No backup was taken, no Supabase project was touched,
no credentials were moved into the sandbox or the repository.

This directory holds the scripts and the runbook. When you approve execution, the
same commands run first against the local PostgreSQL (a full rehearsal at zero
risk) and later, under your go-ahead, against the real Supabase project into the
second free project slot.

## Requirements

- PostgreSQL client tools 16+ (`psql`, `pg_dump`, `pg_restore`) on the operator machine.
- `age` (free, https://age-encryption.org) or GPG for encryption. Scripts use `age --passphrase`.
- Credentials at run time only, from the secret store: the operator/superuser connection
  through `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD` (or `.pgpass`), and for role handling
  `OWNER_PASSWORD`, `APP_PASSWORD`, `ADMIN_PASSWORD`. Nothing is read from files in the repo.
- For the real rehearsal only (your separate approval): the second Supabase Free project
  slot (decision D2a reserves it for restore rehearsals) and the owner credentials.

## The scripts

| Script | Purpose | Spec |
|---|---|---|
| `export.sh OUT_DIR [--encrypt]` | Logical export (`pg_dump` custom format) + manifest (row counts per table, SHA-256 of the dump, versions, timestamp) + privilege/policy/RLS/UUID snapshots | R-3, R-4 |
| `restore.sh DUMP TARGET_DB [--create-roles]` | Restores into a FRESH database only; refuses any existing database (R-5); re-creates the three roles and resets their passwords from the secret store (R-6) | R-5, R-6 |
| `verify-restore.sh MANIFEST TARGET_DB` | R-7 checks: row counts vs manifest, snapshot diffs (grants, column grants, policies, RLS flags, UUID columns), readiness as `multistore_app` | R-7 |
| `lib-snapshot.sh` | Shared snapshot queries used by export and verify (not run directly) | R-7 |

Run export and verify as the operator/superuser role. Two reasons, both verified during
IP-4: FORCE RLS binds even `multistore_owner`, and the `information_schema` privilege
views show each role only its own grants, so a snapshot taken as a lesser role is
silently incomplete.

## Local rehearsal commands (first run, after your approval)

```bash
cd api && npx prisma migrate deploy   # or the harness path: any migrated local database
export PGHOST=127.0.0.1 PGPORT=54400 PGUSER=postgres PGDATABASE=postgres
ops/backup/export.sh ops/backup/out
ops/backup/restore.sh ops/backup/out/multistore-<timestamp>.dump multistore_rehearsal --create-roles
export APP_PASSWORD='rls-harness-test-only'   # local test password, from the harness
ops/backup/verify-restore.sh ops/backup/out/multistore-<timestamp>.manifest.txt multistore_rehearsal
# cleanup: dropdb multistore_rehearsal; rm -rf ops/backup/out
```

Time the whole run (V-05 step 4) and record manifest, check output, timing and date.

## Real-Supabase rehearsal commands (later, separate approval)

Identical mechanics, different connection and an encrypted output, into the second
project slot — never the live project (R-5):

```bash
# 1. Export from the live project (operator role through the pooler), encrypted (R-4)
export PGHOST=<pooler-host> PGPORT=5432 PGUSER=postgres PGDATABASE=postgres
ops/backup/export.sh <secure-out-dir> --encrypt

# 2. On the SECOND project: create the roles and reset passwords from the secret store (R-6),
#    then restore the decrypted dump
age --decrypt <secure-out-dir>/multistore-<timestamp>.dump.age > /tmp/rehearsal.dump
export PGHOST=<second-project-host> PGUSER=postgres
export OWNER_PASSWORD=... APP_PASSWORD=... ADMIN_PASSWORD=...   # from the vault, run time only
ops/backup/restore.sh /tmp/rehearsal.dump postgres_restore_target --create-roles

# 3. Verify (R-7): decrypt manifest + snapshots next to it first
ops/backup/verify-restore.sh <secure-out-dir>/multistore-<timestamp>.manifest.txt postgres_restore_target

# 4. Record: manifest, check output, timing, date (V-05 evidence)
shred -u /tmp/rehearsal.dump
```

Supabase's own `supabase db dump` is an equivalent export route; the scripts above were
chosen because they need no CLI login and produce the manifest and snapshots in one pass.

## How restored-copy integrity is verified

- Row counts per table must equal the manifest exactly.
- The dump's SHA-256 in the manifest ties the verification to a specific export file.
- Snapshot diffs must be empty for: table grants, column grants (correction B surface),
  every RLS policy (expression text included), RLS enabled+forced flags per table, and
  the UUID type of every `id`/`*_id` column. Together these are the 6.4 policy-matrix and
  6.6 privilege-model surface, checked without re-running migrations.
- Readiness: `multistore_app` connects and answers `SELECT 1`.
- Known limitation: the Jest RLS suites provision their own fixtures (`DROP OWNED BY …`),
  so they are not pointed at a restored copy; the snapshot diff above is the equivalent
  check for a restored database and is what V-05 step 3 records.

## Rollback and recovery

| Scenario | Steps | Spec |
|---|---|---|
| Bad migration or accidental deletion (live) | Restore the latest export into a new project, apply R-6 role handling, run `verify-restore.sh`, switch the API connection string only after all checks pass | R-5/R-6/R-7 |
| Supabase project paused | Restore from the dashboard; if unavailable, restore from the latest export; API reports 503 meanwhile | 10.1, G-03 |
| Rehearsal fails or is interrupted | Drop the rehearsal database/project; the live project was never touched (R-5), so nothing rolls back | — |
| Pre-migration safety (D2) | `export.sh` runs before every migration; a failed migration rolls back to the pre-migration export as in row 1 | D2, R-3 |

## Known limits

- Supabase Free has no point-in-time recovery; worst-case data loss is the time since the
  last export (D2 sets a 7-day recovery point, so weekly exports are the maximum gap).
- Logical dumps do not carry role passwords (reset from the secret store, R-6) or server
  settings and extensions (the migrations re-create what the schema needs).
- Default privileges are recorded against the creating role; restoring as a different
  superuser can shift them — the grants snapshot diff catches this.
- A plaintext dump exists on the operator machine between export and encryption;
  `--encrypt` removes it, and the decrypted copy during a rehearsal is shredded after.
- The free project pauses after about a week of low activity (10.1); the rehearsal
  project may need a dashboard wake before use.
- Export/restore duration grows with data; V-05 requires timing the run against the R-2 target.

## Secrets-exposure review

Reviewed line by line: the scripts and this plan contain no passwords, passphrases,
tokens, hosts or account names. All credentials enter through environment variables at
run time; the encryption passphrase is only ever typed into `age`'s own prompt. The
repository `.gitignore` blocks `ops/backup/out/`, `*.dump`, `*.age`, `*.gpg` and
`backup-manifest-*` so rehearsal output cannot be committed by accident. No backup file
or passphrase is in Git.

## Open decisions (yours, before any execution)

1. Approval to execute the rehearsal, local first.
2. Storage location for encrypted copies and retention (the A5 options table from the
   IP-4 review: your encrypted computer + offline copy recommended; last 3 pre-migration
   + 4 weekly exports proposed).
3. Who runs the real export: you on your machine, or the agent with a per-use vault
   approval for the owner credential.
4. Approval to create the second Supabase Free project for the restore target.
