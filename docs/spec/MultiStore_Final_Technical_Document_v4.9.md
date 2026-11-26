# MultiStore: Final Technical Document (v4.9): Final Review & Execution Plan

**Scope:** Backend (NestJS) and Flutter app. **Version:** 4.9, 25 Nov 2026 (documentation patch on v4.8, see the v4.9 change log below). **Status:** for your final review. Baseline: v4.7 (24 Nov 2026), rebuilt from the v4.7 PDF because the v4.7 markdown source was lost (see the v4.8 change log for what could not be recovered exactly). v4.8 is documentation only. It resolves or marks the six outstanding decisions (section 17), corrects documentation and scope inconsistencies found in v4.7, defines the Phase 1 product scope (18), the Super Admin interface (19), the Phase 1 and deferred feature split (20), implementation phases (21), security release gates, backup and recovery and validation procedures (22), and a test status register (23). **Approval of this technical document is separate from final implementation approval.** Nothing in v4.8 is approved, no implementation phase is authorized, and no code may be written, modified or executed until you explicitly give final implementation approval. The history below (v4.7 and earlier) is kept as recorded.

**What changed from v4.8 (v4.9, documentation only, your instruction of 25 Nov 2026):**

1. **Empty-string tenant and user context (sections 6.2, 6.4, 6.7, 5.6, 10.7):** every policy now uses `NULLIF(current_setting(..., true), '')::uuid` for `app.tenant_id` and `app.user_id`, because the IP-1 spike showed pooled connections return an empty string, not NULL, after a prior transaction-local `set_config`. New checklist row and migration lint in 6.4; canary note in 10.7.
2. **IP-1 recorded (sections 16.1, 22.1, 21.1):** G-01 PASSED, Assumptions A and B PASSED in the NULLIF form, as you decided. No other gate or checklist item changed.
3. **Security note for IP-4 (6.6, section 21 IP-4):** the Supabase default roles `anon`, `authenticated` and `service_role` must have no privileges on application tables.
4. Nothing else changed. No decision, approval or checklist item was edited.

**What changed from v4.7 (your instruction of 25 Nov 2026, documentation only):**

1. **Six outstanding decisions: all six remain OPEN.** New section 17 records each with options, a recommendation and its consequence. None is recorded as decided or approved.
2. **Documentation and scope inconsistencies corrected:** (1) "Open points: none blocking" in section 1 contradicted six unresolved decisions; (2) step-up authentication was written as a requirement in 8.7-E while undecided; (3) one versus separate Gmail and Drive refresh tokens (10.3 versus 9.1); (4) carts and orders appeared in security text with no Phase 1 feature; (5) the Super Admin interface was referenced but never defined. Smaller corrections are listed in the v4.8 change log.
3. **New section 18:** Phase 1 product scope with Guest, Customer and Merchant journeys. **New section 19:** Super Admin interface and boundaries. **New section 20:** Phase 1 versus deferred features.
4. **New section 21:** implementation phases IP-0 to IP-9 with dependencies, deliverables and acceptance criteria.
5. **New section 22:** security release gates G-01 to G-23, backup and recovery requirements, and validation procedures V-01 to V-08.
6. **New section 23 and revised 8.6:** every test is shown as specified, implemented, executed and passed, separately. Nothing is claimed executed or passed.
7. **Preserved without weakening:** all security requirements, the UUID standard (5.6), the three-credential separation (6.6), and the RLS requirements (6.2, 6.4). Section 6 subsections were put in numeric order (6.4 and 6.5 before 6.6 to 6.8) without changing their text except as listed in the change log.
8. **Section 16:** the approval-separation statement is kept, six new checklist items were added, and every checklist item (now 31) stays unchecked.

**What changed from v4.6 (your instruction of 24 Nov 2026, documentation only):**

This version adds the security layer documentation you asked for, in the role of Lead Security Architect and documentation reviewer.

1. **New section 5.6: UUID identifier standard (mandatory).** Every table has an `id` UUID primary key; every foreign key is UUID and references a UUID primary key; no INT or BIGINT primary or foreign keys exist. One generation strategy, Prisma-side `@default(uuid())` with no database-side default, kept consistent by migration lints. Every table, entity, relationship, join table and tenant identifier is reviewed; exceptions: none recorded. Automated validation requirements are specified, including migration and backward-compatibility handling for any integer ids that may exist in the starter schema.

2. **New section 8.6: Security Threat Model & Security Testing Checklist.** Fifteen risks (IDOR/BOLA, tenant isolation bypass, broken authentication/JWT, privilege escalation, SQL injection, XSS, rate limiting, account enumeration, insecure file upload, CSRF, CORS, cache tenant leakage, SSRF, race conditions, information leakage), each with scenario, affected modules, impact, mitigation, server-side authorization requirements, positive and negative specified tests, severity, status and OWASP category. A four-state model (requirement documented, test specified, test implemented, test executed and passed) is defined; everything new is at the first two states only.

3. **New section 8.7: additional security review areas.** RLS and connection pooling; the four role boundaries; draft vs published data; Google Drive media security; Super Admin and audit logs; dependency and deployment security; and a list of unresolved design decisions, listed rather than invented.

4. **New section 8.8: security test matrix.** Thirty specified tests (STM-01 to STM-30) with preconditions, actors, scenarios, expected secure behavior, HTTP outcomes, database side-effect expectations, severity and level; plus the mandatory cross-tenant matrix across read, create, update, delete, search, list/pagination, export/analytics, media access, publish/unpublish, background jobs and the email outbox.

5. **New section 8.9: security priorities (P0/P1/P2) and release readiness.** P0 covers tenant isolation, BOLA/IDOR, authentication, privilege escalation, RLS context leakage, secrets exposure, unauthorized draft/media access and UUID schema consistency. The readiness rule: a severity label alone does not establish readiness; no gate is marked passed without evidence.

6. **Section 16: five new unchecked checklist items** covering UUID standardization, threat model coverage, critical security test specifications, file/media/cache/API/secrets requirements, and security testing and release-readiness evidence. Every checklist item stays unchecked, and the approval-separation statement, including its exact sentence “Approval of this technical document is separate from final implementation approval.”, is preserved.

7. **Preserved without weakening:** the six Super Admin isolation tests and the RLS validation checklist in 6.4; the three-credential separation in 6.6 (`multistore_app` runtime, `multistore_admin` through `AdminPrismaService`/`AdminModule` only, `multistore_owner` for migrations only, no reuse); the RLS and role restrictions in 6.2; the secrets-and-logging requirements and tests in 6.8; the v4.5 email outbox recovery behavior in 10.7; the three mandatory validation gates and all unverified assumptions in 16.1.

8. **Nothing else changed.** No code was written, modified, executed or generated; no project file, configuration, migration or CI file was touched; no dependency, paid service or pattern was added; nothing is marked approved. Documentation approval stays separate from final implementation approval.

**What changed from v4.5 (your corrective instruction of 24 Nov 2026, documentation only):**

This version addresses the remaining Super Admin database security test coverage gap.

1. **Section 6.4: the RLS security validation checklist gains explicit Super Admin negative tests.** The existing statement that `multistore_admin` cannot disable RLS, drop policies or alter tables is kept. New automated negative tests: `multistore_app` cannot access `ADMIN_DATABASE_URL`; `multistore_app` cannot import, instantiate or invoke `AdminPrismaService` or the Admin database connection; no ordinary API request can reach the Super Admin database connection through any runtime code path; `multistore_admin` cannot acquire ownership of application tables, schemas or database objects; `multistore_admin` cannot gain membership in `multistore_owner` or any privileged role; bypass attempts fail and are covered by automated security tests.

2. **Section 6.6: credential separation made explicit.** Runtime application credentials: `multistore_app` only. Super Admin runtime credentials: `multistore_admin` through `AdminPrismaService` only. Migration credentials: `multistore_owner`, used only by migration and deployment processes. No credential is reused across roles. Tests added: the ordinary API runtime cannot read `ADMIN_DATABASE_URL`; `AdminPrismaService` is accessible only within `AdminModule`; `multistore_admin` cannot ALTER or DROP RLS policies, cannot disable RLS or FORCE ROW LEVEL SECURITY, cannot ALTER or DROP tables or schemas, cannot acquire ownership of objects; the runtime application role cannot `SET ROLE` to `multistore_admin` or `multistore_owner`.

3. **New section 6.8: secrets and logging.** Requirements and automated tests: database connection strings and passwords never appear in logs; Google OAuth access and refresh tokens never appear in logs; secrets are never exposed in API error responses, exception messages or stack traces; sensitive configuration is redacted from all logging paths; the tests cover both successful and failed requests.

4. **Section 16: one new unchecked checklist item** covering the additional Super Admin security tests and credential isolation. Every checklist item stays unchecked, the approval-separation statement is unchanged, and the three mandatory validation gates and assumptions in 16.1 are unchanged.

5. **Nothing else changed.** All v4.5 decisions, and the hosting, email, OAuth, tenant-resolution and RLS architecture, are preserved. No code was written, modified, executed or generated; no project file or configuration was touched. Documentation approval stays separate from final implementation approval. Nothing is marked approved.

**What changed from v4.4 (your corrective instruction of 24 Nov 2026, documentation only):**

1. **Section 10.7: email outbox recovery made explicit.** The email outbox sender is an in-process worker that starts automatically when the API starts. It resumes processing pending outbox messages after Render wakes from sleep or restarts. Messages stay persisted in PostgreSQL while the service is sleeping; the design does not assume an always-on worker or a separate background process on Render Free.

2. Section 16 stays fully unchecked, the approval-separation statement is unchanged, and the mandatory validation gates and assumptions in 16.1 are unchanged. No code was written or modified.

3. Open point: your message mentions two findings but lists one. If a second finding was intended, send it and it will go into the next version.

**What changed from v4.3 (your corrective instruction of 24 Nov 2026, documentation only):**

1. **Section 9.1: application-level allowlist on the OAuth callback (new 9.1.1).** The callback must verify the authenticated Google account identity against the single configured dedicated Gmail address and reject every other account. Google’s 100-user cap and the consent-screen description are stated explicitly as not being access control.

2. **Sections 6.1 and 6.7: tenant resolution split by actor.** Guest, Customer and Merchant: tenant from the URL path, validated server-side. Super Admin: explicit tenant parameter on admin operations, validated server-side and audit-logged. Section 6.3 and the 6.7 table are aligned.

3. Section 16 stays fully unchecked, the approval-separation statement is unchanged, and the three mandatory validation gates and assumptions in 16.1 are unchanged (one new unverified assumption, H, was added). No code was written or modified.

4. Open point: your message mentions four findings but lists two. If two more were intended, send them and they will go into the next version.

**What changed from v4.2 (your instruction of 24 Nov 2026, documentation only):**

1. **Approval checklist fully unchecked.** In v4.2, two items in section 16 were marked [x]. All items are now [ ]. Your three decisions stay recorded in section 1 (decisions 15 to 17) as decisions, but no approval checklist item is marked approved.

2. **New section 16.1:** all remaining unverified assumptions and mandatory validation gates in one list, with when each is checked.

3. **Explicit statement kept and added to section 16:** approval of this documentation is separate from final approval of implementation.

4. No code was written or modified. No source or project file was touched.

**What changed from v4.1 (your three decision confirmations, 24 Nov 2026):**

1. **Dedicated Google account type decided:** an **ordinary Gmail account**, not Google Workspace (section 9.1). Because an ordinary account cannot use the Internal user type, the OAuth consent screen uses **External**.

2. **Gmail OAuth Path A selected:** production publishing status **without verification**, restricted to the single dedicated account owner for the pilot. The unverified-app warning, the 100-user cap, and the migration triggers to full verification or another mail provider are documented in section 9.1.

3. **Customer multi-tenant design approved:** the JWT carries identity only; the active tenant is resolved from the tenant code in the URL path and validated server-side on every request (sections 6.1, 6.3, 6.7). The v4.1 wording that asked for confirmation is now recorded as decided.

4. **The three “confirm” items are kept as mandatory validation gates:** Supabase support for a custom `NOBYPASSRLS` role (gate 1, checked in the RLS spike), Render Free health-check configuration (gate 2, checked at deployment setup), and Supabase Free project pause behavior (gate 3, checked at setup and watched in operation). Their results are reported back to you.

**What changed in v4.1 (your five review points, kept for reference):**

1. **Gmail OAuth:** new section 9.1: exact consent-screen configuration, the `gmail.send` sensitive-scope verification requirements and the two ways to handle them, refresh-token stability, and a recovery runbook for revocation.

2. **Super Admin database security:** new section 6.6: exact privileges of `multistore_admin` (no superuser, no BYPASSRLS, no DDL, no ownership), how that is tested, and how ordinary API requests cannot reach it.

3. **Customer multi-tenant browsing:** new section 6.7 and corrected 6.1 and 6.3. **Design change for your confirmation:** Customer tokens carry identity only; the active store comes from the tenant code in the URL and is validated server-side on every request.

4. **Render reliability:** new section 10.7: health checks, database readiness, timeouts, safe retries with idempotency keys, and Gmail and database failure handling.

5. **RLS validation:** section 6.4 expanded with a checklist covering grants, role separation, transaction-local context, tenant switching, and missing or invalid context. Section 16 updated.

Where this version states something not yet verified, it is marked “confirm”. Three of them are the **mandatory validation gates** you asked to keep: Supabase accepting the exact `NOBYPASSRLS` role options (gate 1, checked in the RLS spike), Render Free health-check configuration (gate 2, checked at deployment setup), and Supabase Free project pause behavior (gate 3, checked at setup and watched in operation). **This is documentation only. No code has been written or** **changed, and nothing starts until you give final approval.**

**What changed in v4 (kept for reference):**

1. **Section 10.6 rewritten: hosting decided.** You selected the **Render Free** web service, with **no bank card** on any service. Its limitations are documented in a table: 15-minute idle sleep, about one-minute cold start, 750 free instance-hours per month, 0.1 CPU / 512 MB RAM, blocked outbound SMTP ports, ephemeral filesystem, bandwidth and build-minute caps, deploy and rollback constraints, and Render’s own “not for production” guidance.

2. **Section 10.3 rewritten: email decided.** Verification email moves from Gmail SMTP to the **Gmail API over HTTPS**, because Render Free blocks outbound traffic to SMTP ports. The account sending limit (500/day standard) and the current Gmail API quotas are recorded. SMTP and Resend remain drop-in later options behind the same `MailSender` port.

3. **Sections 1, 5.2, 5.5, 9, 13, 14 and 16 updated** to match: decisions table, `GmailApiMailSender`, `MAIL_PROVIDER=gmailapi|smtp|resend`, dependencies (`googleapis` covers Drive and Gmail; `nodemailer` optional later), a hosting row in the scalability path, and the approval checklist.

Everything else from v3 is kept, so this file is complete on its own.

## 1. Your decisions, as recorded

| **#** | **Decision** | **Your choice** | **Where applied** |
|---|---|---|---|
| 1 | Flutter state management | **Riverpod** | Section 4 |
| 2 | ORM | **Prisma** | Sections 5, 6 |
| 3 | Repository layout | **Monorepo, independent Flutter and NestJS projects** | Section 3 |
| 4 | Domain test coverage | **80% meaningful coverage** on Domain (and application) code | Section 8 |
| 5 | Tenant isolation, second layer | **PostgreSQL RLS as defense-in-depth** | Section 6 |
| 6 | CI | **GitHub Actions** for tests, lint and format | Section 8 |
| 7 | Images | **Google Drive files stay private.** Published product images reachable only through the Backend API. Drafts visible only to the owning Merchant. Drive URLs and credentials are never sent to Flutter. | Section 7 |
| 8 | Google account | **Dedicated Google account for app media**, separate from your personal account | Section 7 |
| 9 | Email verification | **Required before the first login.** Email and password is the primary method. **No paid SMS.** | Section 9 |
| 10 | Verification email sender | **Gmail API over HTTPS from the dedicated account for the pilot**, behind the `MailSender` port. (Changed from Gmail SMTP, which Render Free blocks.) SMTP and Resend remain later options. | Sections 9, 10.3 |
| 11 | Google sign-in | **Optional later addition.** Not in Phase 1. | Section 9 |
| 12 | Free API hosting | **Render Free web service** (selected 24 Nov 2026 from the written comparison). Limitations documented in section 10.6. | Section 10.6 |
| 13 | First step after approval | **The RLS technical spike is the first security validation step** after final approval. | Section 6.5 |
| 14 | No bank card, providers replaceable | **No bank card is added to any service.** Hosting and email sit behind abstractions, so providers can be switched later without touching business logic. | Sections 5.5, 10.6, 14 |
| 15 | Dedicated Google account type | **Ordinary Gmail account, not Google Workspace.** The OAuth consent screen therefore uses the External user type. | Section 9.1 |
| 16 | Gmail OAuth path | **Path A: production without verification, restricted to the single dedicated account owner for the pilot.** The unverified-app warning, the 100-user cap and the migration triggers are documented. | Section 9.1 |
| 17 | Customer multi-tenant design | **Approved.** The JWT carries identity only; the active tenant is resolved from the tenant code in the URL path and validated server-side on every request. | Sections 6.1, 6.3, 6.7 |

**Open points (corrected in v4.8):** decisions 1 to 17 above are recorded as decisions. Six further design decisions are **OPEN** and not decided: secure headers middleware, backup and restore on Supabase Free, step-up authentication UX, audit log retention, abuse protection without a paid CAPTCHA, and rich HTML (section 17.1). None of them is approved. The three “confirm” items are **mandatory validation gates** (sections 6.6, 10.1, 10.7), checked at the RLS spike and at setup; they do not need a decision from you. The remaining steps are your review of this document and, separately, your final approval of implementation. Implementation starts only after the second.

**Terminology used everywhere:** Guest (no account), Customer (signed in), Merchant (store owner/staff), Super Admin. The word “Client” is not used.

## 2. Engineering principles and where they are enforced

| **Principle** | **How it is applied** | **Enforced by** |
|---|---|---|
| Meaningful names, small functions | Verb-noun use cases (`PublishProduct`, `ListTenantProducts`). Target under about 30 lines per function. One class per file. | Lint rules, review checklist |
| Single responsibility | Controller = HTTP only. Use case = business rules. Repository = data access. Widget = rendering only. | Folder rules and import lint |
| Business logic separate from UI and infrastructure | Domain code has no Flutter, HTTP or Prisma imports. | Import-boundary lint, framework-free tests |
| Dependency inversion | Domain defines interfaces (`StorageProvider`, `MailSender`, repositories). Infrastructure implements them. Wired by DI. | NestJS providers, Riverpod overrides |
| No duplication | Shared widgets, one place for error mapping and pagination. | Duplication check in CI (warning level) |
| Low coupling | Modules and features depend on each other as little as possible, through exported services or interfaces, never through each other’s tables. This is an objective we keep improving, not an absolute ban. | Module boundary tests, review |

## 3. Monorepo layout and independence

One Git repository, two projects that do not know about each other’s code.

```
multistore/
  api/                      NestJS project (own package.json, lockfile, tsconfig, eslint, jest)
  app/                      Flutter project (own pubspec.yaml, lockfile, analysis_options)
  contracts/
    openapi.json            the only shared artifact: the API contract
  docs/                     architecture, ADRs, terminology (section 15)
  .github/workflows/
    api.yml                 runs only when api/** or contracts/** change
    app.yml                 runs only when app/** or contracts/** change
  README.md
```

**Independence rules**

1. **No shared source code.** `api/` never imports from `app/` and the reverse. There is no root `package.json` workspace and no shared Dart/TypeScript package. Each project installs, builds, tests and runs on its own with one command.

2. **The contract is the only link.** The API generates `contracts/openapi.json` from its code (`@nestjs/swagger`). A CI check fails if the committed file is out of date. Flutter has hand-written DTOs. A Flutter contract test loads JSON fixtures taken from the contract and checks the DTOs parse them, so a breaking API change shows up as a failing Flutter test.

3. **Separate pipelines.** A change in `app/` does not run backend tests and the reverse. A change in `contracts/` runs both.

4. **Separate dependency management and versioning.** Each project has its own lockfile and update cadence.

5. **Either project can be moved to its own repository** by copying the folder and its workflow file. That is the test for “independent”.

6. **Local run:** `api/` needs only `.env` and a database URL. `app/` needs only an API base URL passed with `--dart-define`. Nothing else is shared.

## 4. Flutter architecture (Riverpod)

### 4.1 Style: feature-first Clean Architecture

Each feature has three layers, with dependencies pointing inward.

**Presentation:** screens, widgets and Riverpod notifiers. Knows only domain types and use cases.

**Domain:** entities, repository interfaces, use cases. Pure Dart, no Flutter, no dio.

**Data:** DTOs, API calls (dio), mappers, repository implementations, local cache.

### 4.2 Folder structure

```
app/
  lib/
    main.dart, app.dart
    core/
      config/            environment, API base URL (dart-define)
      di/                root providers: dio, secure storage, token store
      network/           dio client, auth interceptor, refresh, error mapper
      error/             Failure types
      storage/           secure token storage, cache wrapper
      routing/           go_router config, guards (Guest / Customer / Merchant)
      l10n/              ARB files (ar, en), locale controller
    design_system/
      tokens/            colors, typography, spacing, radius, motion
      theme/             AppTheme builder, TenantTheme (dynamic branding)
      components/        buttons, inputs, cards, dialogs, loaders, states, product widgets
      layout/            responsive and RTL-aware helpers
    features/
      splash/  onboarding/  branding/  auth/  store/  favorites/ profile/ settings/
      catalog/
        presentation/    screens/, widgets/, providers/ (notifiers)
        domain/          product.dart, catalog_repository.dart, get_products.dart
        data/            product_dto.dart, catalog_api.dart, catalog_repository_impl.dart, providers
  test/                  mirrors lib/
  integration_test/      key flows
```

### 4.3 How Riverpod is structured

Riverpod does two jobs: state management and dependency injection. Plain providers, no code generation in Phase 1.

| **Provider kind** | **Used for** | **Example** |
|---|---|---|
| `Provider` | Wiring: API clients, repositories, use cases | `catalogRepositoryProvider` returns `CatalogRepositoryImpl(api)` typed as `CatalogRepository` |
| `AsyncNotifierProvider` | Screen state that loads data and can change | `productListProvider` calls the `GetProducts` use case |
| `NotifierProvider` | Simple synchronous UI state | selected category, locale |
| `Provider.family` | State per id | `productDetailsProvider(productId)` |
| `StateProvider` | Not used. Use `NotifierProvider` instead, to keep one pattern. |  |

**Rules**

1. **Wiring direction:** presentation providers depend on use-case providers, use cases depend on the repository interface, and only the `data/` provider file knows the concrete implementation. Swapping an implementation means overriding one provider.

2. **One state pattern for async data:** `AsyncValue` rendered by the shared `AsyncView` widget (loading, empty, success, error with retry). No screen draws its own spinner or error text.

3. **Notifiers hold no business rules.** They call a use case and expose its result. Rules live in `domain/`.

