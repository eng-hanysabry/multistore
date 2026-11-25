/** @type {import('jest').Config} */
const base = { preset: 'ts-jest', testEnvironment: 'node', rootDir: '.' };
module.exports = {
  projects: [
    { ...base, displayName: 'unit', testMatch: ['<rootDir>/test/unit/**/*.spec.ts'] },
    { ...base, displayName: 'rls', testMatch: ['<rootDir>/test/rls/**/*.rls.spec.ts'], testTimeout: 30000 },
  ],
  collectCoverageFrom: ['src/**/*.ts', 'scripts/migration-lints.ts', '!src/main.ts'],
  coverageThreshold: { global: { lines: 80, statements: 80, functions: 80, branches: 70 } },
};
