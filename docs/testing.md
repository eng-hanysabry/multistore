# Testing
- `api`: `npm test` (unit), `npm run test:rls` (real PostgreSQL, RLS on, roles multistore_app and multistore_admin, pool of one connection), `npm run lint:migrations`, `npm run contract:check`, coverage gate 80%.
- `app`: `flutter test --coverage`, `flutter analyze --fatal-warnings --fatal-infos`, `dart run tool/check_boundaries.dart`.
- RLS harness environment: `PGHOST`, `PGPORT`, `PGUSER` (superuser, used only for setup and seeding), `PGPASSWORD`, `PGDATABASE`.
- Status model (spec 23): a test is Specified, Implemented, Executed, Passed separately. Evidence for IP-2 is in `docs/evidence/`.