4. **Scope:** providers are global by default. Providers that depend on the signed-in user or tenant are invalidated on logout or tenant switch, so no data leaks between sessions.

5. **No** `ref` **inside domain or data classes.** They receive dependencies through constructors.

6. `ref.watch` **in** `build`**,** `ref.read` **in callbacks.** Enforced by the `riverpod_lint` rules, which are added as a dev dependency (lint only, not code generation).

### 4.4 How Riverpod code is tested

| **What** | **How** |
|---|---|
| Use case | Plain Dart unit test with a fake repository (mocktail). No Flutter, no Riverpod. |
| Notifier | `ProviderContainer` with `overrides` replacing the use-case or repository provider by a fake. Assert the sequence `loading -> data` and `loading -> error`. |
| Widget / screen | `ProviderScope(overrides: [...])` around the widget, in both Arabic RTL and English LTR. Assert loading, empty, success and error states. |
| Repository implementation | Unit test with a fake dio adapter returning contract fixtures. |
| Routing guards | Container with a fake auth state, assert redirects for Guest, Customer and Merchant. |
| Flows | `integration_test` against a local API for Guest browse, Customer sign-in with verification, Contact Store. |

Because every dependency enters through a provider, no test needs the network, a real database, or global state.

### 4.5 Rules

1. `domain/` imports no Flutter and no dio. Enforced by an import check in CI. This one is absolute.

2. Screens never call dio. They read providers.

3. **Feature independence is a low-coupling objective, not an absolute rule.** Features should not import each other’s `data/` or `presentation/`, and shared things belong in `core/` or `design_system/`. Where a real dependency between features is the cleaner option (for example, the store feature reading the catalog feature’s exported domain type), it is allowed through the other feature’s **public barrel file** (`features/catalog/catalog.dart`), never through internal files, and the dependency is one-directional. Each exception is a conscious, reviewed choice, recorded in the pull request.

4. Layouts use `EdgeInsetsDirectional` and `AlignmentDirectional` only, never left/right, so RTL is correct by default.

5. Localization uses Flutter’s built-in `gen_l10n` with ARB files. The Backend returns machine-readable error codes and the app shows the localized message.

### 4.6 Dynamic branding

`TenantTheme` takes the tenant config (primary color, secondary color, logo) and builds `ThemeData` through the design system. Foreground colors are computed for contrast. System colors (error, success) are never tenant-themed. Components read colors from the theme only. A lint rule bans `Color(0x...)` outside `design_system/tokens`.

## 5. Backend architecture (NestJS)

### 5.1 Style

A **modular monolith**: one deployable app, independent NestJS modules with explicit public surfaces. Inside each module:

`presentation`: controllers and DTOs. HTTP in, HTTP out, validation only.

`application`: use cases, one class per action.

`domain`: entities, value objects, ports (interfaces). Pure TypeScript.

`infrastructure`: Prisma repositories and adapters that implement the ports.

Dependencies point inward: presentation, then application, then domain; infrastructure implements domain.

### 5.2 Folder structure

```
api/
  prisma/                   schema.prisma, migrations/ (including RLS SQL), seed.ts
  src/
    main.ts, app.module.ts
    common/
      config/               typed env config, validated at boot
      errors/               AppError types, global exception filter
      http/                 pagination, response envelope, request-id
      tenancy/              TenantContext, TenantGuard, tenant-scoped transaction runner
      auth/                 JwtAuthGuard, RolesGuard, @CurrentUser, @Roles
      logging/
    infrastructure/
      database/             PrismaService
      storage/              StorageProvider port, DriveStorageProvider, SupabaseStorageProvider (later)
      mail/                 MailSender port, GmailApiMailSender (pilot), SmtpMailSender and ResendMailSender (later)
    modules/
      auth/  users/  tenants/  branding/  catalog/  media/  stores/  admin/  health/
  test/
    integration/            real Postgres, HTTP level
    isolation/              cross-tenant and authorization suites
    rls/                    database-level policy tests
```

Each module has the same shape:

```
modules/catalog/
  catalog.module.ts
  presentation/    products.controller.ts, dto/
  application/     create-product.use-case.ts, list-products.use-case.ts
  domain/          product.entity.ts, product.repository.ts (interface), money.vo.ts
  infrastructure/  prisma-product.repository.ts
```

### 5.3 Rules that keep modules independent (low coupling, not zero coupling)

1. A module exports only use cases or a small facade through its module definition. Others never import its `infrastructure` or Prisma models.

2. Cross-module data goes through the other module’s exported service. No cross-module joins in repositories.

3. `domain/` imports nothing from `@nestjs/*` or `@prisma/*`. This one is absolute.

4. Enforced by `eslint-plugin-boundaries` and a test that fails on violations.

5. **Low coupling is the objective, not an absolute ban.** Where sharing is genuinely cleaner than duplicating (a shared pagination type, a shared error code list), it lives in `common/` and any module may use it. A direct dependency between two feature modules is allowed only through the other module’s exported interface, one-directional, and is recorded in the pull request. The goal is that a change in one module rarely forces changes in another, and that coupling we accept is visible and deliberate.

### 5.4 Errors, validation, API conventions

DTO validation with `class-validator`, whitelist on, unknown fields rejected.

One error shape: `{ code, message, details?, requestId }`, with codes such as `PRODUCT_NOT_FOUND` and `EMAIL_NOT_VERIFIED`.

Cursor pagination for lists. Versioned prefix `/api/v1`.

Rate limiting on auth endpoints (`@nestjs/throttler`).

OpenAPI generated from code and committed as `contracts/openapi.json`.

### 5.5 External services behind ports

```
StorageProvider   put(file, key) / get(key) / delete(key) / exists(key)
MailSender        send(to, template, data)
```

`STORAGE_PROVIDER=drive|supabase` and `MAIL_PROVIDER=gmailapi|smtp|resend` are config values. A contract test suite runs against every implementation, so a new provider is accepted only if it passes the same tests.

### 5.6 Identifier standard: UUID for every primary and foreign key (new in v4.7)

**The standard (mandatory).**

1. Every table has a primary key column named `id` of type UUID. This includes every tenant table, every join table (for example `memberships`), and every internal table (`email_outbox`, `audit_log`, the verification and reset code table).

2. Every foreign key column is of type UUID and references a UUID primary key. `tenant_id` is UUID on every tenant-owned table, matching `tenants.id`. This is what the RLS policies in 6.2 already assume: they compare `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`.

3. No INT or BIGINT primary keys or foreign keys exist anywhere in the schema. A numeric sequence is never exposed to clients and never used inside the database as a key.

4. Justified exceptions: **none are recorded in this version.** Any future exception (for example a third-party system that mandates integer ids) requires a written justification added to this section and your approval before it is built.

**Prisma representation (one consistent pattern on every model):**

```
model Product {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @db.Uuid
  tenant   Tenant @relation(fields: [tenantId], references: [id])
  // ...
}
```

`id` is the column name; UUID is the type. Every foreign key uses the same `String ... @db.Uuid` representation as the primary key it references.

**Generation strategy (one strategy, stated explicitly).** UUIDs are generated **by Prisma on the client side** through `@default(uuid())`, not by PostgreSQL. The PostgreSQL columns carry **no database-side default**. Reasons: the id value is known before the insert, so relations and idempotency records can be built in one round trip; it works identically through the Supabase transaction pooler (6.3); and inserts inside interactive transactions do not need a `RETURNING` round trip to learn the id. Consistency between the layers is enforced by a migration lint that asserts no `DEFAULT gen_random_uuid()`, `DEFAULT uuid_generate_v4()` or any other database-side default exists on an `id` column, so Prisma and the migrations can never disagree about who generates ids. Inserts made outside Prisma (migrations, seeds, reviewed manual steps) must supply UUID values explicitly; seed data uses fixed UUIDs so tests are repeatable.

**Reviewed scope.** Every table, entity, relationship, join table and tenant identifier named in this document was reviewed: `tenants`, `users`, `memberships`, `stores`, `categories`, `products`, `product_images`, Customer-owned rows (favorites in Phase 1; carts and orders are deferred, section 20, and follow this standard when introduced), `email_outbox`, `audit_log`, and the verification/reset code table. All follow the standard above. The starter schema from earlier steps (section 11) is **not assumed compliant**: it is redesigned, not inherited, and any integer ids in it are replaced before any real data exists. Because the pilot has no production data, no data migration of live records is needed; if an integer id is ever discovered in a migration later, that is a blocker and is reported to you, not silently converted.

**API and application representation.** UUIDs cross the API as canonical lowercase string form. DTOs validate id fields and route id parameters with `class-validator` UUID validation (`@IsUUID('4')`, matching the Prisma `uuid()` generator); unknown fields are already rejected by the whitelist (5.4). The `:tenantCode` path parameter is a human-readable code, not a UUID, and resolves to the tenant’s UUID server-side (6.1, 6.7). Repository contracts and domain entities type ids as string UUIDs. UUID secrecy is never an authorization mechanism: a correct UUID without ownership and tenant match returns 404 (section 8.6.1).

**Automated validation requirements (specified, not yet implemented).** Each line is an automated check that runs in CI:

| **Check** | **Requirement** |
|---|---|
| Prisma schema lint | Every model’s primary key is a field named `id`, typed `String @id @default(uuid())` `@db.Uuid`. |
| Prisma schema lint | Every relation scalar field is `String @db.Uuid` and its `@relation` targets a UUID primary key. |
| Prisma schema lint | No `Int` or `BigInt` is used as `@id` or as a relation scalar field anywhere in the schema. |
| Migration lint | Every created table has a `uuid` primary key; every foreign key column is `uuid` and references a `uuid` primary key; an `information_schema` snapshot test compares the live database against the expected file. |
| Migration lint | No `id` column has a database-side default (single generation strategy, above). |
| Insert test | Creating records and relations through Prisma assigns valid UUIDs with no database default present, including inside the tenant-scoped transaction runner (6.3). |
| API test | A non-UUID value in an id route parameter or DTO id field is rejected with a validation error, not a 500. |

## 6. Tenant isolation: tenant context and PostgreSQL RLS

Two independent layers. If one has a bug, the other still blocks the leak.

### 6.1 Layer 1: application (always on)

Every Merchant-owned table has `tenant_id`.

**Tenant resolution differs by actor (explicit, v4.4):**

| **Actor** | **Where the active tenant comes from** | **Server-side validation** |
|---|---|---|
| Guest | **Tenant code in the URL path** | Tenant exists and is active (not suspended); only published data is returned |
| Customer | **Tenant code in the URL path** | Same as Guest, plus identity from the verified JWT; personal rows need `tenant_id` and `user_id` |
| Merchant | **Tenant code in the URL path** | Same as Guest, plus a matching `memberships` row (user, tenant, role) (section 6.7) |
| Super Admin | **Explicit tenant parameter** on the admin operation (admin routes only, never the public tenant path) | Validated server-side: tenant must exist, the caller must be a verified Super Admin (DB re-check, section 6.6), and every call is written to the audit log with actor, tenant, operation and time (6.6, 6.7) |

The JWT carries identity (user id, role, session), not the active tenant, for every actor. For Guest, Customer and Merchant, a request body, query string or header can never set the tenant. The Super Admin tenant parameter is accepted only on admin routes behind `SuperAdminGuard`, on the separate admin connection, and nowhere else.

Guest access returns only published data of a non-suspended tenant.

The `RolesGuard` reads the caller’s role from the **verified JWT** and, for Merchant endpoints, cross-checks it against the `memberships` table for that tenant, so a token claim alone is not enough.

Repositories never receive a raw Prisma client. They receive a `TenantContext` and run through the tenant-scoped transaction runner (6.3). Unscoped access exists only for Super Admin, through a separately named runner whose use is reviewed.

### 6.2 Layer 2: PostgreSQL Row Level Security (redesigned)

**What was wrong in v2.** Permissive policies in PostgreSQL combine with OR: a row is visible if **any** permissive policy allows it. The old `tenant_isolation` policy allowed every row of the current tenant for every request, including Guest requests, so the separate `guest_published_read` policy added nothing: a Guest could read drafts through `tenant_isolation`. The OR made the wider policy win.

**The redesign: every policy carries its role check.** Each policy names the role (or roles) it applies to, inside its `USING` and `WITH CHECK` expressions. Policies are role-exclusive, so the OR of all policies can never give a role more than its own policy allows. A session with `app.role = 'GUEST'` matches only the Guest policies, no matter how many other policies exist.

**Database roles**

| **Role** | **Used by** | **Notes** |
|---|---|---|
| `multistore_owner` | Migrations only (direct connection) | Owns the tables. Never used at runtime. |
| `multistore_app` | The running API (pooled connection) | **Not a superuser, no BYPASSRLS.** RLS applies to it. |
| `multistore_admin` | Super Admin operations only | Separate database role with its own policies. Reviewed use. |

Dedicated roles are needed because Supabase’s default `postgres` role bypasses RLS, so connecting as it would make the policies useless.

**Policies on** `products` **(the pattern repeats on every tenant table:** `categories`**,** `product_images`**,** `stores`**, …)**

```
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;   -- applies even to the table owner
-- 1. Guest: read published products of the current tenant only. Nothing else.
CREATE POLICY guest_read ON products
    FOR SELECT TO multistore_app
    USING (current_setting('app.role', true) = 'GUEST'
                  AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
                  AND status = 'PUBLISHED');
-- 2. Customer: read published products of the current tenant only. Nothing else.
CREATE POLICY customer_read ON products
    FOR SELECT TO multistore_app
    USING (current_setting('app.role', true) = 'CUSTOMER'
                  AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
                  AND status = 'PUBLISHED');
-- 3. Merchant: full access to rows of the current tenant only.
CREATE POLICY merchant_all ON products
    FOR ALL TO multistore_app
    USING      (current_setting('app.role', true) = 'MERCHANT'
                            AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (current_setting('app.role', true) = 'MERCHANT'
                            AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
-- 4. Super Admin uses the separate multistore_admin database role:
CREATE POLICY admin_all ON products
    FOR ALL TO multistore_admin
    USING      (true)
    WITH CHECK (true);
```

**Why this fixes the issue**

**Guest cannot read drafts, even with OR.** The only policy a Guest session matches is `guest_read`, which requires `status = 'PUBLISHED'`. The Merchant policy does not apply because its role check fails. OR-ing a false condition changes nothing.

**No permissive policy can override the Guest restriction.** Any new policy must include a role check to grant anything; a policy without one is rejected by the migration test in 6.4.

**Writes fail closed for Guest and Customer.** No INSERT, UPDATE or DELETE policy exists for those roles, so the default is deny.

**Cross-tenant access fails closed.** Every `multistore_app` policy requires `tenant_id = current_setting('app.tenant_id')`, and the check matches only the session’s tenant.

**Missing context fails closed.** If `app.tenant_id` or `app.role` is unset, `current_setting(..., true)` returns NULL, every comparison is NULL (not true), and **zero** **rows** are visible or writable. An unknown or empty `app.role` matches no policy, so it also sees zero rows.

**Empty-string context (verified in the IP-1 spike, v4.9).** After a pooled connection has run `set_config(..., true)` in an earlier transaction, `current_setting(..., true)` on that connection returns an empty string, not NULL, and `''::uuid` raises an error. Without protection, a request with no context would error instead of seeing zero rows. Every policy therefore compares `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`, and `user_id = NULLIF(current_setting('app.user_id', true), '')::uuid` in personal-table policies, so an empty value behaves exactly like an unset one (NULL, zero rows). A non-UUID, non-empty value still raises an error (fail closed, never data). Measured on the Supabase Transaction Pooler: the policies as written in v4.8 gave 64 of 67 checks passed (three no-context checks returned an error instead of zero rows); with NULLIF, 67 of 67 passed.

**Tables where roles see different things get their own policies**, following the same pattern. Examples: `memberships` and `tenants` get a Customer policy limited to the caller’s own user row (`user_id = NULLIF(current_setting('app.user_id', true), '')::uuid`), and drafts in `product_images` are reachable only through the Merchant policy.

### 6.3 How tenant and role context is trusted and validated

The context comes only from server-verified sources, never from request input.

1. **Tenant:** for Guest, Customer and Merchant, resolved server-side from the tenant code in the URL path, then validated: the tenant must exist and be active, and a Merchant must hold a membership for it (6.7). For Super Admin, taken from an explicit tenant parameter on admin operations only, validated server-side (tenant exists, caller re-checked as Super Admin in the database) and audit-logged (6.6, 6.7). The JWT (signed with the server secret, expiry and signature checked) supplies identity and role only. On non-admin routes, body, query and header values named `tenant_id` are ignored; DTO validation rejects unknown fields.

2. **Role:** read from the verified JWT, restricted to the fixed set `GUEST`, `CUSTOMER`, `MERCHANT` (and `SUPER_ADMIN` for the separate admin connection). `GUEST` is assigned by the server to unauthenticated requests on public endpoints; a client cannot choose it. For Merchant endpoints the application additionally checks the `memberships` table, so a forged or stale role claim does not pass the application layer, and the RLS layer still limits the session to the validated tenant.

3. **Validation at the runner boundary:** the transaction runner accepts a typed `TenantContext` (tenant id as a UUID, role as the enum above). Anything else fails before any query runs.

4. **Set inside the transaction, locally:** Prisma with the Supabase pooler uses transaction pooling, so session-level settings are not safe (the next query may run on another connection). The context is set inside the transaction with the “local” flag, so it disappears at commit:

```
request -> JwtAuthGuard (verify token) -> TenantGuard / RolesGuard -> TenantContext
        -> runner.run(ctx, async (tx) => {
             await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true)`;
             await tx.$executeRaw`SELECT set_config('app.role', ${ctx.role}, true)`;
             await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId}, true)`;
             ... repository queries use tx ...
           })
```

Every request that touches tenant data runs through this runner, so context and queries always share one connection and one transaction. The runtime connection string uses the pooler with `pgbouncer=true` (Prisma’s documented setting for transaction mode); migrations use the direct connection.

### 6.4 Testing RLS: every policy, every role, every operation

Database-level tests connect as `multistore_app` (and `multistore_admin` where relevant) against real Postgres with RLS on, and assert a **policy matrix** per tenant table:

| **Role** | **SELECT own tenant** | **SELECT other tenant** | **SELECT draft (products)** | **INSERT/UPDATE/DELETE own tenant** | **INSERT/UPDATE/DELETE other tenant** |
|---|---|---|---|---|---|
| GUEST | published rows only | denied (zero rows) | denied | denied | denied |
| CUSTOMER | published rows only | denied (zero rows) | denied | denied | denied |
| MERCHANT | all rows | denied (zero rows) | allowed | allowed | denied |
| SUPER ADMIN (`multistore_admin`) | all rows, all tenants | allowed | allowed | allowed | allowed |
| no context set | zero rows | zero rows | zero rows | denied | denied |

**Each cell is a test.** For every tenant table, every role above runs SELECT, INSERT, UPDATE and DELETE and gets the asserted result. A new policy or table extends the matrix.

**A migration lint** checks every table that has `tenant_id` also has RLS enabled and forced, and that every policy on it contains an `app.role` check (for `multistore_app` policies), so the v2 mistake cannot come back.

**The API isolation suite (section 8.3)** runs with RLS on. A second run with the application filter deliberately removed proves RLS alone blocks the leak.

**RLS security validation checklist (expanded in v4.1; Super Admin negative tests added in v4.6).** Each line is an automated test that runs in CI against a real PostgreSQL with RLS on. All must pass before any feature is built on top (the RLS spike, 6.5, is where they are first run).

| **Area** | **Test** |
|---|---|
| **Database grants** | `multistore_app` has only SELECT, INSERT, UPDATE, DELETE on the tables it needs and no DDL, no TRUNCATE, no REFERENCES, no CREATE on schema `public`. Grants snapshot equals the reviewed file. |
|  | `multistore_app` cannot read the `multistore_admin` credential, other roles’ tables outside the list, or Supabase internal schemas. |
|  | `PUBLIC` has no privileges on any application table (`REVOKE ALL ... FROM PUBLIC` verified). |
|  | Default privileges: a newly created table is not readable by `multistore_app` until a migration grants it. |
| **Role separation** | `rolsuper = false` and `rolbypassrls = false` for `multistore_owner` (at runtime), `multistore_app` and `multistore_admin`. |
|  | `multistore_app` cannot `SET ROLE` to `multistore_admin` or `multistore_owner`. |
|  | `multistore_admin` cannot disable RLS, drop policies, or alter tables. |
|  | The runtime API connection string logs in as `multistore_app`, never `postgres` or the owner (checked at startup and in a test). |
|  | Every tenant table has RLS enabled **and forced**; migration lint fails otherwise. |
| **Super Admin connection isolation (new in v4.6)** | `multistore_app` cannot access `ADMIN_DATABASE_URL`: a configuration-boundary test asserts the ordinary runtime configuration exposes no admin connection string, a startup test asserts the application datasource connects as `multistore_app`, and a module scan asserts no non-admin module references `ADMIN_DATABASE_URL`. |
|  | `multistore_app` cannot import, instantiate or invoke `AdminPrismaService` or the Admin database connection: the import-boundary lint and the module-boundary test reject any use of `AdminModule` internals outside `admin/` (6.6), and a runtime test asserts the ordinary module graph never receives an `AdminPrismaService` instance. |
|  | No ordinary API request can reach the Super Admin database connection through any runtime code path: a test suite drives representative Guest, Customer and Merchant requests (including error paths) with instrumentation that fails the test if the admin connection is touched. `multistore_admin` cannot acquire ownership of application tables, schemas or database objects: `ALTER ... OWNER TO multistore_admin` and `REASSIGN OWNED` attempts issued as `multistore_admin` fail, and a catalog test asserts `multistore_admin` owns zero objects in every application schema. `multistore_admin` cannot gain membership in `multistore_owner` or any privileged role: `GRANT multistore_owner TO multistore_admin` issued as `multistore_admin` fails, and a role-membership snapshot test asserts no membership path from `multistore_admin` to any privileged role. Privilege-bypass attempts fail closed: `SET ROLE`, `SET SESSION AUTHORIZATION`, direct DDL, grant, ownership and policy changes issued as `multistore_admin` and as `multistore_app` are each executed in automated negative security tests and must all fail with a privilege error. |
| **Transaction-local context** | After a transaction commits or rolls back, `current_setting('app.tenant_id', true)` is empty on that connection. Two requests for different tenants interleaved on a pool of **one** connection never see each other’s rows (the pooler reuse case). A request that throws midway leaves no context for the next request on the same connection. `set_config` is called with the local flag `true` only; a lint rule rejects `SET`, `SET SESSION` and `set_config(..., false)`. |
| **Tenant switching** | One Customer token calling tenant A then tenant B then A returns each store’s own data and nothing from the other (6.7). Same token, tenant code of a suspended store: 404, zero rows. A Merchant of store A calling store B’s path: 404 from the application, and zero rows if the application check is deliberately bypassed. A body, query or header tenant value pointing at another tenant changes nothing. |
| **Missing or invalid context** | No `app.tenant_id` (unset or an empty string left by an earlier transaction on a reused pooled connection): zero rows on SELECT, error on writes. No `app.role`, an empty role, or an unknown role value: zero rows. `app.tenant_id` set to a non-UUID string: the request fails closed (error, not data); the typed `TenantContext` also rejects it before the query. A Customer context without `app.user_id`: zero rows on personal tables. `GUEST` role never sees drafts, even with the Merchant policies present. |
| | A reused pooled connection that earlier ran `set_config(..., true)` and now has no context returns zero rows (not an error) for Guest, Customer and Merchant queries, including the `/health/ready` canary query (10.7). A migration lint rejects any policy that casts `current_setting('app.tenant_id', ...)` or `current_setting('app.user_id', ...)` to uuid without `NULLIF(..., '')`. |
| **Write safety** | `WITH CHECK` blocks a Merchant inserting or moving a row to another tenant (`UPDATE` `... SET tenant_id = other`). |
| **Policy hygiene** | Every `multistore_app` policy contains an `app.role` check (migration lint). Every `multistore_admin` policy is listed and reviewed. |

