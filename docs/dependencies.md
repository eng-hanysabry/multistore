# Dependencies (each with a reason)
## API (`api/package.json`)
| Package | Reason | Spec 13 |
|---|---|---|
| @nestjs/common, core, platform-express, config, swagger | framework, HTTP, typed config, OpenAPI contract | listed |
| reflect-metadata, rxjs | required by NestJS | transitive requirement |
| class-validator, class-transformer | DTO validation (5.4, 5.6) | listed |
| typescript, ts-node, @types/node | build and run scripts | tooling |
| eslint, typescript-eslint, eslint-plugin-boundaries, prettier | lint, import boundaries, format (8.5, 5.3) | listed (eslint, prettier); boundaries named in 5.3 |
| jest, ts-jest, @types/jest | test runner (8.1) | listed |
| **pg, @types/pg (dev only)** | RLS harness client for real PostgreSQL. **Not in the spec 13 list; needs your approval.** Prisma 7 also needs a pg driver adapter in IP-4. | NOT listed |
Not yet added (later phases): prisma, @prisma/client, @nestjs/jwt, passport, throttler, argon2, googleapis, sharp, supertest, husky.
## App (`app/pubspec.yaml`)
| Package | Reason | Spec 13 |
|---|---|---|
| flutter_riverpod | state management (4.3) | listed |
| flutter_localizations (SDK), intl | gen_l10n, AR and EN (4.5) | listed |
| material_ui | Material widgets; Flutter 3.50 moved them out of the framework into this first-party package | SDK replacement, flag |
| flutter_lints | lints (8.5) | listed |
| mocktail (dev) | test mocks (4.4) | listed |
Not yet added: go_router, dio, flutter_secure_storage, shared_preferences, cached_network_image, riverpod_lint.
