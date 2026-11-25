# IP-2 Foundation: acceptance evidence (25 Nov 2026)

Authorization: your Telegram decision 16854956 (relayed), IP-2 only. Repo: https://github.com/eng-hanysabry/multistore

## Acceptance criteria (spec 21.2)

| Criterion | Result | Evidence |
|---|---|---|
| CI runs on a trivial change | PASS | api: https://github.com/eng-hanysabry/multistore/actions/runs/45643767866 (success). app: https://github.com/eng-hanysabry/multistore/actions/runs/45643767848 (success). Triggered by a one-line comment change in api/src/main.ts and app/lib/core/config/environment.dart. First pushes: https://github.com/eng-hanysabry/multistore/actions/runs/45643397465 and https://github.com/eng-hanysabry/multistore/actions/runs/45643397219 (both success). |
| Lints fail on a deliberately bad fixture | PASS | api eslint (domain imports @nestjs/common and pg, any, console.log): https://github.com/eng-hanysabry/multistore/actions/runs/45643786366 failed at "npm run lint" with 4 errors. Flutter analyze: https://github.com/eng-hanysabry/multistore/actions/runs/45643786466 failed. Migration lint (int ids, no RLS): https://github.com/eng-hanysabry/multistore/actions/runs/45644277051 failed with 4 violations ([uuid-fk], [rls-enabled], [rls-forced]...). Flutter import boundary (domain imports flutter): https://github.com/eng-hanysabry/multistore/actions/runs/45644276872 failed: "[domain-pure] lib/features/catalog/domain/bad.dart ... 1 violations". Branches bad-fixture, bad-migration, bad-dart-boundary exist only as proof. Never merge. |
| Harness connects as multistore_app against real PostgreSQL | PASS | api CI job runs a postgres:16 service container. Jest "PASS rls test/rls/matrix.rls.spec.ts" (26 tests). The Postgres log in the run shows the expected denials when multistore_app tries SET ROLE / SET SESSION AUTHORIZATION. Also passed locally on PG 16.2. |
| Log redaction tests pass | PASS | test/unit/redact.spec.ts passes in the same run (unit 23 tests). |
| APK artifact | PASS | app run https://github.com/eng-hanysabry/multistore/actions/runs/45643767848 builds app-release.apk (43.3 MB, release build, placeholder API URL) and uploads artifact "multistore-app-apk" (id 15036857455, 20.9 MB zip). Download from the run page (Artifacts section, needs GitHub login). Local check: SHA-256 592f57331455bfc11a9643909321cf6801f979b316da8405cf3e55af2c7a8375, contains AndroidManifest.xml and classes.dex. Not installed on a device. |

## Totals in CI (run 45643767866)
- api: 49 tests passed (4 suites), coverage 97.39% statements, 93.75% branches.
- app: tests pass, line coverage 95.7% (44/46), gate 80%.

## Caveats
- The ERROR lines in the Postgres container log are expected negative tests (privilege denials, division by zero).
- The harness ran against a PostgreSQL 16 container in CI and a local 16.2, not Supabase. The Supabase pooler result is IP-1 (V01_pooler_report.md).
- The APK is a release build signed with the debug key, for testing only.
- Extra dev dependencies pg and @types/pg are not in spec 13 (docs/dependencies.md). They need your approval.
- Flutter 3.50.1 moved Material widgets into the first-party material_ui package; the app uses it.
- eslint no-restricted-imports (not eslint-plugin-boundaries) caught the @nestjs import in domain/.
- Full CI logs: docs/evidence/ci_logs/.