### 6.5 Risk and plan

RLS with Prisma and the Supabase pooler is the part most likely to need adjustment. **After your final approval, the first step is the RLS technical spike** (throwaway code, not feature code) to confirm: transaction-local `set_config` works through the pooler, the roles behave as described, and the policy matrix in 6.4 passes as written. If it does not, the application layer plus the isolation suite remain the protection, the policies are adjusted, and you are told what changed before feature work continues. This is a stated risk, not a verified result.

### 6.6 multistore_admin: exact privileges and how ordinary requests cannot reach it (new in v4.1)

**Role definition (created by the migration owner, documented here so it can be reviewed before any code exists):**

```
CREATE ROLE multistore_admin LOGIN
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT
  CONNECTION LIMIT 3 PASSWORD '<from secret store>';
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM multistore_admin;
-- then only what Super Admin operations need (section 19), table by table:
GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, memberships, products, ... TO multistore_admin;
-- never: CREATE on schema, ownership of any object, membership in multistore_owner or multistore_app
```

| **Property** | **Required value** | **How it is confirmed** |
|---|---|---|
| Superuser | **No** (`rolsuper = false`) | `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles` `WHERE rolname LIKE 'multistore_%'` in a CI test, must return false and false for all three roles |
| BYPASSRLS | **No** (`rolbypassrls = false`). RLS applies to this role too; its `admin_all` policies grant access explicitly (6.2), so access is a visible policy, not a bypass | Same query, plus a test that removing the `admin_all` policy makes the role see zero rows |
| Object ownership / DDL | None. It cannot create, alter or drop tables, and cannot disable RLS or FORCE RLS (only the owner can) | Test: `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` as `multistore_admin` must fail |
| Role membership | Not a member of `multistore_owner` or `multistore_app`, and `multistore_app` is not a member of `multistore_admin`, so `SET ROLE multistore_admin` is impossible from an app session | Test: `SET ROLE multistore_admin` as `multistore_app` must fail |
| Grants | Explicit per-table DML list only, reviewed in the migration. No grant on Supabase internal schemas (`auth`, `storage`, …) | Grants snapshot test compares `information_schema.role_table_grants` with an expected file |
| Supabase default roles | `anon`, `authenticated` and `service_role` (Supabase default roles) have no privileges on any application table, sequence or function; the migrations revoke them explicitly and a grants-snapshot test fails if any appears (v4.9, security note for IP-4) | Test: `information_schema.role_table_grants` for those three roles returns no application tables |
| Connections | At most 3 | Role connection limit |

Note on Supabase: it does not let you create superusers, and whether it allows the exact `NOBYPASSRLS` syntax for custom roles is confirmed in the RLS spike (6.5). This is **mandatory validation gate 1**: a stated item to verify before feature work, not a verified result.

**Credential separation (made explicit in v4.6).** Three database credentials exist. Each serves exactly one purpose, and no credential is reused across roles:

| **Credential** | **Database role** | **Used by** | **Never used by** |
|---|---|---|---|
| Runtime application credential (`DATABASE_URL`) | `multistore_app` | The ordinary API runtime only: every Guest, Customer and Merchant request, through `PrismaService` and `TenantTransactionRunner` | Admin operations, migrations |
| Super Admin runtime credential (`ADMIN_DATABASE_URL`) | `multistore_admin` | `AdminPrismaService` only, declared inside `AdminModule` and reachable only from `/admin/*` routes behind `JwtAuthGuard` and `SuperAdminGuard` | Ordinary requests, migrations |
| Migration credential | `multistore_owner` | Migration and deployment processes only: the CI migration job and reviewed manual migration steps | Any runtime request path, ordinary or admin |

**Tests (v4.6).** The ordinary API runtime cannot read `ADMIN_DATABASE_URL` (configuration-boundary test and module scan). `AdminPrismaService` is accessible only within `AdminModule` (import-boundary lint plus a module-boundary test). As `multistore_admin`, each of the following is executed in an automated negative test and must fail: ALTER or DROP of RLS policies; disabling RLS or FORCE ROW LEVEL SECURITY; ALTER or DROP of tables or schemas; acquiring ownership of any object. The runtime application role cannot `SET ROLE` to `multistore_admin` or `multistore_owner` (negative tests against both targets). The full negative-test list runs in CI against a real PostgreSQL with RLS on and is part of the 6.4 checklist.

**How an ordinary API request cannot use this role:**

1. **Separate credential, separate client.** The admin connection string (`ADMIN_DATABASE_URL`) is read only by one provider, `AdminPrismaService`, declared inside `AdminModule`. No other module can import it (import-boundary lint plus a module-boundary test). The ordinary `TenantTransactionRunner` has no code path that accepts the admin connection.

2. **Route gating.** Only `/admin/*` controllers inject the admin runner. They sit behind `JwtAuthGuard` and a `SuperAdminGuard` that requires role `SUPER_ADMIN` in the verified token and re-checks the `users` table (flag `is_super_admin = true`, account `ACTIVE`) on every request, so a stale token does not work.

3. **No client-selectable role.** The role is never read from a body, header or query. A `SUPER_ADMIN` token can only be issued by the login flow to a user whose database flag is set; the flag can only be set by a migration or a reviewed manual step, never by an API endpoint.

4. **Reviewed, audited use.** Every admin operation writes an audit row (who, what, which tenant, when). Admin code paths are listed in CODEOWNERS for mandatory review.

5. **Honest limit.** On Render Free there is one API process, so both connection strings live in one process’s environment. A bug that executes arbitrary code in the API would expose both. The protections above stop *ordinary request handling* from reaching the role; they do not defend against full process compromise. Splitting the admin API into its own service is the later fix (it does not fit the 750 free hours with a second always-on service, see 10.6), and the design keeps that split possible because the admin module has no shared state.

### 6.7 Customer browsing across several stores (introduced in v4.1, approved as the design in v4.2)

**The problem.** A Customer is one signed-in person who can shop in many stores. Earlier sections said the tenant comes from the JWT. That is right for a Merchant whose work is one store, but it cannot work for a Customer if the token holds one tenant ID.

**Decision (approved in v4.2): identity comes from the token, the active store comes from the request path, and the server validates it every time.**

| **Item** | **Rule** |
|---|---|
| Customer token | Holds identity only: user id (`sub`), role `CUSTOMER`, expiry, session id. **No tenant ID.** A Customer account is a global identity (one row in `users`), not owned by a store. |
| Active store | Taken only from the **tenant code in the URL path** (for example `/t/:tenantCode/products`), the same mechanism Guests already use. Body, query and header tenant values are ignored (DTO validation rejects unknown fields). |
| Resolution | The `TenantResolverGuard` looks up the code server-side in `tenants`, requires status `ACTIVE` (not suspended or deleted), and builds `TenantContext { tenantId, role,` `userId }`. An unknown, malformed or suspended code returns 404 with no detail. Lookups are cached for a short time (60 seconds), and a suspension takes effect within that window. |
| Switching store | Stateless. The app calls a different path; there is no “current tenant” stored in the session or token, so there is nothing to forge or leave stale. Each request gets a fresh context and its own transaction. |
| Customer data per store | Customer-owned rows (favorites in Phase 1; carts and orders when introduced, section 20) carry `tenant_id` and `user_id`. Policies require both `tenant_id = NULLIF(app.tenant_id, '')::uuid` and `user_id = NULLIF(app.user_id, '')::uuid` (the `NULLIF` form of 6.2), where `app.user_id` comes from the verified token. A Customer sees only their own rows in the active store. Catalog rows are published rows of the active store only (6.2). |
| Merchant tokens | A Merchant may belong to several stores. The token holds identity only; the active store comes from the path and the `memberships` table must contain (user, tenant, role) for it, checked in the application and again by RLS context. No membership: 404, consistent with 8.3. |
| Super Admin | Different rule from the three roles above. Uses the separate role and connection (6.6). The tenant is an **explicit parameter** of the admin operation (admin routes only). The server validates that the tenant exists, re-checks the caller as Super Admin in the database, and writes an audit-log entry (actor, tenant, operation, time) for every call, including rejected ones. Operations that are not about one tenant take no tenant parameter. |

This replaces the v4 wording in 6.1 and 6.3 that read the tenant from the JWT; those sections are updated in this version to match. The RLS policies in 6.2 are unchanged, because they only read `app.tenant_id`, `app.role` and `app.user_id`, which the server sets after resolution.

**Summary of the two models (v4.4).** Guest, Customer and Merchant: the tenant is implicit in the URL path and validated on every request. Super Admin: the tenant is an explicit, validated, audit-logged parameter of an admin operation. The two never mix: a tenant parameter sent on a public or Merchant route is ignored and rejected by DTO validation, and a tenant code in a public URL never grants admin scope.

**Failure behavior.** A request with a valid Customer token and a tenant code the Customer has never visited is allowed for catalog reading (Customer policy, published rows) and returns empty lists for personal data. Nothing leaks between stores because every query runs in a transaction whose context was set from the validated path.

### 6.8 Secrets and logging: redaction requirements and tests (new in v4.6)

**Requirements.**

1. **No secrets in logs.** Database connection strings and passwords never appear in logs, in full or in any recognizable part. Google OAuth access and refresh tokens never appear in logs. This covers application logs, request logs, error logs, startup logs, health-check detail and audit rows.

2. **No secrets in error output.** Secrets are never exposed in API error responses, exception messages or stack traces, whether returned to a client or written to a log. An error response carries a safe message and the `requestId` only (5.4), never a stack trace or a config value.

3. **Redaction at the sink, not at the call site.** Sensitive configuration keys (`DATABASE_URL`, `ADMIN_DATABASE_URL`, the Google client secret, OAuth access and refresh tokens, the JWT secret, and anything matching a maintained secret-name list) are redacted by the logging path itself (`common/logging/`, section 5.2), so a careless `logger.log(config)` cannot leak. Database URLs are logged without credentials; sensitive config values are logged by name, never by value.

**Automated tests.** The tests run against the real logging pipeline and cover both successful and failed requests:

| **Area** | **Test** |
|---|---|
| Log redaction | A seeded secret value (a known test connection string and a known test OAuth token) is passed through code paths that log; every emitted log line is scanned and must not contain the value, in full or in any recognizable part. |
| Successful requests | Representative successful Guest, Customer, Merchant and Super Admin requests emit their normal logs; every emitted line is scanned for connection strings, passwords and OAuth tokens. |
| Failed requests | Forced failures (validation error, authentication failure, database unreachable, timeout, upstream Gmail failure) emit error logs and error responses; both are scanned for connection strings, passwords, OAuth tokens and config values. |
| Error responses | API error responses are asserted to contain no secret material and no stack trace: only the safe message and the `requestId`. |
| OAuth tokens | The Gmail adapter and the OAuth callback log accepted and rejected operations (9.1, 9.1.1); the emitted lines are scanned and must never contain access or refresh tokens. |

## 7. Images and storage (private by design)

**Rules you set**

1. Drive files stay private. No public sharing links, no “anyone with the link”.

2. Published product images are served **only through the Backend API**: `GET /api/v1/t/{tenantCode}/products/{id}/image?size=...`.

3. Draft images are served only to the owning Merchant of that tenant.

4. Drive URLs, file IDs for direct access, and credentials are **never** sent to Flutter. The API returns the API’s own image URL only. Flutter sends its normal auth header, if any.

5. Dedicated Google account for application media, separate from your personal account.

**How it works**

`media` module checks the caller’s role and tenant, then asks `StorageProvider.get(key)`. Drive file IDs stay inside the database and the adapter.

Uploads are resized and re-encoded with `sharp` (thumbnail plus display size). Originals are not kept unless needed. Responses carry cache headers so repeated views do not call Drive each time.

Drive access uses an OAuth refresh token of the dedicated account (separate from the Gmail refresh token, 9.1), scope `drive.file` only. The token lives in server environment variables, never in the app or the repository.

Because a refresh token for a Google OAuth app in “Testing” status can expire after 7 days, the consent screen must be moved to production (can stay unverified for a single-user, non-sensitive scope; to confirm during setup).

A contract test runs against every `StorageProvider`, so moving to Supabase Storage later is a config switch plus a one-time copy script.

## 8. Testing, quality gates and tooling

### 8.1 Test layers

| **Layer** | **Tool** | **What is tested** | **Runs** |
|---|---|---|---|
| Backend unit | Jest | Use cases and domain rules with fake repositories | every push |
| Backend integration | Jest + Supertest + real Postgres | HTTP to database, migrations, validation, error shape | every push |
| **RLS policy tests** | Jest + Postgres | The policy matrix in 6.4: every policy, every role, every CRUD operation | every push, **blocks merge** |
| **Isolation and authorization** | Jest + Supertest | Section 8.3 | every push, **blocks merge** |
| Storage / mail contract | Jest | Same suite for each provider | on change |
| Flutter unit | `flutter_test` | Use cases, mappers, notifiers | every push |
| Flutter widget | `flutter_test` | Each design system component in all states, AR RTL and EN LTR, key screens | every push |
| Flutter integration | `integration_test` | Guest browse, Customer sign-in + verification, Contact Store | before release |

### 8.2 Coverage: what “80% meaningful” means

**Target:** 80% line coverage on `domain/` and `application/` code in both projects, measured in CI. Below 80% on those layers fails CI. The report is uploaded as a CI artifact.

**Meaningful assertions, not executed lines.** Every test asserts behavior: exact outputs, state changes, or specific errors. A test with no assertion, or one that only checks “does not throw”, is rejected in review. Tests assert specific values, not just types or non-null.

**Business rules get explicit cases.** Every rule in the domain (publish rules, role checks, verification rules, pricing rules) has named test cases: one per accepted path and one per rejected path, including the boundary. Examples: publishing a product with no image fails with the specific error; a Merchant of tenant A updating tenant B’s product returns 404; an expired verification code fails even if correct.

**Critical paths are listed and tracked.** `docs/testing.md` keeps the list of critical paths (auth and verification, tenant isolation, product publishing, image access). Every entry must have a test naming it. Removing a critical-path test fails review, not just coverage.

**Not targeted by the number:** generated files, DTO classes, plain UI glue. These are covered by widget and integration tests instead of a percentage.

### 8.3 Cross-tenant isolation suite (mandatory)

Seed tenants A and B with users in each role, then assert, **for every tenant-owned resource (products, categories, product images, stores), across all** **CRUD operations:**

A Merchant of A cannot **create in, read, update, delete or list** resources of B (expect 404, not 403, to avoid leaking existence). Each operation is its own test.

A Guest and a Customer can **read published** resources of the tenant in the URL and **cannot create, update or delete anything**, and **cannot read drafts**. Sending `tenant_id` in a body, query or header never changes the tenant.

A Customer cannot call Merchant endpoints. A Merchant cannot call Super Admin endpoints.

A Guest never sees a suspended tenant.

Draft images are not retrievable by a Guest or another tenant. Published images are served only through the backend.

No response, anywhere, contains a Drive URL or file ID.

An unverified email account cannot log in. An expired, tampered or refresh-reused token is rejected.

A test enumerates all routes and fails if any route lacks a declared access policy.

### 8.4 CI (GitHub Actions)

`api.yml`: install, format check, lint, type check, unit, integration (Postgres service container), isolation and RLS tests, coverage gate.

`app.yml`: `flutter pub get`, `dart format --set-exit-if-changed`, `flutter analyze` (warnings fail), tests, coverage gate.

Branch protection: merge only when both relevant workflows pass. Quota note in section 10.5.

### 8.5 Linting and formatting

**Backend:** ESLint (typescript-eslint strict), Prettier, `strict: true` and `noUncheckedIndexedAccess`. Husky pre-commit on changed files.

**Flutter:** `flutter_lints` plus stricter rules (`prefer_const_constructors`, `always_use_package_imports`, `avoid_print`, `require_trailing_commas`) and `riverpod_lint`. `dart format` enforced.

### 8.6 Security Threat Model & Security Testing Checklist (new in v4.7)

**Test status, used everywhere in this document (revised in v4.8).** A control or a test is described with one or more of these. They are separate facts and each needs its own evidence:

1. **Requirement documented:** the rule is written in this document (a control-level state).
2. **Specified:** the automated test is described: what it does and what it asserts.
3. **Implemented:** the test code exists in the repository.
4. **Executed:** the test has run against real infrastructure and its result was recorded, whether it passed or failed.
5. **Passed:** the test was executed, every assertion held, and the evidence is recorded: commit, run identifier or report file, environment, date.

A test that ran and failed is Executed and not Passed. A test with no recorded evidence is not Executed and not Passed. Nothing is inferred from silence, from a green badge without a record, or from the existence of code. In v4.7 "state 3" meant Implemented and "state 4" meant Executed and Passed together; v4.8 splits state 4 so that Executed and Passed can never be confused.

In this version every control below is at Requirement documented and every test is at Specified only. Nothing in this section is Implemented, Executed or Passed, because no code exists yet (section 16). The full register is in section 23. A claim of Implemented, Executed or Passed is made only with evidence.

Each risk below records: name and description; a realistic MultiStore attack scenario; affected modules and endpoints; impact; prevention and mitigation; server-side authorization requirements; positive and negative automated tests; severity; status; OWASP category.

**8.6.1 Risk 1: IDOR / BOLA (Broken Object Level Authorization)**

**Description:** an attacker references an object by its id and the server returns or changes it without verifying that the caller owns it and that it belongs to the caller’s tenant.

**Attack scenario:** a Merchant of store A copies a product UUID from their own catalog traffic, then swaps in a guessed or observed UUID of store B’s product in `PUT /api/v1/t/{storeB}/products/{id}`; a Customer enumerates order or favorite UUIDs; a Guest replays a media URL with another product’s id. **Affected modules/endpoints:** catalog (products, categories), media (product images), stores, Customer-owned resources (favorites, carts, orders), any export or analytics endpoint.

**Impact:** cross-tenant or cross-user read, modification or deletion of data; total tenant data compromise at object level.

**Prevention / mitigation:** ownership and tenant checks on every object access at the application layer (6.1) and again by RLS (6.2); 404 instead of 403 so existence is not leaked (8.3); UUIDs are treated as identifiers, never as a secrecy control (5.6).

**Server-side authorization requirements:** every repository query runs through the `TenantContext` runner (6.3); personal rows additionally require `user_id =` `app.user_id`; Super Admin object access only through the admin connection with audit logging (6.6).

**Automated tests (specified, not implemented):** Positive: an owner reads, updates and deletes their own object in their own tenant. Negative: cross-tenant and cross-user read, create-in, update, delete and export attempts each return 404 and leave the database unchanged (asserted by reading the row afterwards); a valid UUID of another tenant’s object never resolves.

**Severity:** Critical.

**Status:** Requirement documented; tests specified. Not implemented, not executed, not passed.

**OWASP:** API1:2023 Broken Object Level Authorization.

**8.6.2 Risk 2: Tenant isolation bypass**

**Description:** a request escapes its tenant scope through a missing filter, a trusting code path, a cache, a background job or an error path.

**Attack scenario:** a request sends a different `tenant_id` in body, query or header; a search, pagination or aggregation endpoint forgets the tenant filter; a background job or the email outbox reads rows without tenant context; an error handler falls back to an unscoped query.

**Affected modules/endpoints:** every tenant-owned resource; search and list endpoints; aggregation/analytics; background jobs and the email outbox worker; error paths.

**Impact:** one tenant’s data visible or writable by another tenant; the core promise of the product broken.

**Prevention / mitigation:** centralized scoping through `TenantContext` and the tenant-scoped transaction runner (6.1, 6.3); RLS as defense in depth (6.2); Guests and Customers reach published data only; Merchants reach only tenants where `memberships` authorizes them; no unscoped fallback on database failure, the request fails closed with 503 (10.7).

**Server-side authorization requirements:** tenant comes only from server-verified sources (6.3); body, query and header tenant values are ignored and rejected by DTO validation; every query runs in a transaction with validated context.

**Automated tests (specified, not implemented):** Positive: each actor reads and writes within its own tenant. Negative: the full matrix in 6.4 and 8.3 across CRUD, search, pagination, aggregation, background jobs and error paths; a second run of the isolation suite with the application filter deliberately removed proves RLS alone blocks the leak.

**Severity:** Critical.

**Status:** Requirement documented; tests specified. Not implemented, not executed, not passed.

**OWASP:** API1:2023 Broken Object Level Authorization / A01:2021 Broken Access Control.

**8.6.3 Risk 3: Broken authentication / JWT**

**Description:** forged, expired, replayed or revoked tokens are accepted, or token lifecycle rules are weak.

**Attack scenario:** a forged JWT with `alg=none` or a wrong algorithm claim; a replayed expired access token; a stolen refresh token reused after rotation; a session that stays valid after the password changes; a token leaked through a URL or a log line.

**Affected modules/endpoints:** auth module (login, refresh, verification, reset); every authenticated endpoint.

**Impact:** full account takeover, including of privileged accounts.

**Prevention / mitigation:** validate signature, pinned algorithm, issuer, audience, expiry and required claims on every request; reject expired, malformed and revoked tokens; rotating refresh tokens where reuse of an old token revokes the session (section 9); all sessions invalidated on password change; email verification required before first login; verification and reset codes single-use, stored hashed, expiring in 10 minutes with attempt limits (section 9); tokens never in logs (6.8) and never in URLs.

**Server-side authorization requirements:** `JwtAuthGuard` on every non-public route; role re-checked against the database for Merchant (6.1) and Super Admin (6.6) operations; `GUEST` assigned server-side only.

**Automated tests (specified, not implemented):** Positive: a valid token accesses an allowed endpoint; refresh rotation issues a working pair. Negative: expired, tampered (signature, claims, algorithm confusion, wrong issuer or audience), revoked and replayed tokens are rejected with 401; refresh-token reuse revokes the session; after a password change the old tokens fail; verification and reset codes cannot be replayed, brute-forced beyond 5 attempts or used after expiry.

**Severity:** Critical.

**Status:** Requirement documented; tests specified. Not implemented, not executed, not passed.

**OWASP:** API2:2023 Broken Authentication / A07:2021 Identification and Authentication Failures.

**8.6.4 Risk 4: Function-level authorization / privilege escalation**

