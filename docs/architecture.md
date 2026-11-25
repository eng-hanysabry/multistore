# Architecture
Two independent projects (spec 3). Backend: NestJS modules with `presentation / application / domain / infrastructure` layers (5.1 to 5.3). Frontend: feature-first Clean Architecture with Riverpod (4.1 to 4.5).

Dependency rules enforced in CI:
- Backend: `eslint-plugin-boundaries` (layering and no cross-module internals, see `api/eslint.config.mjs`), absolute rule that `domain/` imports no `@nestjs/*`, `@prisma/*`, `pg` (tested in `api/test/unit/import-boundaries.spec.ts`).
- Frontend: `app/tool/check_boundaries.dart` (domain has no Flutter or dio, screens never import dio, design_system imports only Flutter, tokens, theme and layout, features reach each other only through barrel files, directional insets only).
- Tenant isolation: PostgreSQL RLS policies per spec 6.2 (v4.9 `NULLIF` form), tested against real PostgreSQL in `api/test/rls`.
