import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

const own = (type) => ({ to: { element: { type, captured: { module: '{{ from.element.captured.module }}' } } } });
const any = (type) => ({ to: { element: { type } } });

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'test/lint-fixtures/**', 'eslint.config.mjs', 'jest.config.js'] },
  ...tseslint.configs.strict,
  {
    files: ['**/*.ts'],
    languageOptions: { parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname } },
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'domain', pattern: 'src/modules/*/domain', capture: ['module'] },
        { type: 'application', pattern: 'src/modules/*/application', capture: ['module'] },
        { type: 'presentation', pattern: 'src/modules/*/presentation', capture: ['module'] },
        { type: 'infrastructure-module', pattern: 'src/modules/*/infrastructure', capture: ['module'] },
        { type: 'common', pattern: 'src/common' },
        { type: 'infrastructure', pattern: 'src/infrastructure' },
      ],
      'boundaries/include': ['src/**/*.ts'],
      'import/resolver': { node: { extensions: ['.ts', '.js'] } },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
      // Spec 5.3: layering and module independence. checkInternals so same-layer files are also checked.
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            { from: { element: { type: 'domain' } }, allow: [own('domain'), any('common')] },
            { from: { element: { type: 'application' } }, allow: [own('application'), own('domain'), any('common')] },
            { from: { element: { type: 'presentation' } }, allow: [own('presentation'), own('application'), own('domain'), any('common')] },
            { from: { element: { type: 'infrastructure-module' } }, allow: [own('infrastructure-module'), own('domain'), any(['common', 'infrastructure'])] },
            { from: { element: { type: 'common' } }, allow: any('common') },
            { from: { element: { type: 'infrastructure' } }, allow: any(['common', 'infrastructure']) },
          ],
        },
      ],
    },
  },
  {
    // Spec 5.3 rule 3, absolute: domain/ imports nothing from @nestjs/* or @prisma/*.
    files: ['src/modules/*/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['@nestjs/*', '@prisma/*', 'prisma', 'pg'], message: 'domain/ must not import framework or database packages (spec 5.3).' }] }],
    },
  },
  {
    files: ['test/**/*.ts', 'scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