**Description:** a caller reaches functions above their role, or raises their own role.

**Attack scenario:** a Customer calls a Merchant endpoint or `/admin/*`; a Merchant sets `role=SUPER_ADMIN` by adding a field to a registration or profile request (mass assignment); a token with a forged `SUPER_ADMIN` claim is presented to admin routes.

**Affected modules/endpoints:** admin module, auth/registration, users/profile, every role-gated endpoint.

**Impact:** tenant takeover, platform takeover.

**Prevention / mitigation:** server-side RBAC through `RolesGuard` reading the verified JWT, cross-checked against `memberships` for Merchant endpoints (6.1); role assignment is never accepted from request data: DTO whitelist rejects unknown fields (5.4) and the `is_super_admin` flag can be set only by a migration or a reviewed manual step (6.6); Super Admin protection is server-side and independent of anything a frontend hides (6.6, 6.7).

**Server-side authorization requirements:** privileged functions require the verified role plus a database re-check; every role’s permissions are enumerated per endpoint; a route inventory test fails if any route lacks a declared access policy (8.3).

**Automated tests (specified, not implemented):** Positive: each role reaches its own allowed endpoints. Negative: every role is run against every privileged endpoint, including endpoints the app never links to; mass-assignment attempts (`role=SUPER_ADMIN`, `is_super_admin=true`, `tenant_id` overrides) are rejected and leave the database unchanged; a forged role claim fails the database re-check.

**Severity:** Critical.

**Status:** Requirement documented; tests specified. Not implemented, not executed, not passed.

**OWASP:** API5:2023 Broken Function Level Authorization / A01:2021 Broken Access Control.

**8.6.5 Risk 5: SQL injection**

**Description:** attacker-controlled input reaches a SQL query as code.

**Attack scenario:** crafted strings in catalog search, filters, sort fields, pagination cursors or route parameters targeting a raw query or an unsafe ordering clause.

**Affected modules/endpoints:** catalog search and list endpoints, any endpoint with sort/filter/pagination, any use of `$queryRaw`.

**Impact:** data extraction across tenants, bypass of RLS context, data modification.

**Prevention / mitigation:** Prisma parameterizes all queries by default; any raw SQL must use Prisma’s tagged templates (`Prisma.sql`), never string concatenation, and every raw query is listed and reviewed; sort, filter, search and pagination inputs are validated against allowlists of field names and shapes; RLS remains as the second layer (6.2).

**Server-side authorization requirements:** even a successful injection must still land inside the transaction’s tenant context, so RLS limits the blast radius; raw SQL is forbidden from resetting `app.tenant_id` or `app.role` (the 6.4 lint rejects non-local `set_config`).

**Automated tests (specified, not implemented):** Positive: legitimate search, filter, sort and pagination inputs work. Negative: injection payloads in every search, filter, sort, pagination and id field return validation errors or safe empty results, and a migration lint fails on string-concatenated SQL. **Severity:** High.

**Status:** Requirement documented; tests specified. Not implemented, not executed, not passed.

**OWASP:** A03:2021 Injection / API8:2023 Security Misconfiguration.

**8.6.6 Risk 6: Stored and reflected XSS**

**Description:** attacker-controlled content is rendered as script or active markup in another user’s app or browser.

**Attack scenario:** a Merchant (or a compromised Merchant account) saves a product name, description, category name or branding field containing script or a `javascript:` URL; another user viewing the catalog or a future web surface executes it.

**Affected modules/endpoints:** catalog (names, descriptions), branding (colors, logo, URLs), stores, any rendered text field.

**Impact:** session theft, defacement, actions as the victim within a store.

**Prevention / mitigation:** Phase 1 stores and returns plain text only; output encoding at every render surface; if rich HTML is ever allowed it is sanitized server-side against an allowlist first (an unresolved decision, section 8.7); Content Security Policy on any future browser surface; URL fields accept only validated `https:` schemes.

**Server-side authorization requirements:** content is sanitized or encoded regardless of the author’s role; being a Merchant does not make one’s content trusted for rendering.

**Automated tests (specified, not implemented):** Positive: normal Unicode content, including Arabic, round-trips unchanged. Negative: stored payloads come back inert and encoded; reflected payloads are rejected or encoded; `javascript:` and other non-https URL schemes are rejected at validation. **Severity:** High.

**Status:** Requirement documented; tests specified. Not implemented, not executed, not passed.

**OWASP:** A03:2021 Injection.

**8.6.7 Risk 7: Rate limiting and brute force**

**Description:** unlimited attempts let attackers guess credentials or codes, or exhaust quotas.

**Attack scenario:** credential stuffing against login; guessing the 6-digit verification or reset code; scripted store discovery through QR or search; hammering registration, resend or admin endpoints to burn the 500/day Gmail quota or the free hosting hours.

**Affected modules/endpoints:** login, registration, email verification, resend, password reset, QR/store discovery, search, admin endpoints.

**Impact:** account takeover, email quota exhaustion, service unavailability, cost-free denial of service against the free tier.

**Prevention / mitigation:** `@nestjs/throttler` with per-IP and account-aware limits; resend cooldown (60 seconds) and daily cap per address; codes limited to 5 attempts (section 9); progressive cooldown instead of permanent lockout, so an attacker cannot lock a victim out of their own account.

**Server-side authorization requirements:** throttling applies before expensive work (before hashing, before sending email); limits are enforced server-side only.

**Automated tests (specified, not implemented):** Positive: normal use below thresholds is unaffected. Negative: crossing a threshold returns 429 with `Retry-` `After`; per-IP and per-account limits both trigger; repeated attempts do not produce a permanent lockout; resend and daily caps hold.

**Severity:** High.

**Status:** Requirement documented; tests specified. Not implemented, not executed, not passed.

**OWASP:** API4:2023 Unrestricted Resource Consumption.

**8.6.8 Risk 8: Account enumeration**

**Description:** responses reveal whether an email address is registered.

**Attack scenario:** comparing error messages or timing on login, registration and password reset between a registered and an unregistered address. **Affected modules/endpoints:** login, registration, password reset, resend.

**Impact:** target list for phishing and credential stuffing; privacy leak.

**Prevention / mitigation:** identical generic responses for registered and unregistered addresses on login, reset and resend; registration returns the same message whether or not the address exists (the verification flow resolves duplicates); response timing normalized so no measurable difference remains. **Server-side authorization requirements:** no endpoint confirms account existence to an unauthenticated caller.

**Automated tests (specified, not implemented):** Positive: a real user can still complete registration, login and reset. Negative: response bodies for registered and unregistered addresses are byte-identical, and response times fall inside a defined window, for login, registration, reset and resend. **Severity:** Medium.

**Status:** Requirement documented; tests specified. Not implemented, not executed, not passed.

**OWASP:** API2:2023 Broken Authentication / A07:2021 Identification and Authentication Failures.

**8.6.9 Risk 9: Insecure file upload**

**Description:** malicious or oversized uploads, or media served without authorization.

**Attack scenario:** an executable or HTML file renamed as an image; an image with an embedded payload; a multi-gigabyte upload to exhaust the 512 MB instance; a crafted filename for collision or traversal; direct access to another tenant’s media or to draft media.

**Affected modules/endpoints:** media upload endpoints, image serving endpoint (section 7), Drive storage adapter.

**Impact:** stored XSS, server compromise, memory exhaustion, cross-tenant media exposure.

**Prevention / mitigation:** real content validation: `sharp` decodes and re-encodes every upload, which rejects non-images and strips payloads (section 7); type, size and dimension limits with processing caps (resize jobs small and sequential, 10.6); safe server-side object names (UUID keys, never client filenames); malformed files rejected; serving checks role, tenant and publish status (section 7); Drive file IDs are never authorization (8.7 area D).

**Server-side authorization requirements:** upload requires Merchant role with membership for the tenant; draft media is served only to the owning Merchant; published media only through the API image endpoint.

**Automated tests (specified, not implemented):** Positive: a valid image within limits is accepted, resized and served. Negative: disguised, malformed, oversized and over-dimension files are rejected; a cross-tenant or Guest request for draft media returns 404; no response contains a Drive URL or file ID (8.3). **Severity:** High.

**Status:** Requirement documented; tests specified. Not implemented, not executed, not passed.

**OWASP:** API4:2023 Unrestricted Resource Consumption / A05:2021 Security Misconfiguration.

**8.6.10 Risk 10: CSRF**

**Description:** a browser is tricked into sending a user’s authenticated request.

**Architectural determination (explicit, not assumed unnecessary):** the API authenticates with a bearer token in the `Authorization` header, stored in `flutter_secure_storage`; **no authentication cookie is set by any response**. Browsers do not attach bearer tokens automatically, so classic CSRF does not apply to the Phase 1 API. This is a design decision to verify, not an assumption.

**Attack scenario (latent):** if a browser-based surface with cookie auth is added later, cross-site form posts or image loads could ride the cookie. **Affected modules/endpoints:** none in Phase 1; any future cookie-authenticated browser surface.

**Impact (if cookies are ever introduced):** unwanted state-changing actions as the victim.

**Prevention / mitigation:** bearer-token auth only; if cookies are ever introduced, first add `SameSite=Strict` (or `Lax` where flows require), `Secure`, `HttpOnly` cookies, anti-CSRF tokens and `Origin`/`Referer` verification, and document it here before implementation.

**Server-side authorization requirements:** the server must never accept an authentication cookie in Phase 1.

**Automated tests (specified, not implemented):** Positive: API clients authenticate with the Authorization header. Negative: no response sets an authentication cookie (`Set-Cookie` scan); a request carrying credentials only in a cookie is rejected.

**Severity:** Medium.

**Status:** Requirement documented (architectural decision); tests specified. Not implemented, not executed, not passed.

**OWASP:** A01:2021 Broken Access Control.

**8.6.11 Risk 11: CORS misconfiguration**

**Description:** a permissive cross-origin policy lets a malicious site call the API with a user’s browser.

**Attack scenario:** an API answering any `Origin` with `Access-Control-Allow-Origin: *` together with credentials, or reflecting arbitrary origins, enabling browser-based data theft from any future web surface.

**Affected modules/endpoints:** the whole API surface, as seen from browsers.

**Impact:** cross-origin reading of API responses from a victim’s browser.

**Prevention / mitigation:** an explicit origin allowlist in configuration; no wildcard origin when credentials are allowed; restricted methods and headers; separate dev and production allowlists (production list contains only the real frontends); Flutter mobile clients do not rely on CORS, so the allowlist can be small.

**Server-side authorization requirements:** CORS is not an authorization layer; every endpoint still enforces its own authentication and authorization. **Automated tests (specified, not implemented):** Positive: an allowlisted origin receives the correct CORS headers. Negative: a disallowed origin receives no CORS headers; preflight for unlisted methods or headers fails; `Access-Control-Allow-Origin` is never `*` on responses that allow credentials; dev and prod configs differ as documented.

**Severity:** Medium.

**Status:** Requirement documented; tests specified. Not implemented, not executed, not passed.

**OWASP:** A05:2021 Security Misconfiguration.

**8.6.12 Risk 12: Cache tenant leakage**

**Description:** cached data for one tenant or user is served to another.

**Attack scenario:** a cache key that omits the tenant serves store A’s product list to store B’s visitors; a draft cached before unpublish keeps being served; a shared public cache holds personalized or draft data; a permission change takes effect only after a long cache expiry.

**Affected modules/endpoints:** image responses with cache headers (section 7), the 60-second tenant-resolution cache (6.7), any response caching added later, any shared HTTP cache.

**Impact:** cross-tenant data exposure; unpublished or suspended content staying visible.

**Prevention / mitigation:** cache keys always include the tenant id and the authorization context; private, draft and personalized data never enters shared public caches; invalidation on publish, unpublish and permission change; the tenant-resolution cache is capped at 60 seconds and a suspension takes effect within that window (6.7).

**Server-side authorization requirements:** cache reads are authorization decisions too: the same role, tenant and publish-state checks apply before serving cached content.

**Automated tests (specified, not implemented):** Positive: repeated views within a tenant hit the cache correctly. Negative: cross-tenant cache reads return the second tenant’s own data or nothing; unpublish and permission changes invalidate promptly; drafts never appear in shared caches.

**Severity:** High.

**Status:** Requirement documented; tests specified. Not implemented, not executed, not passed.

**OWASP:** API1:2023 Broken Object Level Authorization / A05:2021 Security Misconfiguration.

**8.6.13 Risk 13: SSRF (Server-Side Request Forgery)**

**Description:** the server is made to fetch an attacker-chosen URL.

**Inventory (explicit):** the only server-side URL fetches in this design are calls to fixed provider endpoints: the Drive API, the Gmail API and Google OAuth endpoints, all made through the `googleapis` client with configured hosts. **No endpoint accepts an arbitrary URL, and no server-side fetch of user-** **supplied URLs exists in Phase 1.** This is recorded as an explicit architectural restriction, not an assumption.

**Attack scenario (latent):** if a future feature fetches user-supplied URLs (link previews, remote images, webhooks), it could reach `localhost`, internal network ranges or the cloud metadata endpoint (`169.254.169.254`).

**Affected modules/endpoints:** none in Phase 1; any future server-side fetch.

**Impact (if ever introduced):** internal network access, credential theft from metadata endpoints.

**Prevention / mitigation:** prefer provider APIs over arbitrary fetches; before any future server-side URL fetch is added, restrict schemes to `https:`, allowlist destinations, disable or verify redirects, pin DNS resolution and block localhost, private ranges and cloud metadata addresses.

**Server-side authorization requirements:** outbound calls use least-privilege credentials (6.6, 8.7 area F).

**Automated tests (specified, not implemented):** Positive: provider calls reach their configured endpoints. Negative: a route and code scan asserts no endpoint accepts an arbitrary URL; any future fetch rejects internal and metadata destinations.

**Severity:** Medium.

**Status:** Requirement documented (architectural restriction); tests specified. Not implemented, not executed, not passed.

**OWASP:** A10:2021 Server-Side Request Forgery / API7:2023 Server Side Request Forgery.

**8.6.14 Risk 14: Race conditions and duplicate operations**

**Description:** concurrent or repeated requests create inconsistent state or duplicates.

**Attack scenario:** double-submitting product publish; two concurrent media processing runs on the same upload; two simultaneous verification-code validations; reusing a password-reset token twice; the outbox worker sending after a restart while a retried send also proceeds.

**Affected modules/endpoints:** catalog publishing, media processing, email verification, password reset, the email outbox worker (10.7).

**Impact:** duplicate charges of quota, inconsistent publish state, account takeover through token reuse, duplicate emails.

**Prevention / mitigation:** every write inside one transaction (10.7); database unique constraints as the final guard; idempotency keys on creating POSTs with 24-hour server-side storage (10.7); single-use one-time tokens for verification and reset; the outbox lease mechanism (`SENDING` with lease timestamp) so a worker restart cannot lose a message and an occasional duplicate code email is harmless because only the latest code is valid.

**Server-side authorization requirements:** idempotency records and one-time tokens are scoped to the authenticated caller and tenant.

**Automated tests (specified, not implemented):** Positive: single publish, upload, verification and reset complete once. Negative: concurrent double-submit creates exactly one record; a repeated POST with the same `Idempotency-Key` returns the first result and creates nothing twice; a one-time token cannot be used twice; a simulated worker restart resumes the outbox without losing messages; concurrent verification attempts do not both succeed.

**Severity:** High.

**Status:** Requirement documented; tests specified. Not implemented, not executed, not passed.

**OWASP:** A04:2021 Insecure Design / API4:2023 Unrestricted Resource Consumption.

**8.6.15 Risk 15: Information leakage**

**Description:** responses, logs or errors reveal secrets, internals or data the caller should not see.

**Attack scenario:** an API error returning a stack trace, a SQL fragment or a filesystem path; a log line containing a connection string, password or OAuth token; a 403 telling an attacker that a hidden resource exists; a response embedding a Drive URL or file ID.

**Affected modules/endpoints:** global exception filter and every endpoint (5.4); the logging pipeline (`common/logging/`); health endpoints; image endpoints. **Impact:** credential theft, reconnaissance for further attacks, privacy breach.

**Prevention / mitigation:** section 6.8 is preserved and strengthened here: nothing sensitive in logs; redaction at the logging sink, not at call sites; error responses carry only a safe message, a machine-readable code and the `requestId`, never a stack trace, SQL or paths (5.4); 404 instead of 403 to hide existence (8.3); no Drive URLs or file IDs in any response (8.3).

**Server-side authorization requirements:** error and log content is independent of the caller’s role; even Super Admin error responses carry no secrets. **Automated tests (specified, not implemented):** Positive: normal errors return the standard shape with a safe message and `requestId`. Negative: forced failures (validation error, auth failure, database unreachable, timeout, upstream Gmail failure) are asserted to contain no stack trace, SQL, paths, connection strings, passwords, tokens or config values, in both the response and every emitted log line, covering successful and failed requests (6.8).

**Severity:** High.

**Status:** Requirement documented; tests specified. Not implemented, not executed, not passed.

**OWASP:** A05:2021 Security Misconfiguration / API8:2023 Security Misconfiguration.

### 8.7 Additional security review areas (new in v4.7)

**A. RLS and connection pooling.** The Supabase pooler runs in transaction mode, so session-level settings are unsafe (6.3). Requirements: context is set with `set_config(..., true)` (transaction-local) inside the same transaction as the queries; the context is set **and validated** in that same transaction, at the runner boundary, before any query runs; commit or rollback removes the context, and a request that throws midway leaves nothing behind; pooled connections shared by concurrent tenants never leak context (the 6.4 pool-of-one interleaving test); there is **no unscoped fallback**: if the context cannot be set or validated, the request fails closed with 503 and `Retry-After` (10.7), never a query without context. These requirements extend the 6.4 checklist and keep their state at “test specified” until the RLS spike runs them.

**B. Guest / Customer / Merchant / Super Admin boundaries.** Guest: published data of a non-suspended tenant only, no writes. Customer: published catalog plus own personal rows (`tenant_id` and `user_id` both enforced). Merchant: only tenants with a matching `memberships` row, checked in the application and again by RLS. Super Admin: separate database role, separate credential, explicit validated audit-logged tenant parameter, `/admin/*` routes only (6.6, 6.7). The policy matrix in 6.4 and the isolation suite in 8.3 hold these boundaries; risk 4 in 8.6 covers escalation between them.

**C. Draft vs published data.** Guests and Customers never see drafts: the application filters by status and the RLS policies require `status = 'PUBLISHED'` for those roles (6.2). Unpublish is effective: the status change, the cache invalidation (8.6.12) and the image-serving checks (section 7) all apply, within the 60-second tenant-resolution cache window (6.7). Guessing a UUID does not bypass any of this: a correct UUID without the right role and tenant returns 404 (8.6.1). Tests are specified at both layers: direct API tests (Guest and Customer cannot read, list or fetch drafts, including by direct id) and cache tests (unpublished content disappears from every cache).

**D. Google Drive media security.** Credentials are backend-only: the OAuth refresh token lives in server environment variables, never in the app, the repository or logs (sections 7, 6.8). A Drive file ID is not authorization: file IDs are never sent to clients, and the media module verifies tenant ownership and publish status in the database **before** serving bytes through the API (section 7). Draft media is Merchant-only, for the owning tenant. No public exposure: no sharing links and no “anyone with the link” on the Drive side (section 7). Tests: cross-tenant and Guest access to draft media return 404; no response contains a Drive URL or file ID (8.3); serving paths verify ownership before streaming.

**E. Super Admin and audit logs.** Sensitive operations are audited: actor, action, target, timestamp and context, with no secrets (6.6, 6.7). Audit rows are protected from modification: the audit table grants INSERT and SELECT to `multistore_admin` only, with no UPDATE or DELETE grants, so even the admin role cannot rewrite history (requirement documented; enforced by the grants snapshot test in 6.4). Admin takeover risks: the `SuperAdminGuard` re-checks the database flag on every request so a stale or forged token fails (6.6); sensitive admin operations (suspend tenant, change memberships) need step-up authentication. **Fresh password re-entry is a proposal only, not a decision and not a requirement:** the step-up method is the OPEN decision D3 in section 17.1, and no paid MFA service is allowed. Admin work adds no paid services without your approval.

**F. Dependency and deployment security.** Dependency security: pinned versions by lockfile (section 13); vulnerability scanning with `npm audit` and `pub outdated` in CI plus GitHub Dependabot alerts (free), with a documented update policy (security fixes promptly, everything else on the normal cadence). Secrets: never in source, build logs or clients (6.8); CI masks them; Flutter receives no backend secrets. Production hardening: HTTPS only, the CORS allowlist of 8.6.11, and secure response headers; **the headers middleware (for example** `helmet`**) is a new dependency and needs your approval before it is added** (section 13 rule), so it is listed as an unresolved decision below rather than added silently. Environment separation: development and production use separate configuration and separate credentials; separate Supabase projects are an option within the two-project free limit (10.1), to be decided at setup. Least-privilege credentials: the three-credential model of 6.6. Backup and restore: Supabase Free has no point-in-time recovery; the backup approach inside the free tier is an unresolved decision below, not silently chosen. All free-tier decisions (no bank card anywhere) are respected.

**Unresolved design decisions (listed, not invented). All six are OPEN; see the decision register in section 17.1 for options, recommendations and consequences:**

1. Secure HTTP headers middleware (`helmet` or equivalent): new dependency, needs your approval (section 13).

2. Backup and restore approach within Supabase Free (no point-in-time recovery on the free plan): options are reviewed manual exports or accepting the risk for the pilot; not decided.

3. Step-up authentication UX for sensitive admin operations (fresh password re-entry proposed; no paid MFA allowed): not decided.

4. Audit log retention period: not decided.

5. Additional abuse protection for public endpoints if throttling proves insufficient (no paid CAPTCHA service is allowed): not decided.

6. Whether rich HTML is ever allowed in product descriptions (Phase 1 is plain text only, 8.6.6): not decided.

### 8.8 Security test matrix (new in v4.7)

All entries are **test specifications**. None is implemented, executed or passed. Status per test is in section 23. Levels: Unit, Integration, API, E2E, Configuration, Migration.

**Table 1: concrete security test specifications.**

