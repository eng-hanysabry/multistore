/** @type {import('jest').Config} */
const base = { preset: 'ts-jest', testEnvironment: 'node', rootDir: '.' };
module.exports = {
  projects: [
    { ...base, displayName: 'unit', testMatch: ['<rootDir>/test/unit/**/*.spec.ts'] },
    {
      ...base,
      displayName: 'rls',
      testMatch: ['<rootDir>/test/rls/**/*.rls.spec.ts'],
      testTimeout: 30000,
    },
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    'scripts/migration-lints.ts',
    '!src/main.ts',
    '!src/**/*.module.ts',
    '!src/**/google-*.ts',
    '!src/infrastructure/prisma/prisma.service.ts',
    '!src/**/ports/*.ts',
    '!src/**/domain/oauth-ports.ts',
  ], // wiring and thin vendor adapters, exercised by the deploy check,
  coverageThreshold: { global: { lines: 80, statements: 80, functions: 80, branches: 70 } },
};
