import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const mods = join(root, 'src', 'modules');

function lint(files: Record<string, string>): { rule: string; file: string }[] {
  try {
    for (const m of ['zzcatalog', 'zzorders']) {
      mkdirSync(join(mods, m), { recursive: true });
      writeFileSync(join(mods, m, 'placeholder.ts'), 'export const ph = 1;\n');
    }
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(join(mods, rel, '..'), { recursive: true });
      writeFileSync(join(mods, rel), text);
    }
    let stdout = '';
    try {
      stdout = execFileSync(
        'npx',
        ['eslint', '--format', 'json', 'src/modules/zzcatalog', 'src/modules/zzorders'],
        {
          cwd: root,
          encoding: 'utf8',
        },
      );
    } catch (e) {
      stdout = (e as { stdout: string }).stdout;
    }
    const results = JSON.parse(stdout) as {
      filePath: string;
      messages: { ruleId: string | null }[];
    }[];
    return results.flatMap((r) =>
      r.messages.map((m) => ({
        rule: m.ruleId ?? 'parse',
        file: r.filePath.replace(`${mods}/`, ''),
      })),
    );
  } finally {
    for (const m of ['zzcatalog', 'zzorders'])
      rmSync(join(mods, m), { recursive: true, force: true });
  }
}

describe('import boundaries (5.3), enforced by eslint-plugin-boundaries', () => {
  jest.setTimeout(120000);
  it('domain/ must not import @nestjs/* or @prisma/* (absolute rule)', () => {
    const r = lint({
      'zzcatalog/domain/a.ts':
        "import { Injectable } from '@nestjs/common';\nexport const x = Injectable;\n",
    });
    expect(r.map((m) => m.rule)).toContain('no-restricted-imports');
  });
  it('a module may not import another module internals (infrastructure)', () => {
    const r = lint({
      'zzorders/infrastructure/repo.ts': 'export const repo = 1;\n',
      'zzcatalog/application/use.ts':
        "import { repo } from '../../zzorders/infrastructure/repo';\nexport const y = repo;\n",
    });
    expect(
      r.some((m) => m.rule === 'boundaries/dependencies' && m.file.startsWith('zzcatalog/')),
    ).toBe(true);
  });
  it('domain may not import its own infrastructure or application', () => {
    const r = lint({
      'zzcatalog/infrastructure/repo.ts': 'export const repo = 1;\n',
      'zzcatalog/domain/entity.ts':
        "import { repo } from '../infrastructure/repo';\nexport const z = repo;\n",
    });
    expect(r.some((m) => m.rule === 'boundaries/dependencies')).toBe(true);
  });
  it('compliant layering passes: application -> domain within one module', () => {
    const r = lint({
      'zzcatalog/domain/entity.ts': 'export interface Product { id: string }\n',
      'zzcatalog/application/use.ts':
        "import type { Product } from '../domain/entity';\nexport const p = (x: Product): string => x.id;\n",
    });
    expect(r).toEqual([]);
  });
});