| **Test ID** | **Threat** | **Preconditions** | **Actor and tenant** | **Attack request / scenario** | **Expected secure behavior** | **Expected HTTP / safe outcome** | **DB side- effect expectations** | **Severity** | **Level** |
|---|---|---|---|---|---|---|---|---|---|
| STM-01 | IDOR/BOLA | Tenants A, B; Merchant A with products | Merchant, tenant A | Read, update, delete own product in own tenant | Allowed | 200 / success | Own row changed as requested | Critical | API |
| STM-02 | IDOR/BOLA | As above | Merchant, tenant A | GET/PUT/DELETE product of tenant B by its UUID | Rejected without existence leak | 404 | B’s row byte-identical afterwards | Critical | API |
| STM-03 | IDOR/BOLA | Customers 1 and 2 in tenant A | Customer 1, tenant A | Read/modify Customer 2’s favorites, cart or orders | Rejected or empty | 404 / empty list | Customer 2’s rows unchanged | Critical | API |
| STM-04 | IDOR/BOLA | Draft product in tenant A | Guest or Customer, tenant A | Read draft product by its exact UUID | Rejected | 404 | None | Critical | API |
| STM-05 | IDOR/BOLA | Export/analytics endpoint exists | Merchant, tenant A | Call export/analytics with tenant B’s code | Rejected | 404 | None; audit of rejected attempt where applicable | Critical | API |
| STM-06 | Tenant isolation | Tenants A, B seeded | Guest, Customer, Merchant | Tenant sent in body, query or header differs from URL | Body/query/header tenant ignored and rejected | Data of URL tenant only, or 400 | None | Critical | API |
| STM-07 | Tenant isolation | As above | Merchant, tenant A | Search, list with pagination, and aggregation against tenant B | Scoped to tenant A only | 200 with A’s data only / 404 | None | Critical | API |
| STM-08 | Tenant isolation | Outbox and media jobs pending | Background worker | Job processing runs with wrong or missing tenant context | Job runs with its own stored tenant context only | n/a (worker) | Rows of other tenants untouched | Critical | Integration |
| STM-09 | Tenant isolation | RLS enabled | Any role | Isolation suite rerun with the application filter removed | RLS alone blocks every cross-tenant access | 404 / zero rows | None | Critical | Integration |
| STM-10 | Authentication | Active verified user | Customer | Valid token on an allowed endpoint | Allowed | 200 | None | Critical | API |
| STM-11 | Authentication | As above | Any | Expired, tampered (signature, claims, algorithm confusion, wrong issuer or audience), or malformed token | Rejected | 401 | None | Critical | API |
| STM-12 | Authentication | Issued refresh pair | Any | Reuse of an old refresh token after rotation | Session revoked, both tokens rejected | 401 | Session row revoked | Critical | API |
| STM-13 | Authentication | Active sessions | Customer | Password change, then old tokens used | All existing sessions invalidated | 401 | Session rows revoked | Critical | API |
| STM-14 | Authentication | Pending user, codes issued | Any | Verification or reset code: replay, 6th attempt, use after 10-minute expiry | Rejected; code single-use, hashed, expiring | 400 / 429 | Code consumed or expired; no account state change | Critical | API |
| STM-15 | Privilege escalation | Users in each role | Customer; Merchant | Call every `/admin/*` and Merchant-only endpoint | Rejected | 404 / 403 | None | Critical | API |
| STM-16 | Privilege escalation | Registration/profile endpoints | Any | Mass assignment: `role=SUPER_ADMIN`, `is_super_admin=true`, foreign `tenant_id` in payload | Rejected by DTO whitelist | 400 | No user row created or changed | Critical | API |
| STM-17 | Privilege escalation | Forged SUPER_ADMIN claim | Any | Token with forged role claim against admin routes | Fails the database re-check | 403 | None; rejected attempt audit-logged | Critical | API |
| STM-18 | Credential isolation | Both DB credentials configured | Ordinary API runtime | Runtime reads `ADMIN_DATABASE_URL` or uses `AdminPrismaService` outside `AdminModule` | Impossible by configuration and module boundaries | n/a | n/a | Critical | Configuration / Unit |
| STM-19 | RLS pooling | Pool of one connection | Two tenants interleaved | Requests for tenants A and B interleaved on one pooled connection | Each sees only its own tenant’s rows | Correct per-tenant data | None | Critical | Integration |
| STM-20 | RLS / UUID schema | Migrations applied | Migration job | Lint: every table has a UUID PK, every FK is UUID referencing a UUID PK, RLS enabled and forced on every tenant table, every app policy carries an `app.role` check, no INT/BIGINT PK/FK | Lint passes only when all hold | n/a | Schema snapshot equals expected file | Critical | Migration |
| STM-21 | SQL injection | Search/list endpoints live | Any | Injection payloads in search, filter, sort, pagination, id fields | Parameterized or rejected | 400 / safe empty result | None | High | API |
| STM-22 | XSS | Merchant can edit content | Merchant, tenant A | Store script payload in product name, description, branding; submit `javascript:` URL | Stored as inert plain text, encoded on output; bad URL scheme rejected | 200 with inert content / 400 | Stored value inert | High | API + Unit |
| STM-23 | File upload | Media endpoints live | Merchant, tenant A; Guest, tenant B | Disguised, malformed, oversized, over-dimension uploads; cross-tenant and Guest access to draft media | Uploads rejected; draft media served only to owning Merchant | 400 / 413 / 404 | No orphan rows; Drive object absent on rejection | High | API |
| STM-24 | Rate limiting | Auth endpoints live | Any IP and account | Brute force login, verification, resend, reset, discovery, search, admin endpoints | Thresholds trigger per-IP and per-account; no permanent lockout | 429 with `Retry-After`; later legitimate attempt succeeds | No lockout flag persists | High | API |
| STM-25 | Account enumeration | One registered address | Any | Login, registration, reset, resend with registered vs unregistered address | Identical generic responses within a timing window | Same status and body | None | Medium | API |
| STM-26 | CSRF / CORS | API configured | Browser client | Response scan for auth cookies; preflight from disallowed origin; wildcard origin with credentials | No auth cookie ever set; disallowed origin gets no CORS headers; never `*` with credentials | No `Set-Cookie`; preflight fails | None | Medium | Configuration / API |
| STM-27 | Cache leakage | Caches warm for tenant A | Guest, tenant B; Merchant A | Serve A’s cached data to B; read drafts from shared cache; access after unpublish or permission change | Cache keys scoped by tenant and auth context; invalidation on publish/unpublish/permission change | Correct per-tenant data / 404 | n/a (cache), source rows unchanged | High | Integration |
| STM-28 | SSRF | API codebase | Static scan + runtime | Endpoint accepts an arbitrary URL; fetch to localhost, private range, or metadata address | No endpoint accepts arbitrary URLs; provider clients pinned to configured hosts | n/a | n/a | Medium | Configuration |
| STM-29 | Race / duplicates | Publish, upload, verification, reset, outbox paths live | Merchant; Customer | Concurrent double-submit; repeated POST with same `Idempotency-Key`; one-time token used twice; worker restart mid-send | Exactly one effect; idempotent replay returns first result; token single-use; outbox resumes without loss | 200 / 409-safe; duplicate prevented | One record created; unique constraints hold; no lost outbox rows | High | Integration |
| STM-30 | Information leakage | Forced failure paths reachable | Any | Validation error, auth failure, database unreachable, timeout, Gmail failure | Response carries safe message and `requestId` only; logs redacted at the sink (6.8) | Standard error shape, no stack/SQL/paths/secrets | None | High | API |

**Table 2: mandatory cross-tenant matrix.** Every cell expands to at least one automated test per tenant-owned resource, run at API level, with the RLS-on rerun of Table 1 STM-09 behind it. Legend: **D** = denied: 404 or zero rows, and the database is asserted unchanged; **A** = allowed within the actor’s own scope only; **-** = not applicable to that actor.

| **Actor combination** | **Read** | **Create** | **Update** | **Delete** | **Search** | **List / pagination** | **Export / analytics** | **Media access** | **Publish / unpublish** | **Background jobs** | **Email outbox** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Guest, store A vs store B | A: published of URL tenant only; D: B’s data and drafts | D | D | D | A within URL tenant; D across | A within URL tenant; D across | D | A: published images of URL tenant; D: drafts | D | - | D |
| Customer A vs store B | A: published of URL tenant and own personal rows; D: B’s data and drafts | D for catalog; A own personal rows in URL tenant only | D outside own rows | D outside own rows | A within URL tenant; D across | A within URL tenant; D across | D | A: published images; D: drafts and B’s media | D | - | A: own verification/reset only |
| Merchant A vs store B | A own tenant; D: B | A own tenant; D: in B | A own tenant; D: B | A own tenant; D: B | A own tenant; D: B | A own tenant; D: B | A own tenant; D: B | A own tenant incl. drafts; D: B’s media | A own tenant; D: B | A: own tenant’s jobs only; D: B | A: own tenant’s outbox only; D: B |
| Merchant vs Customer | D: Customer cannot use Merchant endpoints | D | D | D | D | D | D | D: Customer cannot reach draft media | D | - | D |
| Customer vs Super Admin | D: Customer cannot use admin endpoints or connection | D | D | D | D | D | D | D | D | D | D |
| Ordinary API runtime (`multistore_app`) vs Admin DB connection (`multistore_admin`) | D: runtime cannot read `ADMIN_DATABASE_URL` or reach the admin connection | D | D | D | D | D | D | D | D | D | D |

Both tables are specifications only. No entry claims to be implemented, executed or passed. Phase 1 note: the cart and order cases in STM-03 are deferred with those features (section 20).

### 8.9 Security priorities and release readiness (new in v4.7)

**Priority definitions:**

**P0:** must be implemented, tested and passing **before any production release**.

**P1:** must be implemented, tested and passing **before the affected feature is enabled**.

**P2:** hardening; each item carries a documented remediation deadline, agreed with you when the item is scheduled.

| **Priority** | **Item** | **Where specified** | **Required evidence before the gate passes** |
|---|---|---|---|
| P0 | Tenant isolation (application layer and RLS) | 6.1, 6.2, 6.3, 6.4, 8.3, 8.6.2, 8.8 | 6.4 policy matrix and 8.3 isolation suite implemented and passing, including the RLS-only rerun |
| P0 | BOLA / IDOR object authorization | 8.6.1, 8.8 STM-01 to STM-05 | Cross-tenant and cross-user object tests implemented and passing |
|---|---|---|---|
| P0 | Authentication and token lifecycle | 9, 8.6.3, 8.8 STM-10 to STM-14 | Token validation, rotation, revocation and code-lifecycle tests implemented and passing |
| P0 | Privilege escalation / function-level authorization | 6.1, 6.6, 8.6.4, 8.8 STM-15 to STM-17 | Role-endpoint matrix and mass-assignment tests implemented and passing |
| P0 | RLS context and pooling correctness (no context leak, no unscoped fallback) | 6.3, 6.4, 8.7-A, 8.8 STM-19, STM-20 | Transaction-local context tests implemented and passing on the pooled connection |
| P0 | Secrets exposure and information leakage | 6.8, 8.6.15, 8.8 STM-30 | Log-redaction and error-shape tests implemented and passing on success and forced failure |
| P0 | Unauthorized draft and media access | 7, 8.6.9, 8.7-C, 8.7-D, 8.8 STM-04, STM-23 | Draft/media access tests implemented and passing, including cache paths |
| P0 | UUID standard and schema consistency | 5.6, 8.8 STM-20 | Schema and migration lints implemented and passing; insert tests assign UUIDs with no database default |
| P1 | Rate limiting and brute-force protection | 8.6.7, 8.8 STM-24 | Passing threshold tests before the auth and public endpoints are enabled |
| P1 | File upload validation and processing limits | 7, 8.6.9, 8.8 STM-23 | Passing upload tests before the media feature is enabled |
| P1 | Race conditions and idempotency | 10.7, 8.6.14, 8.8 STM-29 | Passing concurrency and idempotency tests before publishing, media processing and the outbox are enabled |
| P1 | Cache tenant isolation and invalidation | 8.6.12, 8.8 STM-27 | Passing cache tests before response caching beyond section 7 headers is enabled |
| P1 | XSS defenses | 8.6.6, 8.8 STM-22 | Passing encoding and URL-validation tests before catalog and branding content is enabled; re-reviewed if rich HTML is ever allowed |
| P1 | CORS allowlist | 8.6.11, 8.8 STM-26 | Passing CORS tests before any browser-based surface is enabled |
| P1 | Dependency and deployment security | 8.7-F | Vulnerability scanning green in CI, secrets scan clean, production CORS/HTTPS/headers verified before first release |
| P2 | Account enumeration hardening | 8.6.8, 8.8 STM-25 | Remediation deadline: before the pilot opens beyond invited users |
| P2 | SSRF architectural restriction maintenance | 8.6.13, 8.8 STM-28 | Remediation deadline: re-verified at every feature that adds a server-side fetch |
| P2 | CSRF posture verification | 8.6.10, 8.8 STM-26 | Remediation deadline: re-verified before any cookie-based authentication is introduced |

**Readiness rule.** A severity label alone does not establish readiness. Release requires evidence that the controls are implemented and that their tests pass: Passed (which includes Executed) in the test status model of 8.6. **No gate in this table is marked passed, and none can be until the RLS spike (6.5) and the CI suites** **run against real PostgreSQL.** As of v4.8, every gate is open (section 22.1 lists each gate as OPEN).

## 9. Authentication and email verification

**Primary method:** email and password. Passwords hashed with argon2id. Access token (short-lived JWT) plus rotating refresh token, reuse of an old refresh token revokes the session.

**Register:** creates the user as `PENDING_VERIFICATION` and sends a 6-digit code by email. The code is stored hashed, expires in 10 minutes, allows 5 attempts, and resend has a cooldown (60 seconds) and a daily cap per address.

**First login requires verification:** login with an unverified email returns `EMAIL_NOT_VERIFIED` and no tokens. After the correct code, the account becomes `ACTIVE` and tokens are issued.

**No SMS** of any kind. No paid sign-in provider.

**Verification email sender (decided, changed in v4):** the **Gmail API over HTTPS** from the dedicated Google account for the pilot, behind the `MailSender` port (`GmailApiMailSender`). The earlier Gmail SMTP choice was replaced because Render Free blocks outbound SMTP ports (section 10.6). `SmtpMailSender` and `ResendMailSender` remain later options if the host, volume or deliverability requires it; switching is a config change.

**Google sign-in (decided):** optional later addition, not in Phase 1. When added, Google accounts with a verified email would skip the code.

**Password reset** uses the same email code mechanism.

**Rate limiting** on register, login, verify and resend endpoints.

### 9.1 Gmail OAuth: consent screen, scope verification, refresh tokens, revocation (new in v4.1)

Sources opened 24 Nov 2026: https://developers.google.com/workspace/gmail/api/auth/scopes, https://developers.google.com/identity/protocols/oauth2, https://developers.google.com/identity/protocols/oauth2/production-readiness/overview, https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification, https://support.google.com/cloud/answer/10311615.

**Consent-screen configuration (one Google Cloud project, signed in as the dedicated Google account):**

| **Setting** | **Value** | **Reason** |
|---|---|---|
| User type | **External** (decided: the dedicated account is an ordinary Gmail account, which cannot choose Internal; Internal needs a Google Workspace organization) | With no Workspace account, Internal is not available, so External it is. |
| App name, support email, developer contact | App name “MultiStore Mailer”, support and developer email = the dedicated account | Required fields. |
| Scopes declared | `https://www.googleapis.com/auth/gmail.send` (send only, cannot read mail) and the Drive scope already used for media, `https://www.googleapis.com/auth/drive.file` (non-sensitive). v4.8 adds `openid` and `email` (non-sensitive, unverified assumption H in 16.1) because the identity check in 9.1.1 needs them | Least privilege. No `gmail.readonly`, no `mail.google.com`. |
| Authorized users | Only the dedicated account ever authorizes the app. **This is a plan, not a control:** the enforcement is the application allowlist in 9.1.1. | Nobody else should sign in to Google through our app; customers use email and password (section 9). |
| Publishing status | **In production** (not “Testing”) | In Testing, Google issues refresh tokens that **expire after 7 days**, which would break email weekly. |

**9.1.1 Application-level allowlist on the OAuth callback (new in v4.4)**

Google’s 100-user cap on unverified apps and the consent-screen description are **not access control**. The cap only limits how many accounts Google lets through, and the consent screen is text a person reads. Anyone who finds the authorization URL could try to complete the flow. The application must therefore decide, on its own, which Google account is accepted.

Rules for the OAuth callback (the one-time authorization script or endpoint, and any later re-consent):

1. **Configured allowlist of one.** The only accepted account is the dedicated Gmail address, held in server configuration (`GMAIL_ALLOWED_ACCOUNT`), never taken from the request.

2. **Verify the authenticated identity, not a request value.** After the code exchange, read the identity from the ID token (requires the `openid email` scopes) or from the Google userinfo response, and use only server-verified values: the verified `email` claim (`email_verified` true) and the stable Google account `sub`. A `login_hint` or any query parameter is never trusted.

3. **Compare and reject.** If the verified email does not exactly match (case-insensitive) the configured address, the callback rejects the request, **does not store** **any token**, revokes the token it just received at Google’s revoke endpoint, and shows a generic error. Every other account is rejected, including other accounts of the same person.

4. **Pin the account id.** On the first accepted authorization the account `sub` is recorded in configuration; later authorizations must match both email and `sub`, so a reassigned or look-alike address does not pass.

5. **Protect the flow.** Use a random single-use `state` bound to the session and PKCE; reject a callback with a missing, wrong or reused `state`.

6. **Restrict who can start the flow.** The authorization endpoint or script is available only to the operator (Super Admin or a local one-time script), not to public routes.

7. **Audit.** Every accepted and rejected callback is logged (time, outcome, hashed account identifier, no tokens).

8. **Tests (written after approval):** a different Google account is rejected and nothing is stored; a mismatched `state` is rejected; the allowed account passes; a rejected attempt triggers token revocation.

Note that the `openid email` scopes are non-sensitive, so adding them to the consent screen does not change the verification analysis (confirm at setup, assumption H in 16.1).

`gmail.send` **is a sensitive scope.** Google’s scope table classifies it as sensitive, and sensitive scopes require OAuth verification before the general public can authorize. Verification means: confirmed brand and contact info, a justification for each scope, a demo video, and a privacy policy and homepage on a domain you own; Google says review can take up to about 10 days. Two ways to handle it:

| **Path** | **What it means** | **Cost and risk** |
|---|---|---|
| **A. Production, unverified (selected for the pilot, 24 Nov 2026)** | The only person who ever grants consent is you, on the dedicated account. Google shows the “unverified app” warning once, and you continue past it. Unverified apps with sensitive scopes are capped at 100 users in total, and we need exactly one. The cap and the consent-screen text are not access control; the allowlist in 9.1.1 is. | No domain, no video, no review. Google’s own table says unverified production is “strongly discouraged” for public apps, and Google can change these rules. For a single-owner mailer it is the practical route; we record it as a pilot risk. |
| **B. Full verification** | Submit the app for sensitive-scope verification. | Needs a domain, privacy policy page and demo video, and review time. Do this if the pilot grows, or if A stops working. |

If Google later restricts path A, the fallback is the `MailSender` port: switch to SMTP on another host or to Resend (section 10.3) with a config change.

**Migration triggers away from Path A (recorded with the decision):** move to Path B (full verification) or to another mail provider behind `MailSender` when any of these happens: (1) the pilot grows beyond the single dedicated owner and toward the 100-user cap on unverified apps; (2) Google restricts or removes the unverified production path for sensitive scopes, or the unverified-app warning becomes blocking; (3) deliverability problems appear, for example codes landing in spam; (4) sending volume approaches the 500/day account limit. Moving to another provider (Resend, or SMTP on a host that allows it) is a config change inside one adapter (section 10.3). Moving to Path B needs a domain you own, a privacy policy page, a demo video, and up to about 10 days of Google review.

**Refresh-token stability.** Per Google’s documentation, a refresh token stops working when: the user revokes access; it is **unused for six months**; the account **password changes and the token carries Gmail scopes**; the per-account limit of **100 refresh tokens per client ID** is exceeded (the oldest is silently invalidated); or the project is in Testing (7 days). Our plan against each:

Created once with `access_type=offline` and `prompt=consent`, stored only as a Render secret environment variable, never in the repository, logs, or Flutter app. Gmail and Drive use **separate refresh tokens** (two consent grants), so one failing does not take the other down. Adding a scope later needs a new consent. It is used daily by real sends, plus a scheduled weekly no-op token refresh, so the six-month idle rule cannot trigger.

Changing the dedicated account’s password invalidates the Gmail token. The runbook below is part of that change, and the password change is not done casually.

Re-running the consent flow is rare and recorded, so the 100-token limit is never approached.

**Recovery from token revocation or** `invalid_grant`**:**

1. The adapter classifies `invalid_grant` or 401 after a refresh as a **permanent auth failure** (not a retry), opens a circuit, and marks mail as `DEGRADED` in `/health/ready` detail and logs.

2. Pending messages stay in the email outbox (section 10.7), nothing is lost, and registration still succeeds. Users see “we could not send the code, tap resend”.

3. You are alerted (log alert and a visible Super Admin status indicator, section 19.3 S6; there is no second mail channel to rely on, so the alert is not an email through the same account).

4. Recovery runbook, documented in the README: sign in to the dedicated account, run the one-time authorization script (written after approval) to get a new refresh token, replace the Render secret, redeploy, and the outbox drains automatically.

5. Expected recovery time is minutes once someone acts. Until then, only email verification and reset are affected; browsing and Merchant work continue.

## 10. Free-service quotas and limits (checked 24 Nov 2026)

All sources below were opened on 24 Nov 2026. Numbers can change, so they are re-checked at setup.

### 10.1 Supabase (PostgreSQL only)

| **Item** | **Free plan** | **Source** |
|---|---|---|
| Database size | 500 MB | https://supabase.com/pricing |
| Free projects | 2 active | https://supabase.com/pricing |
| Pause behavior | Paused after 1 week of low activity, can be restored | https://supabase.com/docs/guides/platform/free-project-pausing |
| Egress | 5 GB per month | https://supabase.com/pricing |
| API requests | Unlimited | https://supabase.com/pricing |

Supabase Auth (50,000 MAU) and Storage (1 GB) are **not used**. Auth is our own NestJS auth, and files go to Drive. Impact: a pilot with text data fits in 500 MB for a long time (images are not in the database). A pause after a quiet week is the main risk, so the first user after a pause waits for the restore. A scheduled ping or paid plan is a later option, not in Phase 1. The exact pause trigger and the restore time are **mandatory validation gate 3**, confirmed at setup and watched in operation.

### 10.2 Google Drive (dedicated account)

| **Item** | **Limit** | **Source** |
|---|---|---|
| Account storage | 15 GB per Google account, shared across Gmail, Drive and Photos | https://support.google.com/accounts/answer/9312312?hl=en |
| API rate | 1,000,000 quota units per minute per project, 325,000 per user | https://developers.google.com/workspace/drive/api/guides/limits |
| Cost per call | read 5 units, list 100, create/edit 50 | same page |
| Daily threshold | 400,000,000 units per project and 1 TB egress per day before charges apply | same page |

Notes: (1) Google states that full billing details for this API will be shared later in 2026 with at least 90 days’ notice. Today usage under the threshold is free, and our usage is far below it. The `StorageProvider` abstraction is exactly the protection against a future change. (2) Because the dedicated account is also its Gmail, 15 GB is shared with that mailbox. (3) Drive is slower than a CDN, which is why section 7 resizes and caches images.

### 10.3 Verification emails (decided: Gmail API for the pilot)

