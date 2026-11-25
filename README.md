# MultiStore

Multi-tenant store platform: a NestJS API (`api/`) and a Flutter app (`app/`) in one repository, linked only by `contracts/openapi.json`. Spec: MultiStore Final Technical Document v4.9, section 3.

Status: IP-2 (Foundation). No feature code yet.

## Run and test, step by step

### API (`api/`)
Needs Node 22 and a PostgreSQL 16+ for the RLS tests.
```
cd api
npm ci
cp .env.example .env          # fill DATABASE_URL (multistore_app) and JWT_SECRET
npm run format:check && npm run lint && npm run typecheck
npm test                        # unit tests (redaction, config, migration lints, import boundaries)
PGHOST=localhost PGUSER=postgres PGPASSWORD=... npm run test:rls   # real PostgreSQL, RLS on
npm run lint:migrations         # migration and source lints
npm run contract:check          # contracts/openapi.json matches the code
```
`npm run test:all` runs everything with the 80% coverage gate. The RLS tests create the roles `multistore_owner`, `multistore_app` and `multistore_admin` in the database you point them at. Use a throwaway database.

### App (`app/`)
Needs the Flutter SDK (stable).
```
cd app
flutter pub get
flutter gen-l10n
dart format --set-exit-if-changed .
flutter analyze --fatal-warnings --fatal-infos
dart run tool/check_boundaries.dart     # import boundaries and RTL rules
flutter test --coverage
flutter run --dart-define=API_BASE_URL=https://your-api.example
```

## CI
`.github/workflows/api.yml` runs when `api/**` or `contracts/**` change. `.github/workflows/app.yml` runs when `app/**` or `contracts/**` change and uploads a downloadable APK artifact.

## Secrets
Never commit `.env`, keystores or tokens. Logs and error responses are redacted at the sink (spec 6.8).
