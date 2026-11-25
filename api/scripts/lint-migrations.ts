import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { lintContextSource, lintMigrationSql } from './migration-lints';

const root = join(__dirname, '..');

function walk(dir: string, ext: string, acc: Record<string, string> = {}): Record<string, string> {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, acc);
    else if (p.endsWith(ext)) acc[p] = readFileSync(p, 'utf8');
  }
  return acc;
}

const sql = walk(join(root, 'prisma', 'migrations'), '.sql');
const src = walk(join(root, 'src'), '.ts');
const violations = [...lintMigrationSql(sql), ...lintContextSource(src)];
for (const v of violations) console.error(`[${v.rule}] ${v.detail}`);
console.log(
  `migration lint: ${Object.keys(sql).length} sql files, ${Object.keys(src).length} source files, ${violations.length} violations`,
);
process.exit(violations.length > 0 ? 1 : 0);