With Render Free selected (section 10.6), SMTP is not available: Render blocks outbound traffic to SMTP ports 25, 465 and 587 on free web services since 16 Sep 2025 (https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports). The pilot therefore sends through the **Gmail API over** **HTTPS** from the dedicated Google account, behind the `MailSender` port. Business code only ever sees `MailSender`, so this change stays inside one adapter.

| **Option** | **Limit** | **Notes** | **Source** |
|---|---|---|---|
| **Gmail API from the dedicated account (selected)** | Account sending limit: 500 emails per day for a standard Gmail account (2,000 for Workspace). API quota: 100 units per send; 6,000 units per minute per user (about 60 sends/minute); free daily threshold 80,000,000 units per project | HTTPS only, works on Render Free. Same dedicated Google account and Cloud project as the Drive media (one Google Cloud project and one dedicated account; separate refresh tokens for Gmail and Drive, kept server-side, see 9.1). No domain needed. | https://support.google.com/mail/answer/22839?hl=en and https://developers.google.com/workspace/gmail/api/reference/quota |
| Gmail SMTP (later, if the host changes) | Same 500/day account limit | Blocked on Render Free today; usable again on any host that allows port 587. Needs an app password or OAuth. | https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports |
| Resend free plan (later option) | 3,000 emails per month | Needs a verified domain you own. Better deliverability. | https://resend.com/pricing |

Each registration costs 1 email (plus resends), so 500 a day covers the pilot comfortably. Notes: (1) Google updated the Gmail API quota rules on 1 May 2026; the numbers above are from the current quota page and are re-checked at setup. (2) Google states that full API billing details will be shared later in 2026 with at least 90 days’ notice; usage under the daily threshold is free today and ours is far below it. The `MailSender` abstraction is the protection against a future change here too.

### 10.4 Supabase Auth built-in email (not used)

