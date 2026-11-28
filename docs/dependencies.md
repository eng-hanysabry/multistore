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
| pg, @types/pg (dev only) | RLS harness client for real PostgreSQL (Jest tests only, never in the runtime build) | **Approved by you, 25 Nov 2026 (Telegram 16993295), as devDependencies only** |
| helmet | secure HTTP headers (D1, option A) | listed after D1 approval |
| prisma, @prisma/client (**6.19.3**) | runtime database access and the email outbox store. Pinned to 6.x on purpose: Prisma 7 and later need a driver adapter that pulls `pg` into the runtime, which you approved for tests only | listed |
| googleapis | Gmail API sender (`gmail_v1` only, imported from `googleapis/build/src/apis/gmail/v1` so the type checker does not load all 400 Google APIs — a pre-J12 choice kept as-is for Gmail). IP-5 Step 8: the Drive adapter **reuses this same installed package, no new library**, and per decision J12 uses only its supported public API surface — `google.drive({ version: 'v3', auth })` and the `drive_v3` types as exported from the package root; internal import paths such as `googleapis/build/src/apis/drive/v3` are not used. `google-auth-library` is imported directly: it is a transitive dependency of googleapis | listed |
| supertest, @types/supertest (dev) | HTTP tests for the health endpoints and headers | listed |
| argon2 (IP-4) | Argon2id hashing of passwords and verification/reset codes (spec 9, 13). Native binary; prebuilt linux-x64 included. | **Approved by you for IP-4, 26 Nov 2026 (Telegram 21341113)**; listed in spec 13 |
| @nestjs/jwt (IP-4) | access and refresh token signing and verification (spec 9, 13). Brings `jsonwebtoken` and small helper packages transitively. | **Approved by you for IP-4, 26 Nov 2026 (Telegram 21341113)**; listed in spec 13 |
| sharp (**0.35.5**, IP-5 Step 6) | image decoding, resize and WebP re-encode for product images (spec 7, J10/J11). Native binary (libvips), pinned exact, prebuilt `@img/sharp-linux-x64` for the Vercel-equivalent Linux x64 runtime; Node >= 20.9 required, repo runs Node 24. License: Apache-2.0. Smoke-tested on Linux x64 (Node 24.22.3): loads, decodes PNG/JPEG/WebP, emits WebP, thumb 256 px and display 1024 px variants verified. | **Approved by you for Step 6 only, 27 Nov 2026 (Batch 3 authorization, section 6)**; listed in spec 13 |
Not added, by your decision: passport, @nestjs/passport, passport-jwt, @nestjs/throttler. Not yet added (later phases): husky.

**Runtime:** Node 24 (`.nvmrc`, `engines`). Nest 12 ships ESM only. Jest runs with `--experimental-vm-modules`, which needs Node 24; Render uses `NODE_VERSION=24`. This is not in spec 13.
## App (`app/pubspec.yaml`)
| Package | Reason | Spec 13 |
|---|---|---|
| flutter_riverpod | state management (4.3) | listed |
| flutter_localizations (SDK), intl | gen_l10n, AR and EN (4.5) | listed |
| material_ui | Material widgets; Flutter 3.50 moved them out of the framework into this first-party package | SDK replacement, flag |
| flutter_lints | lints (8.5) | listed |
| mocktail (dev) | test mocks (4.4) | listed |
Not yet added: go_router, dio, flutter_secure_storage, shared_preferences, cached_network_image, riverpod_lint.

## IP-3 hosting change (26 Nov 2026)
No new package. Vercel needs none (zero-config NestJS). `api/package.json` gains a `postinstall` script (`prisma generate`) and the Prisma schema adds the `rhel-openssl-3.0.x` binary target for the Vercel runtime. Node 24 stays required.
