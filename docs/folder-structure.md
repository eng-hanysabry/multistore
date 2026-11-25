# Folder structure
```
api/      NestJS (own package.json, lockfile, tsconfig, eslint, jest)
  src/common/{config,logging,errors}   typed config, redaction logger, safe errors (IP-2)
  scripts/                             migration lints, OpenAPI generation
  test/{unit,rls}                      unit tests, database-level RLS harness
app/      Flutter (own pubspec.yaml, lockfile, analysis_options)
  lib/{core,design_system,features,l10n}
  tool/   import-boundary checker, test/ mirrors lib/
contracts/openapi.json                 the only shared artifact
docs/                                  this folder
.github/workflows/{api,app}.yml        separate, path-filtered pipelines
```
Later phases add `api/prisma`, `api/src/infrastructure`, `api/src/modules/*` and `app/lib/features/*` exactly as in spec 4.2 and 5.2.