Its built-in mail service is limited to 2 emails per hour (https://supabase.com/docs/guides/auth/auth-smtp), another reason we send through our own `MailSender`.

### 10.5 GitHub Actions

On GitHub Free, private repositories get **$12 per month of included compute**, shown in dollars, not minutes. Public repositories are free on standard runners. Source: https://docs.github.com/en/billing/reference/product-usage-included and https://docs.github.com/en/actions/concepts/billing-and-usage. I did not verify the per-minute rate, so I cannot give an exact minutes figure. Mitigation: path filters (section 3), caching, and the budget setting “stop usage when budget limit is reached” so it can never bill you. A public repository is the other option, if the code can be public.

### 10.6a Hosting amendment A-IP3 (26 Nov 2026): Vercel Hobby plus GitHub Actions (supersedes the Render Free choice for the pilot)

**Why.** Render Free (10.6) and every always-on free host checked on 26 Nov 2026 asked for a bank card at account or API level. You decided on 26 Nov 2026 (Telegram message 20663749, relayed by the main agent) to keep the no-card rule and approved option B: **Vercel Hobby** for the API and **GitHub Actions** as the scheduled retry. This section replaces 10.6 for hosting wherever they differ. Everything else in 10.6 and 10.7 about Supabase, secrets and failure handling stands.

| Topic | Decision |
|---|---|
| API host | Vercel Hobby (free, no card). The NestJS app runs as one Vercel Function (Fluid compute), region fra1 (next to Supabase eu-central-1). Database stays on Supabase through the transaction pooler as `multistore_app`. |
| Always-on worker | **Not available.** The in-process polling loop of 10.7 is disabled with `OUTBOX_MODE=sweep`. It stays the default (`loop`) for any always-on host. |
| Outbox, immediate send | Features queue mail through `OutboxService.queue`. The row is written to `email_outbox` first, then one send attempt runs inside the same request (up to 8 s). A failed or slow attempt never fails the caller; the row stays pending. |
| Outbox, scheduled retry | A GitHub Actions workflow (`.github/workflows/outbox-sweep.yml`, free on public repositories) calls `POST /internal/outbox/drain` about every 5 minutes with `Authorization: Bearer CRON_SECRET`. GitHub may delay scheduled runs under load, so retry timing is "about every 5 minutes", not exact. The endpoint returns counts only, is not in the OpenAPI contract, returns 404 when `CRON_SECRET` is not set and 401 for a wrong token. |
| Crash and restart safety | Unchanged: rows stay in PostgreSQL, `SENDING` rows with an expired lease are taken over by the next attempt. |
| Login codes | A verification or password-reset code (valid 10 minutes, STM-14 and section 9; the 5-minute window of D3 is for Super Admin step-up only) relies on the immediate send. If that attempt fails, the next sweep can arrive after the code expired; the user asks for a new code. This is an accepted limit of a no-card host. |
| Cold start | Serverless cold start is short (seconds), not Render's one minute. First request after idle also opens a fresh database connection. |
| Health (G-02) | Vercel Hobby has no platform health-check path setting and does not restart a function for failing checks. `/health/live` and `/health/ready` are verified from outside (the sweep workflow and manual checks). The external-monitor fallback named in gate 2 is therefore the design. Readiness stays 503 when the database is down and liveness stays 200. |
| Limits | Vercel Hobby is for personal, non-commercial use; function duration max 300 s; Hobby cron is once per day only, which is why GitHub Actions is used. Re-check the Hobby terms before any commercial use. |
| Paid dependencies | None. No card on Vercel, GitHub, Supabase or Google. |

### 10.6 Free API hosting (decided: Render Free web service; hosting superseded by 10.6a)

You selected **Render Free** from the written comparison (24 Nov 2026), with **no bank card** on any service. Render’s stated purpose for free instances is testing and hobby projects, not production, which fits a pilot.

**Render Free limitations, documented** (checked 24 Nov 2026, https://render.com/docs/free and the SMTP changelog linked in 10.3):

| **Limit** | **Value** | **Impact on us** |
|---|---|---|
| Sleep on idle | Spins down after **15 minutes** without inbound traffic (HTTP or WebSocket); spun-down services consume no instance hours | The API is unreachable while asleep. |
| Cold start | **About one minute** to spin back up on the next request; Render shows a loading page to browsers meanwhile | The Flutter app already renders one loading state with retry for async data (section 4.3), so the first call after idle simply stays in that state for up to about a minute. Acceptable for a pilot; noted honestly in the README. |
| Free instance hours | **750 per workspace per calendar month**, reset monthly, no rollover; hitting zero suspends all free services until next month | One service fits a full month (about 744 hours). A second always-on free service would not; the month has no room for two. |
| Compute | 0.1 CPU, 512 MB RAM | Enough for the NestJS pilot with Prisma. `sharp` image resizing (section 7) is the memory-heavy part to watch; resize jobs stay small and sequential. |
| Outbound SMTP | Ports 25, 465 and 587 blocked on free services since 16 Sep 2025 | This is why verification email uses the Gmail API over HTTPS instead of SMTP (section 10.3). |
| Ephemeral filesystem | Local files are lost on every redeploy, restart or spin-down; free services cannot attach a persistent disk | Matches the design: images live in Drive, data in Supabase, and the API stores nothing locally. |
| Bandwidth and build minutes | Free usage counts against monthly included outbound bandwidth and pipeline minutes; with no payment method added, exceeding them suspends services or disables new builds until the next month (existing builds keep running) | Pilot traffic is small. The dashboard’s Monthly Included Usage page shows consumption and Render emails a warning near the limit, so this is monitored, not guessed. |
| Service-initiated traffic | Render may suspend a free service that initiates an uncommonly high volume of outbound traffic (external databases, APIs, object storage) | Our calls to Supabase, Drive and Gmail are small; revisit if image traffic grows. |
| Deploys and rollbacks | Deploys from the Git repository; rollbacks only to the two most recent previous deploys | Fits the monorepo pipeline (sections 3 and 8.4): the `api/` path filter triggers an API deploy only on API changes. |
| robots.txt while asleep | A spun-down service answers `/robots.txt` with “disallow all” automatically | Harmless for an API with no SEO surface. |

**Why this decision is safe:** the API is a stateless, Docker-deployable app configured through environment variables, so hosting is an implementation detail. Changing hosts later means a new deploy target, not code changes (section 14). If the pilot outgrows Render Free (cold starts hurt, or SMTP is needed without the Gmail API), the comparison’s runner-up, Cloud Run, stays available, at the cost of adding a card.

**Paid dependencies in this plan: none.** No bank card is added to Render, Supabase, Google or GitHub.

### 10.7 Render reliability: health checks, timeouts, retries and failure handling (new in v4.1)

This section defines behavior for a service that sleeps, restarts, and depends on Supabase and Gmail. Details marked “confirm at setup” are checked against Render’s current docs during deployment, not assumed.

**Health checks**

| **Endpoint** | **Checks** | **Use** |
|---|---|---|
| `GET /health/live` | Process is up and the event loop answers. No database, no Gmail. Returns 200 with version. | Render health check path (**mandatory validation gate 2:** confirm at setup that the free plan supports setting it; if it does not, an external monitor calls `/health/ready` instead). A liveness check must never fail because a dependency is down, or Render would restart a healthy process. |
| `GET /health/ready` | Database readiness: `SELECT 1` as `multistore_app` with a 2-second timeout, result cached about 5 seconds. Also confirms RLS context works (a canary query inside a transaction returns zero rows without context). Mail status is reported as `OK` or `DEGRADED` from the circuit state, **without calling Gmail**. | Used by our own monitors and the Flutter app’s connection check. Returns 503 when the database is down. |

Startup: the API runs migrations nowhere (migrations use the owner role in CI/deploy step). At boot it verifies that it is connected as `multistore_app` with `rolsuper =` `false` and `rolbypassrls = false` and refuses to start otherwise.

**Cold start and sleep.** The first request after a sleep takes about a minute. The `/health/ready` call is the first thing the Flutter app does when a request times out or the app opens, so it shows one clear “waking up the server” state. A free external pinger could keep the service awake; it is **not** part of the plan, because it spends the 750 free hours on one service and could hit the cap (10.6), and it is not guaranteed to be permitted.

**Timeouts (server side)**

| **Layer** | **Timeout** | **Notes** |
|---|---|---|
| HTTP request (API) | 15 seconds, then 503 | Prevents stuck requests holding the 0.1 CPU instance. |
| Database statement | `statement_timeout` 8 seconds on `multistore_app` | Set on the role. |
| Prisma interactive transaction | 10 seconds max, 5 seconds to acquire | The tenant transaction runner (6.3) uses these. |
| Gmail API call | 10 seconds, no retry inside the request path | Sending runs from the outbox, not inside the user’s request. |
| Drive call | 10 seconds for metadata, 30 seconds for image bytes |  |
| Flutter client | 20 seconds normally, **70 seconds for the first call after idle** | Covers the cold start. |

**Safe retry behavior**

**Client retries only idempotent calls automatically** (GET, and PUT/DELETE by id): up to 3 tries with exponential backoff and jitter, only on timeout, 502, 503, 504, and honoring `Retry-After`.

**POST is never auto-retried blindly.** Calls that create something (register and publish in Phase 1; order creation when orders exist, section 20) carry an `Idempotency-Key` header; the server stores key and result for 24 hours, so a repeat after a lost response returns the first result and creates nothing twice.

**Server-side retries** exist only for the email outbox and Drive reads, with the limits below.

4xx errors (validation, auth, forbidden) are never retried.

**Gmail API failure handling**

Verification and reset emails are written to an `email_outbox` table in the same transaction as the user action, then sent by an in-process worker. If Gmail is slow or down, registration still succeeds.

Retries: for 429 and 5xx, backoff 1, 5, 30, 120 seconds, max 5 attempts, then `FAILED` and the user can tap resend (cooldown rule in section 9 still applies). Permanent auth failure (`invalid_grant`): no retries, circuit opens, recovery per 9.1.

Daily-limit hit (500/day account limit): sends pause until the next day, status `DEGRADED`, nothing dropped.

Because Render can sleep or restart mid-send, the worker marks a row `SENDING` with a lease timestamp; an expired lease is retried, so a restart cannot lose a message. An occasional duplicate code email is possible and harmless (only the latest code is valid).

**Email outbox recovery on sleep and restart (made explicit in v4.5).** The outbox sender is an **in-process worker inside the API**; it starts automatically when the API starts. There is no separate background process, and the design does not assume an always-on worker, which Render Free does not provide. While the service sleeps, pending messages stay persisted in the `email_outbox` PostgreSQL table; nothing lives only in memory. When Render wakes the service or restarts it, the worker starts with the API and resumes processing every pending row, including any row left in `SENDING` with an expired lease, which it takes over and retries. A message is lost only if PostgreSQL loses it, and the database is not on the ephemeral Render filesystem (section 10.6).

**Database failure handling**

Connection failure, pooler error or timeout: the request fails closed with **503 and** `Retry-After`, never a partial write and never an unscoped fallback query. The pool is small (the free host has 512 MB), and Prisma’s connection errors are mapped to one `DEPENDENCY_UNAVAILABLE` error code that Flutter shows as “try again”.

Writes are inside one transaction, so a failure rolls back completely.

Supabase free projects may pause after inactivity and have their own limits; section 10.1 lists them, and the readiness endpoint surfaces a paused database as 503 rather than hanging.

Drive failure affects images only: the API returns product data with the image marked unavailable rather than failing the whole listing.

**Canary query and empty context (v4.9):** the readiness canary query, and any query run without tenant context, must tolerate a reused pooled connection whose `app.tenant_id` reads back as an empty string: policies use `NULLIF(..., '')::uuid` (6.2), so such a query returns zero rows instead of raising an error.

**What the tests cover (documentation of intent, no code yet):** readiness returns 503 with the database stopped; liveness stays 200; the outbox retries and drains after a simulated Gmail outage; an `invalid_grant` response opens the circuit without retry storms; a repeated POST with the same `Idempotency-Key` creates one record; a timeout never leaves an open transaction holding context.

## 11. Previous code does not dictate this architecture

You asked me to confirm this explicitly. **Confirmed.**

A small starter exists from earlier steps (NestJS with a health endpoint and branding endpoint, a Prisma schema for tenants, users, memberships and stores, and a Flutter splash and onboarding). It was created before the “no code before approval” rule.

It is **reference only**. This document defines the architecture. Nothing in the starter is kept because it already exists.

After you approve, the order is (the detailed phases, dependencies and acceptance criteria are in section 21): (1) the RLS spike (section 6.5), (2) set up the new monorepo structure, lint, CI and the isolation/RLS test harness, (3) move over or rewrite starter pieces **only where they pass the same rules** (layering, naming, tests), delete the rest. The Prisma schema will be redesigned for tenant tables, RLS and the verification states, not inherited.

The word “Client” in the old onboarding becomes Guest and Customer.

No existing file will be modified before your approval.

## 12. What we deliberately do not build

No microservices, message queue or event bus.

No CQRS or event sourcing.

No generic base repository. Only what two or more modules actually share.

No Flutter code generation (freezed, json_serializable, riverpod_generator) in Phase 1.

No interface for a class that has one implementation and no likely second one. Ports exist where replacement is likely: storage, mail, repositories (for testing). No second state management library and no custom DI container.

## 13. Dependencies

**v4.9.1 note (IP-3, 26 Nov 2026, approved by you):** `pg` and `@types/pg` are approved as devDependencies only (RLS Jest tests). `helmet` 8 is added (D1 A). `prisma` and `@prisma/client` are pinned to 6.19.3 on purpose (Prisma 7 needs a `pg` driver adapter at runtime, which is not approved). `googleapis` is imported by its Gmail path only. `supertest` and `@types/supertest` are dev only. Node 24 is required (Nest 12 is ESM only); this is a platform requirement, not a package. Vercel needs no new package. Everything else below is unchanged.

**v4.8 note:** no dependency is added by v4.8. Possible additions that depend on OPEN decisions are listed here so they are not added silently: `helmet` (D1, option A), an authenticator-code library (D3, option C), a Markdown or HTML library (D6, options B and C). None is approved.

Few, popular, free, maintained. Each needs a one-line reason in `docs/dependencies.md`. Versions are pinned by lockfile. Anything not listed needs your approval first.

**Backend:** `@nestjs/*` (core, config, jwt, passport, swagger, throttler), `prisma` and `@prisma/client`, `class-validator`, `class-transformer`, `argon2`, `googleapis` (Drive and Gmail API), `sharp`, `jest`, `supertest`, `eslint`, `prettier`, `husky`. Optional later: `google-auth-library` (Google sign-in), `nodemailer` (SMTP, if the host changes).

**Flutter:** `flutter_riverpod`, `riverpod_lint` (dev, lint only), `go_router`, `dio`, `flutter_secure_storage`, `shared_preferences`, `cached_network_image` (with auth headers), `intl`, `flutter_localizations`, `mocktail`, `flutter_lints`. Optional later: `google_sign_in`.

## 14. Scalability path

| **Growth** | **How the design handles it** |
|---|---|
| More tenants | `tenant_id` on every table with composite indexes, tenant-scoped transactions, RLS |
| More products and images | Cursor pagination, thumbnails, cache headers, images behind `StorageProvider` |
| More users | Stateless JWT API, can run multiple instances |
| More features | New feature = new module or folder, no edits to existing ones |
| Branding | Tenant config in the database, theme built at runtime |
| Replace Drive | New adapter + contract test + config switch + copy script |
| Leave Supabase | Plain PostgreSQL with Prisma migrations. Roles and RLS are plain SQL, no Supabase-only features in app code |
| Replace Render | Stateless Docker app configured by environment variables; a new host is a new deploy target, not a code change |

## 15. Documentation plan and reusable component rules

Kept in the repository, in Markdown, updated in the same change as the code.

| **File** | **Content** |
|---|---|
| `README.md` | Setup, run, test, step by step |
| `docs/architecture.md` | Layers, module map, dependency rules |
| `docs/folder-structure.md` | Both trees with what goes where |
| `docs/adr/NNNN-*.md` | One short record per decision (stack, tenant isolation and RLS, storage, auth) |
| `docs/design-system.md` | Tokens, components, how to add one, gallery screen |
| `docs/dependencies.md` | Each dependency with reason and license |
| `docs/testing.md` | Strategy, how to run, isolation suite and the critical-path list |
| `docs/api.md` + `contracts/openapi.json` | Endpoints and error codes |
| `docs/terminology.md` | Guest, Customer, Merchant, Super Admin |

**Reusable component rules**

1. Used in two places means it moves to `design_system/components`.

2. **Configurable through constructor parameters only.** All data comes in as parameters; all actions go out as callbacks. A component never fetches its own data.

3. **No business logic and no API calls inside components.** Components do not import dio, repositories, use cases or feature providers. Enforced by an import-boundary lint rule on `design_system/`: it may import only Flutter, tokens, theme and layout helpers.

4. Each component is added to the debug-only gallery screen and has a widget test for every state (default, disabled, loading, error where applicable), in AR RTL and EN LTR.

5. Spacing, radius, colors and text styles come from tokens only.

6. The component catalog (buttons, inputs, cards, dialogs, feedback states, product widgets, layout helpers) is as in the Design System and Screens document.

## 16. Approval checklist

**Approval separation:** Approval of this technical document is separate from final implementation approval. Approving this documentation is a separate step from the final approval of implementation. Neither has been given. No checklist item below is approved, and no code starts until you give explicit final implementation approval.

**Decision status (24 Nov 2026):** the three design decisions you confirmed are recorded in section 1 as decisions 15 to 17 and listed in section 1; every checklist item below is unchecked. **That confirmation covers those three decisions only. It is not final approval of this document and not permission to write,** **modify, or execute any code.** The three mandatory validation gates stay open: (1) Supabase support for a custom `NOBYPASSRLS` role, checked in the RLS spike; (2) Render Free health-check configuration, checked at deployment setup; (3) Supabase Free project pause behavior, checked at setup and watched in operation. Their results are reported back to you.

**v4.8 status (25 Nov 2026):** v4.8 records no new decision and no approval. Six design decisions are OPEN (section 17.1) and four items are PROPOSED (section 17.2). Implementation phases (section 21) are plan steps, not authorized work. Every checklist item below is unchecked.

Reply with final approval of this document, or tell me what to change.

- [ ] The redesigned RLS policies (section 6.2) correctly separate Guest, Customer, Merchant and Super Admin, and Guest is strictly limited to published products.
- [ ] The trust and validation of tenant and role context (section 6.3) is clear.
- [ ] Components are configurable and free of business logic and API calls (section 15).
- [ ] “80% meaningful” coverage and the critical-path list (section 8.2) match what you want.
- [ ] Feature independence as a low-coupling objective with recorded exceptions (sections 4.5, 5.3) is acceptable.
- [ ] Every RLS policy and all CRUD operations across tenants are tested (sections 6.4, 8.3).
- [ ] Gmail OAuth setup, the `gmail.send` verification path, token stability and the revocation runbook (section 9.1): **decided: ordinary Gmail account (External** **user type), Path A, production without verification, restricted to the single dedicated account owner for the pilot, with documented migration** **triggers.**
- [ ] OAuth callback allowlist of the single dedicated Gmail account and rejection of every other account (section 9.1.1).
- [ ] Tenant resolution by actor: Guest, Customer and Merchant from the URL path; Super Admin by an explicit, validated, audit-logged parameter (sections 6.1, 6.3, 6.7).
- [ ] `multistore_admin` privileges and isolation from ordinary requests (section 6.6).
- [ ] Customer multi-store browsing: **approved** in v4.2. Tenant from the URL path, validated server-side on every request; identity only in the token (section 6.7). Your design decision is recorded in section 1; this checklist item is still unchecked. This replaced the earlier “tenant from JWT” wording in v4.1.
- [ ] Render reliability behavior: health checks, timeouts, retries, idempotency keys, Gmail and database failure handling (section 10.7).
- [ ] Email outbox recovery: the in-process worker starts automatically with the API and resumes pending messages after Render sleep or restart; messages stay persisted in PostgreSQL (section 10.7).
- [ ] The expanded RLS validation checklist (section 6.4).
- [ ] The additional Super Admin security tests and credential isolation (v4.6): the negative tests in sections 6.4 and 6.6 (no access to `ADMIN_DATABASE_URL`, no `AdminPrismaService` outside `AdminModule`, no ownership acquisition, no privileged role membership, no `SET ROLE`, no policy or DDL power), the explicit per-purpose credential separation (6.6), and the secrets-and-logging redaction requirements and tests (6.8).
- [ ] Decisions 10 to 14 in section 1 are recorded correctly.
- [ ] Render Free hosting and its documented limitations (section 10.6), including the 15-minute sleep and the one-minute cold start, are acceptable for the pilot.
- [ ] Verification email through the Gmail API instead of SMTP (sections 9, 10.3) is recorded correctly.
- [ ] No bank card is required anywhere in the plan.
- [ ] Hosting and email stay behind abstractions, so providers can change later without touching business logic (sections 5.5, 14).
- [ ] UUID standardization and schema consistency (v4.7): every table uses an `id` UUID primary key, every foreign key is UUID and references a UUID primary key, no INT/BIGINT primary or foreign keys exist, Prisma schema and migrations stay consistent, and UUID generation works for inserts and relations, verified by the automated checks in section 5.6.
- [ ] Security Threat Model coverage (v4.7): all 15 risks in section 8.6 are reviewed, each with a MultiStore-specific scenario, affected modules, impact, mitigation, server-side authorization requirements, specified positive and negative tests, severity, status and OWASP category.
- [ ] Critical tenant isolation, authorization, authentication and RLS test specifications (v4.7): the specifications in sections 6.4, 8.3, 8.6 and 8.8, including the mandatory cross-tenant matrix and the RLS-only rerun.
- [ ] File/media, cache, API and secrets security requirements (v4.7): sections 6.8, 7, 8.6 (risks 9 to 12 and 15) and 8.7 (areas C, D and F).
- [ ] Security testing and release-readiness evidence (v4.7): the P0/P1/P2 priorities and gates in section 8.9; a severity label alone does not establish readiness, and no gate is marked passed without evidence that controls are implemented and their tests pass.
- [ ] Decision register (section 17): D1 to D6 and P-1 to P-4 are recorded with the option you approved on 25 Nov 2026, and nothing else is recorded as decided.
- [ ] Phase 1 product scope and the Guest, Customer and Merchant journeys (v4.8), and the split between Phase 1 and deferred features (sections 18, 20).
- [ ] Super Admin interface and boundaries (v4.8) (section 19).
- [ ] Implementation phases with dependencies, deliverables and acceptance criteria (v4.8) (section 21). Reviewing the plan does not authorize implementation.
- [ ] Security release gates, backup and recovery requirements, and validation procedures (v4.8) (section 22).
- [ ] Test status model and register: every test shown as specified, implemented, executed and passed separately, with no claim of executed or passed (v4.8) (sections 8.6, 23).


### 16.1 Remaining unverified assumptions and mandatory validation gates

**Mandatory validation gates (you asked to keep these; each must pass and be reported to you):**

| **Gate** | **What must be verified** | **When** | **If it fails** |
|---|---|---|---|
| 1 | Supabase accepts a custom role created with `NOSUPERUSER NOBYPASSRLS` and the grants in section 6.6, and works through the pooler | RLS spike (section 6.5), the first step after implementation approval | Stop and report to you. The application layer stays; options are decided with you |
| 2 | Render Free allows configuring a health check path (section 10.7) | Deployment setup | An external monitor calls `/health/ready` instead |
| 3 | Supabase Free project pause behavior: when it pauses, how it restores, and what the first user sees (section 10.1) | Setup, then watched in operation | Add a keepalive or change the plan with your decision |

**Other assumptions not yet verified (nothing here is confirmed by a test):**

| **#** | **Assumption** | **Section** | **Checked** |
|---|---|---|---|
| A | Transaction-local `set_config` works through the Supabase pooler | 6.5 | **PASSED** in the IP-1 spike (25 Nov 2026), with the empty-string finding handled by `NULLIF` (6.2) |
| B | The policy matrix in 6.4 passes as written | 6.4, 6.5 | **PASSED in the NULLIF form** (IP-1 spike, 25 Nov 2026). In the v4.8 form three no-context cells errored instead of returning zero rows, which is why 6.2 was changed |
| C | A Gmail OAuth app in production status without verification keeps refresh tokens stable for the single owner (Google documents the Testing status as the 7-day case) | 9.1 | Setup, then weekly keepalive |
| D | Google keeps allowing the unverified production path for `gmail.send` during the pilot | 9.1 | Migration triggers in 9.1 |
| E | Render Free CPU and 512 MB RAM are enough for image processing | 10.6 | Load check at setup |
| F | Cold start of about one minute is acceptable to users, covered by the Flutter loading screen | 10.6 | Pilot feedback |
| G | The quotas in section 10 (checked 24 Nov 2026) remain unchanged | 10 | Recheck at setup |
| H | The `openid email` scopes used to verify the account identity in 9.1.1 are non-sensitive and do not change the verification path | 9.1.1 | Setup |

Anything found to differ is reported to you. It does not change a decision without your approval.

**Agreed next steps after your final approval:** (1) RLS technical spike as the first security validation, with a stop-and-tell if the pooler does not cooperate; (2) monorepo structure, lint, CI and the isolation/RLS test harness; (3) Render deployment of the API and the Gmail API mail adapter behind `MailSender`; then features. Until you say the document is approved, no code is written or modified.

## 17. Decision register (new in v4.8, updated in v4.9 with the IP-0 decisions)

This section is the single place that records the status of every decision. It exists so that nothing is read as decided or approved unless it is.

**Status vocabulary.**

- **DECIDED:** recorded in section 1 (decisions 1 to 17), or given by you in your IP-0 closure message of 25 Nov 2026 (Telegram message 16854956, relayed by the assistant and repeated in 16925042). The row states the option you approved.
- **OPEN:** no decision has been given.
- **PROPOSED:** a new item that needs your confirmation before it counts.

**Rule.** A recommendation never changes a status. v4.9 records only what you approved in the IP-0 closure message. Where a value below differs from the v4.8 recommendation, your approved value is the one that counts. The earlier body text of other sections is not rewritten by this update; where it still says "recommended" or "proposed" for D1 to D6 or P-1 to P-4, section 17 is the current status.

### 17.1 The six decisions (all DECIDED on 25 Nov 2026)

| ID | Decision | Status | Approved option | Effect |
|---|---|---|---|---|
| D1 | Secure HTTP headers middleware | **DECIDED** | **A:** add the `helmet` package. | `helmet` is approved. Section 13 gains it when it is first used (IP-3, before first deployment). It is not installed in IP-2. |
| D2 | Backup and restore within Supabase Free | **DECIDED** | **A:** encrypted logical database dump before every migration and weekly. Recovery point objective 7 days. **D2a:** the operator stores encrypted copies locally or off-site. The second Supabase Free project slot is reserved for restore rehearsals; local PostgreSQL is used for development. | Needed before first real data (IP-4) and gate G-21 before any production release. Unlike the v4.8 text in 10.1 and 8.7-F, the second free slot is not a development project. |
| D3 | Step-up authentication for sensitive Super Admin operations | **DECIDED** | **A:** fresh password re-entry, valid for a 5-minute window. | No new dependency. Built in IP-8. |
| D4 | Audit log retention | **DECIDED** | **90 days** for the Pilot, pruned by `multistore_owner`, with a monthly size check. | Replaces the 12-month recommendation. Needed when `audit_log` is first populated (IP-3). |
| D5 | Abuse protection for public endpoints | **DECIDED** | **A:** throttling only in Phase 1, with written escalation triggers. | No new dependency or service. Needed before the pilot opens beyond invited users (IP-9). |
| D6 | Rich HTML in product descriptions | **DECIDED** | **A:** plain text only in Phase 1. | Keeps 8.6.6 and STM-22 as written. |

### 17.2 The four proposals (all DECIDED on 25 Nov 2026)

| ID | Item | Status | Your decision |
|---|---|---|---|
| P-1 | Phase 1 product scope and the deferral list (sections 18, 20) | **DECIDED** | Approved. Contact Store channels are Phone, WhatsApp and Email, each optional per merchant. |
| P-2 | Super Admin interface form and grants (section 19) | **DECIDED** | **Option B:** a guarded Super Admin area in the Flutter app, with narrowed grants for S1 to S7. |
| P-3 | Gmail and Drive refresh tokens | **DECIDED** | Approved: separate refresh tokens for Gmail and Drive (9.1 wording). |
| P-4 | Granularity of implementation approval | **DECIDED** | **Phase by phase.** Each IP phase needs your explicit go-ahead after you review the previous phase's evidence. |

### 17.3 Existing decisions carried forward

Decisions 1 to 17 in section 1 keep their recorded status (DECIDED). Validation gate G-01 and Assumptions A and B are recorded as passed in 16.1 and 22.1. The other validation gates remain open.

## 18. Phase 1 product scope: Guest, Customer and Merchant journeys (new in v4.8)

**Status of this section: PROPOSED (P-1).** It is assembled from what v4.7 already states (the Flutter feature list in 4.2, the three integration flows in 4.4, the backend modules in 5.2, the roles in 6, sections 7 and 9). Each row says where it comes from. Rows marked **Proposed** fill a gap that v4.7 leaves open and need your confirmation. Nothing here is approved, and nothing here authorizes implementation.

**Terminology.** Guest (no account), Customer (signed in), Merchant (store owner or staff), Super Admin (section 19). The word "Client" is not used.

**Scope rule.** Phase 1 is a multi-store catalog with registration, store branding and a way to contact the store. Everything not listed in this section is deferred (section 20).

### 18.1 Guest journey (no account)

| Step | What the Guest can do | Source | Security requirements that apply |
|---|---|---|---|
| G1 | Open the app, see the splash and onboarding screens, choose language (Arabic RTL or English LTR) | 4.2 (splash, onboarding, l10n) | None beyond normal client behavior |
| G2 | Reach a store by its tenant code, as the code is the URL path part `/t/:tenantCode` | 6.1, 6.7. **Proposed:** the Guest enters a store code or opens a store link. A public store directory is deferred, because listing every tenant would expose tenant names and codes | 6.1: tenant from the URL path only; unknown, malformed or suspended code returns 404 with no detail |
| G3 | See the store's branding (primary and secondary color, logo) | 4.6, branding module | Branding of an active tenant only |
| G4 | Browse published categories and published products of that store, with cursor pagination | 4.2 (catalog), 5.4 | Published data of a non-suspended tenant only (6.1, 6.2); drafts never visible (8.7-C) |
| G5 | Open a product detail page with its image | 4.3 (`productDetailsProvider`), 7 | Images only through the backend (7); no Drive URL or file ID in any response (8.3) |
| G6 | Search products inside the store by name. **Proposed:** simple text match within the URL tenant | 8.6 and STM-07 assume search exists | Scoped to the URL tenant; injection tests STM-21 |
| G7 | Contact Store (see G-note below) | 4.4 integration flow "Contact Store" | Published store data only |
| G8 | Choose to register or sign in (becomes the Customer journey) | 9 | Section 9 rules |

**Guest cannot:** save favorites, see drafts, see a suspended store, write anything, call any Merchant or Super Admin endpoint.

**G-note on Contact Store.** v4.7 names this flow in the Flutter integration test list (4.4, 8.1) but does not define it. **Proposed definition:** the store profile holds contact details that the Merchant chooses to publish (for example a phone number or a message link). The app shows them on the store screen and the device handles the call or message. The server sends nothing on the Guest's behalf, so no new outbound email volume, no new server-side fetch (8.6.13) and no new abuse surface is created. Sending a message through the platform is deferred. This adds a contact-details field to the store profile, which must follow the UUID standard (5.6) and the draft rule (a draft store shows nothing to Guests).

### 18.2 Customer journey (signed in)

| Step | What the Customer can do | Source | Security requirements that apply |
|---|---|---|---|
| C1 | Register with email and password; the account is `PENDING_VERIFICATION` and a 6-digit code is emailed | 9 | Argon2id, hashed code, 10-minute expiry, 5 attempts, 60-second resend cooldown, daily cap; rate limits (8.6.7); generic responses (8.6.8) |
| C2 | Verify the email code; the account becomes `ACTIVE` | 9 | STM-14 |
| C3 | Sign in; unverified accounts get `EMAIL_NOT_VERIFIED` and no tokens | 9 | 8.6.3 and STM-10 to STM-13 |
| C4 | Stay signed in through short-lived access tokens and rotating refresh tokens; sign out revokes the session | 9 | Reuse of an old refresh token revokes the session |
| C5 | Reset a forgotten password with the same email code mechanism | 9 | Same code rules |
| C6 | Everything the Guest can do, in any store, by changing the tenant code in the path | 6.7 | The token carries identity only; tenant from the path every time |
| C7 | Save and remove favorites per store | 4.2 (favorites), 6.7 (Customer-owned rows) | Rows carry `tenant_id` and `user_id`; RLS requires both (6.7); STM-03 |
| C8 | View and edit profile; change app settings such as language | 4.2 (profile, settings) | Own row only (6.2) |
| C9 | Contact Store (as G7) | 4.4 | As G7 |

**Customer cannot:** place orders or use a cart (deferred), see drafts, call Merchant or Super Admin endpoints, or see another Customer's rows.

### 18.3 Merchant journey (store owner or staff)

| Step | What the Merchant can do | Source | Security requirements that apply |
|---|---|---|---|
| M1 | Obtain access. **Proposed:** a Super Admin creates the tenant and grants the Merchant a `memberships` row. There is no public Merchant sign-up in Phase 1 | 8.7-E (Super Admin changes memberships), 6.6 | Memberships changed only through audited admin operations (19) |
| M2 | Sign in with email and password (same account system as Customers) | 9 | Section 9 rules; membership checked in the application and by RLS (6.1) |
| M3 | Select a store they hold a membership for, through the tenant code in the path | 6.7 | No membership returns 404 (8.3) |
| M4 | Edit store profile and branding (colors, logo, published contact details) | 4.6, branding and stores modules | Own tenant only; file rules in 7 |
| M5 | Create, edit and delete categories | catalog module (5.2) | Own tenant only (STM-01, STM-02) |
| M6 | Create and edit products as drafts; upload product images; see drafts | 7, catalog and media modules | Uploads resized and re-encoded (7); upload tests STM-23; drafts Merchant-only |
| M7 | Publish and unpublish products; publishing a product without an image fails with a specific error | 8.2 (named business rule), 8.7-C | Idempotency key on publish (10.7); cache invalidation (8.6.12) |
| M8 | See the store as Guests see it (published view) | 4.2 (store) | Same rules as Guest |

**Merchant cannot:** act on a store they have no membership for, create or delete tenants, change memberships, call any admin endpoint, or see another tenant's data, drafts or media.

**Roles inside a store (Proposed).** v4.7 describes a Merchant as "store owner/staff" and `memberships` carries a role. Phase 1 treats every membership as the single Merchant role with full rights inside its own tenant. Different owner and staff rights are deferred (section 20).

### 18.4 Phase 1 cross-cutting scope

- Languages: Arabic (RTL) and English (LTR) (4.5, 4.6).
- Email: verification and reset codes only, through the Gmail API from the dedicated account (9, 10.3), with the outbox (10.7).
- Hosting and data: Render Free, Supabase Free PostgreSQL, Google Drive for images (10).
- No payments, no orders, no SMS, no Google sign-in, no push notifications.

## 19. Super Admin interface and boundaries (new in v4.8)

**Status of this section: PROPOSED (P-2).** v4.7 defines the Super Admin database role, credential, routes and audit rules (6.1, 6.6, 6.7, 8.7-E) but never defines what a Super Admin can do or how they do it. This section defines that, using only existing security rules. Nothing here is approved, and every existing Super Admin security requirement stays exactly as written.

### 19.1 Who is a Super Admin

- The platform operator, not a store user. A very small number of accounts (the pilot expects one).
- Identified by the `is_super_admin = true` flag with an `ACTIVE` account, re-checked in the database on every request (6.6). The flag is set only by a migration or a reviewed manual step, never by an endpoint (6.6, STM-16).
- A Super Admin who also owns a store uses a separate Merchant account. The admin role is never mixed into Merchant or Customer sessions.

### 19.2 Interface form (PROPOSED, needs your choice)

| Option | What it is | Consequence |
|---|---|---|
| **A. API only** | The `/admin/*` endpoints exist and are used with an HTTP client | Smallest surface and no new screens. Higher operator error risk, because tenant parameters and step-up prompts are typed by hand. |
| **B. Guarded admin area in the existing Flutter app (recommended)** | A small set of screens behind a `SUPER_ADMIN` route guard, using the same design system, Arabic and English. All enforcement stays on the server | No new dependency or service. Adds screens and tests to Phase 1 effort, and the admin screens ship in the same app binary (the server decides access, never the app). |
| **C. Separate web admin app** | A second front end | Needs new hosting or dependencies and a second deployment. Not recommended and not allowed without your approval. |

The functional surface in 19.3 is the same for A and B. Recommendation: B. The choice is yours.

### 19.3 Phase 1 Super Admin operations

| # | Operation | Tenant parameter | Audited | Step-up (D3, OPEN) |
|---|---|---|---|---|
| S1 | List tenants and their status | none | yes | no |
| S2 | Create a tenant (provision a store) | none (the operation creates the tenant) | yes | to be decided under D3 |
| S3 | Suspend or reactivate a tenant | explicit | yes | yes, proposed |
| S4 | Grant or revoke a Merchant membership (user, tenant, role) | explicit | yes | yes, proposed |
| S5 | View the audit log (read only) | optional filter | yes (the read is itself logged) | no |
| S6 | View system status: database ready, mail `OK` or `DEGRADED` (9.1 recovery), without calling Gmail | none | no | no |
| S7 | Start the one-time Gmail OAuth authorization (9.1.1 operator-only flow) | none | yes | to be decided under D3 |

The suspend effect reaches Guests and Customers within the 60-second tenant-resolution cache window (6.7).

### 19.4 Boundaries (what a Super Admin must not be able to do)

These add precision to the existing rules. None weakens a v4.7 requirement.

1. Admin routes only: `/admin/*`, behind `JwtAuthGuard` and `SuperAdminGuard`. The tenant parameter is accepted only there and never on public or Merchant routes (6.1, 6.7).
2. One credential: `ADMIN_DATABASE_URL` as `multistore_admin`, used only through `AdminPrismaService` inside `AdminModule` (6.6). No other module and no ordinary request reaches it.
3. No DDL, no RLS changes, no ownership, no membership in `multistore_owner` or `multistore_app` (6.6, 6.4 negative tests).
4. No impersonation: a Super Admin cannot sign in as, or act with the identity of, a Customer or a Merchant.
5. No access to secrets: no read of password hashes, refresh tokens, verification or reset codes, OAuth tokens or connection strings. These are excluded from the admin grants.
6. No rewriting history: `audit_log` grants are INSERT and SELECT only, so there is no UPDATE or DELETE for the admin role (8.7-E). Pruning under D4 is a migration-owner task.
7. No bulk export of Customer personal data in Phase 1 (deferred, section 20).
8. Phase 1 admin screens do not edit Merchant content (products, categories, images). **Proposed narrowing:** the v4.7 grant example in 6.6 is illustrative (`tenants, memberships, products, ...`). The Phase 1 grant list is the minimum for S1 to S7: write access to `tenants` and `memberships`, read access to what S1 and S6 need, INSERT and SELECT on `audit_log`. It is reviewed by the grants snapshot test (6.4). Support access to catalog data, if wanted later, is a new decision.
9. Every admin call writes an audit row (actor, tenant, operation, time), including rejected calls (6.1, 6.7). The audit trail records no secrets (6.8).
10. The honest limit in 6.6 stays: on Render Free both connection strings live in one process, so these boundaries do not defend against full process compromise.

### 19.5 Specified tests for this section (specified only, none implemented)

| ID | Test | Level |
|---|---|---|
| ADM-01 | Every operation S1 to S7 rejects a Guest, Customer and Merchant token (404 or 403) and a forged `SUPER_ADMIN` claim (STM-15, STM-17 cover the class; this covers each operation) | API |
| ADM-02 | The tenant parameter is validated server-side (tenant exists) and ignored and rejected on non-admin routes | API |
| ADM-03 | Each operation, accepted or rejected, writes exactly one audit row with actor, tenant, operation and time | Integration |
| ADM-04 | S3 and S4 are refused without a fresh step-up, once D3 is decided | API |
| ADM-05 | The admin role has no grant on password hashes, tokens, codes or credentials (grants snapshot) | Migration |
| ADM-06 | After S3 suspend, Guest and Customer access to the tenant returns 404 within 60 seconds | Integration |

## 20. Phase 1 features and deferred features (new in v4.8)

**Status: PROPOSED (P-1).** "In Phase 1" means in the product scope of section 18. It does not mean approved or scheduled. Where v4.7 already says "later" or "not in Phase 1", that is kept and cited.

### 20.1 In Phase 1

| Area | Feature | Source |
|---|---|---|
| Guest | Store entry by tenant code, branding, browse, product detail, search, Contact Store | 18.1 |
| Customer | Register, email verification, sign in, refresh, sign out, password reset, favorites, profile, settings | 18.2, 9 |
| Merchant | Store profile and branding, categories, products with drafts and publish, image upload | 18.3, 7 |
| Super Admin | Operations S1 to S7 | 19.3 |
| Platform | Arabic and English, email outbox with Gmail API, health checks, audit log, RLS, UUID standard, tests specified in 8.6 to 8.8 | 4, 5.6, 6, 8, 9, 10 |

### 20.2 Deferred (not in Phase 1)

| Feature | Why it is deferred | Source |
|---|---|---|
| Carts and orders | No cart or order feature exists in the Flutter feature list (4.2) or in the integration flows (4.4). The tenant-owned table pattern in 5.6 and 6.7 applies when they are introduced | v4.7 mentions them only as examples in 5.6, 6.7, 8.6.1, STM-03 |
| Payments of any kind | Free-tier rule, no bank card | Decision 14 |
| Google sign-in | Optional later addition | Decision 11, section 9 |
| SMS of any kind | Decided: no paid SMS | Decision 9 |
| Push notifications | Not in any v4.7 section | Not scheduled |
| Store directory or discovery of tenants | Would expose tenant names and codes; entry is by code or link | 18.1 (Proposed) |
| Platform-sent messages to stores (beyond showing contact details) | Adds outbound volume and abuse surface | 18.1 (Proposed) |
| Owner versus staff permissions inside a store | One Merchant role in Phase 1 | 18.3 (Proposed) |
| Export and analytics endpoints | No Phase 1 feature needs them. STM-05 and the export column of the cross-tenant matrix apply only if such an endpoint is ever added | 8.8 |
| Bulk export of Customer personal data by Super Admin | Not needed for S1 to S7 | 19.4 |
| Rich HTML in descriptions | OPEN decision D6; plain text in Phase 1 | 17.1, 8.6.6 |
| Supabase Storage provider, SMTP and Resend senders | Later options behind the ports | 5.5, 10.3 |
| Second service for the admin API | Does not fit the 750 free hours | 6.6, 10.6 |
| Web admin app | Option C in 19.2, not allowed without approval | 19.2 |
| Cookie-based browser sessions | The API uses bearer tokens; CSRF posture is re-verified before any cookie auth | 8.6.10, 8.9 |
| Flutter code generation, extra state libraries | Deliberately not built | 12 |
| Merchant self sign-up | Merchants are provisioned by a Super Admin in Phase 1 | 18.3 (Proposed) |

### 20.3 Effect on earlier sections

The security requirements for carts and orders are kept, not removed. They are written for when those features exist. Until then, in Phase 1 tests: STM-03 covers favorites, profile and other Customer-owned rows that exist, and the cart and order cases are deferred with the feature. The idempotency rule in 10.7 applies to register and publish in Phase 1, and to order creation when orders exist.

## 21. Implementation phases (new in v4.8)

**Nothing in this section is authorized.** These are plan steps. No phase starts until you give final implementation approval, which is separate from approving this document (section 16). "Implementation phase" (IP-n) is used here so it is not confused with "Phase 1", the product scope in section 18.

**Rules for every phase.**

- A phase starts only when its dependencies are done and its listed decisions are decided in your own words.
- A phase is done only when each acceptance criterion has evidence recorded in the test status register (section 23) and the gates it closes are PASSED with evidence (section 22.1). A criterion without evidence is not met.
- At the end of each phase the results are reported to you, including failures. Whether your implementation approval covers the whole plan or each phase separately is PROPOSED item P-4.
- No new dependency, paid service or bank card is added without your approval (section 13).

### 21.1 Summary

| Phase | Name | Depends on | Decisions needed first | Gates it closes or advances |
|---|---|---|---|---|
| IP-0 | Approvals and decision closure | Your review of this document | None | None |
| IP-1 | RLS technical spike | IP-0 (implementation approval) | None | G-01 (**closed, PASSED**, 25 Nov 2026) |
| IP-2 | Foundation: repo, lint, CI, test harness | IP-1 passed | None | Starts G-04 to G-10 evidence |
| IP-3 | Deployment and mail | IP-2 | D1, D4 | G-02, G-03 |
| IP-4 | Identity and tenancy core | IP-3 | D2 (backup in place before real data) | P0 isolation, authentication, privilege, RLS context gates |
| IP-5 | Catalog and media | IP-4 | D6 | Draft and media, upload, cache, XSS gates |
| IP-6 | Guest and Customer app | IP-4 and IP-5 | P-1 confirmed | None directly |
| IP-7 | Merchant app | IP-5 and IP-6 | P-1 confirmed | None directly |
| IP-8 | Super Admin | IP-4 | D3, P-2 confirmed | Admin boundary and audit tests |
| IP-9 | Hardening and release readiness | IP-6, IP-7, IP-8 | D5 | G-21 to G-23 and every remaining gate |

### 21.2 Phase details

**IP-0: Approvals and decision closure (no code).**
- Deliverables: your written approval decisions recorded as your words; the decision register (section 17) updated; the checklist in section 16 changed only where you explicitly approve an item.
- Acceptance: each decision shows your decision or stays OPEN or PROPOSED; no checklist item is checked without your explicit go-ahead for it.

**IP-1: RLS technical spike (throwaway code, not feature code).**
- Depends on: IP-0 with implementation approval for this step.
- Deliverables: a written spike report; throwaway code kept separate from feature code.
- Acceptance: results recorded, pass or fail, for: validation gate 1 (Supabase accepts the `NOSUPERUSER NOBYPASSRLS` role and grants in 6.6); assumption A (transaction-local `set_config` works through the pooler); assumption B (the 6.4 policy matrix passes as written); the pool-of-one interleaving test; the missing-context fail-closed tests. Procedure V-01 (22.3).
- If anything fails: stop and report to you. The application layer and isolation suite remain, the policies are adjusted, and you are told before feature work continues (6.5).

**IP-2: Foundation.**
- Depends on: IP-1 passed.
- Deliverables: monorepo structure (section 3), lint and import-boundary rules (4.5, 5.3), `api.yml` and `app.yml` with path filters (8.4), the isolation and RLS test harness, logging redaction (6.8), typed configuration, the migration lints for UUID, RLS and `app.role` (5.6, 6.4).
- Acceptance: CI runs on a trivial change; lints fail on a deliberately bad fixture; the harness connects as `multistore_app` against real PostgreSQL; the log-redaction tests pass.

**IP-3: Deployment and mail.**
- Depends on: IP-2; D1 and D4 decided.
- Deliverables: Render Free service with `/health/live` and `/health/ready` (10.7); Supabase project setup; the Gmail API adapter behind `MailSender`; the one-time authorization flow with the allowlist (9.1.1); the email outbox worker (10.7).
- Acceptance: validation gates 2 and 3 resolved (G-02, G-03); the OAuth callback tests (9.1.1) pass; outbox drains after a simulated Gmail outage and after a restart; readiness returns 503 with the database stopped and liveness stays 200.

**IP-4: Identity and tenancy core.**
- Depends on: IP-3; D2 decided and the first backup and restore rehearsal done before any real data.
- Deliverables: schema under the UUID standard; roles, grants and RLS policies as migrations (including explicit revokes so `anon`, `authenticated` and `service_role` have no privileges on application tables, 6.6); the tenant-scoped transaction runner; register, verify, login, refresh and reset; the role guards.
- Acceptance: STM-01 to STM-20 and the 6.4 and 6.6 suites implemented, executed and passed; the RLS-only rerun passes; STM-20 lint passes.

**IP-5: Catalog and media.**
- Depends on: IP-4; D6 decided.
- Deliverables: categories, products, draft and publish, image upload and serving through `StorageProvider`, cache headers and invalidation.
- Acceptance: STM-04, STM-21 to STM-23, STM-27, STM-29 passed; no response contains a Drive URL or file ID (8.3); unpublish invalidates caches.

**IP-6: Guest and Customer app.**
- Depends on: IP-4 and IP-5; P-1 confirmed.
- Deliverables: the journeys in 18.1 and 18.2 in Flutter, both languages, with widget and contract tests.
- Acceptance: the Flutter integration flows in 4.4 pass (Guest browse, Customer sign-in with verification, Contact Store); RTL and LTR widget tests pass.

**IP-7: Merchant app.**
- Depends on: IP-5 and IP-6; P-1 confirmed.
- Deliverables: the journey in 18.3.
- Acceptance: Merchant cross-tenant tests STM-01, STM-02, STM-07 pass through the app's API usage; publish rules have named tests (8.2).

**IP-8: Super Admin.**
- Depends on: IP-4; D3 decided; P-2 confirmed.
- Deliverables: operations S1 to S7 in the confirmed form (19.2), step-up per D3, audit log view.
- Acceptance: ADM-01 to ADM-06 and STM-15 to STM-18 passed; every 6.4 Super Admin negative test passed.

**IP-9: Hardening and release readiness.**
- Depends on: IP-6, IP-7, IP-8; D5 decided or escalation triggers recorded.
- Deliverables: the full security gate review (22.1), backup restore rehearsal on the final schema, load check on Render Free, dependency and secrets scans, a secret-rotation rehearsal.
- Acceptance: every P0 gate PASSED with evidence; every P1 gate PASSED for each enabled feature; P2 items have dated remediation deadlines; the release security review (V-07) is signed off by you.

## 22. Security release gates, backup and recovery, and validation procedures (new in v4.8)

This section turns 8.9 and 16.1 into gates with evidence rules, defines backup and recovery requirements, and defines how each gate is validated. It is a specification. No gate is passed, no procedure has been run, and no backup exists.

### 22.1 Security release gates

**Evidence rule.** A gate is PASSED only when the required evidence exists and is recorded in the register in section 23: the commit identifier, the CI run identifier or report file, the environment (real PostgreSQL, through the pooler where the gate says so), the date, and the person who reviewed it. Words such as "tests are green" without that record do not pass a gate. A severity label alone never passes a gate (8.9).

**Status values.** OPEN (not started), IN PROGRESS, BLOCKED (with the reason), PASSED (with evidence), FAILED (with the finding). Today every gate is **OPEN**.

| Gate | Source | Blocks | Required evidence | Status |
|---|---|---|---|---|
| G-01 | Validation gate 1 (16.1): Supabase accepts the NOBYPASSRLS role and grants and it works through the pooler | IP-2 start | V-01 spike report with the role query result and pooler test | **PASSED** (IP-1, 25 Nov 2026; Supabase PostgreSQL 17.12; evidence: `V01_pooler_report.md`, `out_nullif.txt`; recorded as passed by your decision) |
| G-02 | Validation gate 2: health check path (Render Free asked for a card; host changed to Vercel Hobby, 10.6a) | IP-3 exit | V-06 record: Vercel Hobby has no health-check path setting, so the external monitor on `/health/live` and `/health/ready` is the design; live results in the IP-3 evidence | OPEN (closes with the IP-3 evidence review) |
| G-03 | Validation gate 3: Supabase Free pause behavior | IP-3 exit, then watched | V-06 record of pause trigger, restore steps and what the first user sees | OPEN |
| G-04 | P0 Tenant isolation (application and RLS), 8.9 | Any production release | 6.4 matrix and 8.3 suite passed, including the RLS-only rerun | OPEN |
| G-05 | P0 BOLA and IDOR, STM-01 to STM-05 | Any production release | Cross-tenant and cross-user object tests passed | OPEN |
| G-06 | P0 Authentication and token lifecycle, STM-10 to STM-14 | Any production release | Token, rotation, revocation and code tests passed | OPEN |
| G-07 | P0 Privilege escalation, STM-15 to STM-17 | Any production release | Role-endpoint matrix and mass-assignment tests passed | OPEN |
| G-08 | P0 RLS context and pooling, STM-19, STM-20 | Any production release | Transaction-local context tests passed on the pooled connection | OPEN |
| G-09 | P0 Secrets exposure and information leakage, STM-30 | Any production release | Log-redaction and error-shape tests passed on success and failure | OPEN |
| G-10 | P0 Unauthorized draft and media access, STM-04, STM-23 | Any production release | Draft and media tests passed including cache paths | OPEN |
| G-11 | P0 UUID standard and schema consistency, STM-20 | Any production release | Schema and migration lints passed, insert test passed | OPEN |
| G-12 | P1 Rate limiting, STM-24 | Enabling auth and public endpoints | Threshold tests passed | OPEN |
| G-13 | P1 File upload, STM-23 | Enabling the media feature | Upload tests passed | OPEN |
| G-14 | P1 Race conditions and idempotency, STM-29 | Enabling publish, media processing, outbox | Concurrency and idempotency tests passed | OPEN |
| G-15 | P1 Cache tenant isolation, STM-27 | Enabling caching beyond 7 | Cache tests passed | OPEN |
| G-16 | P1 XSS defenses, STM-22 | Enabling catalog and branding content | Encoding and URL tests passed | OPEN |
| G-17 | P1 CORS allowlist, STM-26 | Enabling any browser-based surface | CORS tests passed | OPEN |
| G-18 | P1 Dependency and deployment security, 8.7-F (includes headers per D1 once decided) | First release | Scans green, secrets scan clean, CORS, HTTPS and headers verified | OPEN |
| G-19 | P2 Account enumeration, STM-25 | Dated deadline: before the pilot opens beyond invited users | Tests passed | OPEN |
| G-20 | P2 SSRF restriction, STM-28 | Re-verified at every feature that adds a server-side fetch | Static scan and runtime test | OPEN |
| G-21 | **New:** backup restore rehearsal (22.2, V-05) | Any production release | Rehearsal record: restore into a separate project, data checks and role tests passed | OPEN |
| G-22 | **New:** secret rotation rehearsal (22.2, V-08) | Any production release | Record that each secret in 22.2 R-8 was rotated in a rehearsal without downtime beyond the stated target | OPEN |
| G-23 | **New:** Super Admin step-up (D3) and admin boundaries, ADM-01 to ADM-06 | Enabling Super Admin sensitive operations | Tests passed after D3 is decided | OPEN |

P0 gates block any production release. P1 gates block the affected feature. P2 gates carry a dated remediation deadline agreed with you when the item is scheduled (8.9).

### 22.2 Backup and recovery requirements

**Facts checked on 25 Nov 2026** (source: https://supabase.com/docs/guides/platform/backups): Supabase takes automatic daily backups for Pro, Team and Enterprise projects only. Its page recommends that free-tier projects export their data regularly with the Supabase CLI `db dump` command and keep off-site backups. Daily backups do not store passwords for custom roles, so after a restore the passwords of custom roles must be reset. v4.7 10.1 states free projects pause after a week of low activity (not re-verified in this review).

**What must be recoverable.**

| Asset | Where it lives | Recovery mechanism | Status |
|---|---|---|---|
| PostgreSQL data | Supabase Free | Logical export and restore, option A of D2 | **OPEN (D2)** |
| Product images | The dedicated Google Drive account | Originals are not kept (7), so only resized copies exist; loss of the Drive account loses the images. Risk R-4 below | Risk recorded |
| Application secrets | Render environment variables | Rotation procedure (R-8); values held by the operator, never in the repository | Requirement |
| Gmail refresh token | Render secret | Runbook in 9.1 | Specified in 9.1 |
| Source, migrations, documentation | Git repository | The repository itself | Requirement |

**Requirements.** Each is a requirement only. None is implemented.

- R-1. Before the first real (non-seed) data enters Supabase, a backup method is decided (D2) and one backup is taken and restored successfully (V-05).
- R-2. Targets for the pilot, **PROPOSED, to be confirmed with D2**: recovery point objective (the most data we accept losing) of 7 days with option A, recovery time objective of one working day. If D2 chooses B (accept the risk), the document must record that the recovery point is "everything since the project began" and that you accepted it in your own words.
- R-3. Exports are taken before every migration run against the real project, and at least weekly.
- R-4. Exports contain personal data. They are encrypted before leaving the operator machine, stored outside Supabase with access limited to the operator, retained no longer than the retention you set under D4 for audit data and a retention you set for the exports themselves (OPEN), and never committed to the repository or sent over email.
- R-5. Restore is rehearsed into a separate free Supabase project (a second slot, see D2) and never into the live project during a rehearsal.
- R-6. Because database roles and their passwords are not restored from a dump, the restore procedure re-creates `multistore_owner`, `multistore_app` and `multistore_admin` through the owner migrations, resets their passwords from the secret store, and re-runs the role, grants and RLS tests (6.4) against the restored database before any traffic is pointed at it.
- R-7. After a restore the checks are: row counts per table against the export manifest, the grants snapshot test, the RLS policy matrix, the UUID `information_schema` snapshot, and a readiness call that connects as `multistore_app`.
- R-8. Secret rotation is documented and rehearsed for: database role passwords (all three), the JWT secret (invalidates sessions), the Google OAuth client secret and refresh tokens (9.1 runbook), and any admin credential. Rotation must not require committing a secret.
- R-9. If the Supabase project is paused (gate 3) or suspended, the recovery steps and the user-visible state (503 with a clear code, 10.7) are documented before release.
- R-10. If the dedicated Google account is locked or loses Drive data, recovery means re-uploading images from the Merchants. This is a known limit while originals are not kept; keeping originals would change the 15 GB usage in 10.2 and is a separate decision.

**Recovery scenarios the rehearsal must cover.**

| Scenario | Expected response | Referenced from |
|---|---|---|
| Bad migration or accidental deletion | Restore the latest export into a new project, re-run the role and RLS tests, switch the connection string | R-5, R-6, R-7 |
| Supabase project paused | Restore the project from the dashboard, or from an export if it is unavailable; the API reports 503 meanwhile | 10.1, 10.7, G-03 |
| Gmail token revoked | Runbook in 9.1; outbox keeps pending mail | 9.1, 10.7 |
| Render redeploy or restart | Stateless; outbox worker resumes | 10.6, 10.7 |
| Secret exposure | Rotate under R-8 | R-8 |
| Drive account locked | Images re-uploaded by Merchants | R-10 |

### 22.3 Validation procedures

Each procedure is specified only. None has been run. Each ends with recording its result in section 23 with the evidence listed.

| ID | Procedure | Steps | Pass criteria | Evidence to record |
|---|---|---|---|---|
| V-01 | RLS technical spike (IP-1, G-01) | 1. Create a throwaway Supabase project. 2. Create the three roles with the options in 6.6. 3. Apply the 6.2 policies to a test table. 4. Run the 6.4 matrix and checklist as `multistore_app` and `multistore_admin`, through the pooler. 5. Run the pool-of-one interleaving test. | Role created without error and `rolsuper = false`, `rolbypassrls = false`; every matrix cell as asserted; no context leak | Report with the query output, the commit of the throwaway code, the date |
| V-02 | Full security suite run | Run the 6.4 suite, the 8.3 isolation suite and STM tests against real PostgreSQL through the pooler, then rerun with the application filter removed | All pass; the RLS-only rerun passes | CI run identifier, test report artifact, commit, date |
| V-03 | Schema and UUID verification | Run the Prisma schema lint, migration lint, `information_schema` snapshot and insert test | All pass | CI run identifier, snapshot file, commit |
| V-04 | Role and credential boundary check | Run the 6.6 negative tests and the configuration-boundary and module scans | Every attempt fails as specified | CI run identifier, commit |
| V-05 | Backup restore rehearsal (G-21) | 1. Take an export as in R-3. 2. Restore into a separate project. 3. Apply R-6 and R-7. 4. Time the whole run. | Checks in R-7 pass; time within the R-2 target | Manifest, check output, timing, date |
| V-06 | Platform behavior check (G-02, G-03) | Set the health check path on Render; stop the database and call `/health/ready` and `/health/live`; observe sleep and cold start; observe the pause and restore of a Supabase Free project | Readiness 503 with database stopped and liveness 200; cold start and pause behavior recorded | Screenshots or logs, dates |
| V-07 | Release security review | Check every P0 and applicable P1 gate record; run the dependency audit and a secrets scan; verify CORS, HTTPS and headers on the deployed URL; confirm no secret appears in logs or build output | All gate records PASSED with evidence; scans clean | Review record signed off by you |
| V-08 | Secret rotation rehearsal (G-22) | Rotate each secret in R-8 on a rehearsal environment and confirm the system recovers | No downtime beyond the stated target; no secret in the repository or logs | Rehearsal record |

**Recording rule.** After any procedure runs, the result (Executed, Passed or Failed) goes into section 23 the same day, with the evidence. A failure is recorded as a failure.

## 23. Test status register (new in v4.8)

This register shows, for every test or suite specified in this document, four separate facts: **Specified**, **Implemented**, **Executed** and **Passed** (definitions in 8.6). The entries below are the status as of 25 Nov 2026. The "Evidence" column is empty because there is none: no code exists and nothing has been run. An entry changes only when evidence is recorded (commit, run identifier or report, environment, date). A failed run is recorded as Executed: Yes, Passed: No.

**Totals as of v4.8:** Specified: all entries below. Implemented: 0. Executed: 0. Passed: 0.

### 23.1 Security test matrix, Table 1 (section 8.8)

| ID | Threat | Level | Specified | Implemented | Executed | Passed | Evidence |
|---|---|---|---|---|---|---|---|
| STM-01 | IDOR/BOLA | API | Yes | No | No | No | None |
| STM-02 | IDOR/BOLA | API | Yes | No | No | No | None |
| STM-03 | IDOR/BOLA | API | Yes | No | No | No | None |
| STM-04 | IDOR/BOLA | API | Yes | No | No | No | None |
| STM-05 | IDOR/BOLA | API | Yes | No | No | No | None |
| STM-06 | Tenant isolation | API | Yes | No | No | No | None |
| STM-07 | Tenant isolation | API | Yes | No | No | No | None |
| STM-08 | Tenant isolation | Integration | Yes | No | No | No | None |
| STM-09 | Tenant isolation | Integration | Yes | No | No | No | None |
| STM-10 | Authentication | API | Yes | No | No | No | None |
| STM-11 | Authentication | API | Yes | No | No | No | None |
| STM-12 | Authentication | API | Yes | No | No | No | None |
| STM-13 | Authentication | API | Yes | No | No | No | None |
| STM-14 | Authentication | API | Yes | No | No | No | None |
| STM-15 | Privilege escalation | API | Yes | No | No | No | None |
| STM-16 | Privilege escalation | API | Yes | No | No | No | None |
| STM-17 | Privilege escalation | API | Yes | No | No | No | None |
| STM-18 | Credential isolation | Configuration / Unit | Yes | No | No | No | None |
| STM-19 | RLS pooling | Integration | Yes | No | No | No | None |
| STM-20 | RLS / UUID schema | Migration | Yes | No | No | No | None |
| STM-21 | SQL injection | API | Yes | No | No | No | None |
| STM-22 | XSS | API + Unit | Yes | No | No | No | None |
| STM-23 | File upload | API | Yes | No | No | No | None |
| STM-24 | Rate limiting | API | Yes | No | No | No | None |
| STM-25 | Account enumeration | API | Yes | No | No | No | None |
| STM-26 | CSRF / CORS | Configuration / API | Yes | No | No | No | None |
| STM-27 | Cache leakage | Integration | Yes | No | No | No | None |
| STM-28 | SSRF | Configuration | Yes | No | No | No | None |
| STM-29 | Race / duplicates | Integration | Yes | No | No | No | None |
| STM-30 | Information leakage | API | Yes | No | No | No | None |

### 23.2 Suites and groups of tests specified elsewhere

| Group | Where specified | Level | Specified | Implemented | Executed | Passed | Evidence |
|---|---|---|---|---|---|---|---|
| RLS policy matrix, every role, every operation, every tenant table | 6.4 | Integration (database) | Yes | No | No | No | None |
| RLS security validation checklist: database grants, role separation, Super Admin connection isolation, transaction-local context, tenant switching, missing or invalid context, write safety, policy hygiene | 6.4 | Integration (database) | Yes | No | No | No | None |
| Super Admin negative tests and credential-separation tests | 6.4, 6.6 | Integration, Configuration | Yes | No | No | No | None |
| Secrets and logging redaction tests (log redaction, successful requests, failed requests, error responses, OAuth tokens) | 6.8 | Integration | Yes | No | No | No | None |
| Cross-tenant isolation suite, including the rerun with the application filter removed | 8.3 | API | Yes | No | No | No | None |
| Cross-tenant matrix, Table 2 | 8.8 | API | Yes | No | No | No | None |
| UUID validation checks: schema lint, migration lint, insert test, API test | 5.6 | Lint, Migration, Integration, API | Yes | No | No | No | None |
| OAuth callback allowlist tests | 9.1.1 | Integration | Yes | No | No | No | None |
| Render reliability tests: readiness and liveness, outbox retry and drain, invalid_grant circuit, idempotency, timeouts | 10.7 | Integration | Yes | No | No | No | None |
| Flutter tests: use case, notifier, widget (AR RTL and EN LTR), repository, routing guards | 4.4, 8.1 | Unit, Widget | Yes | No | No | No | None |
| Flutter integration flows: Guest browse, Customer sign-in with verification, Contact Store | 4.4, 8.1 | E2E | Yes | No | No | No | None |
| Storage and mail contract tests | 5.5, 8.1 | Integration | Yes | No | No | No | None |
| Coverage gate: 80% on domain and application code | 8.2 | CI gate | Yes | No | No | No | None |
| Critical-path list: every entry has a test that names it | 8.2 | Review rule | Yes | No | No | No | None |
| Super Admin tests ADM-01 to ADM-06 | 19.5 | API, Integration, Migration | Yes | No | No | No | None |
| Validation procedures V-01 to V-08 (these are procedures, not automated tests) | 22.3 | Procedure | Yes | No | No | No | None |

### 23.3 How to update this register

1. A row changes only when the evidence exists. Write the commit, the CI run identifier or report file, the environment and the date in the Evidence column.
2. Mark **Implemented** when the test code is in the repository. Mark **Executed** when it has run against real infrastructure and the result is recorded. Mark **Passed** only when it was executed and every assertion held.
3. If a run fails, set Executed to Yes and Passed to No, and record the failure. Never change a failed result to a pass without a new recorded run.
4. A report to you states the exact state, for example "implemented and executed, 3 failed", never "tests done" or "tests green".
5. A gate in 22.1 can be PASSED only when every test it depends on shows Passed here.
