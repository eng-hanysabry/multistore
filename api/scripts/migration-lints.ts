/**
 * Migration and source lints (spec 5.6, 6.4, 6.2). Pure functions over text so they can be tested
 * with good and bad fixtures. Each returns a list of violations; empty means clean.
 */
export interface Violation {
  rule: string;
  detail: string;
}

const stripComments = (sql: string): string =>
  sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** Statement-level split on semicolons (migrations here do not use dollar-quoted bodies for DDL). */
const statements = (sql: string): string[] =>
  stripComments(sql)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

export function lintMigrationSql(sqlFiles: Record<string, string>): Violation[] {
  const out: Violation[] = [];
  const all = Object.values(sqlFiles).flatMap(statements);
  const tenantTables = new Set<string>();
  const enabled = new Set<string>();
  const forced = new Set<string>();

  for (const st of all) {
    const ct =
      /^create\s+table\s+(?:if\s+not\s+exists\s+)?(?:\w+\.)?"?(\w+)"?\s*\(([\s\S]*)\)$/i.exec(st);
    if (ct) {
      const table = ct[1] as string;
      const body = ct[2] as string;
      // split top-level columns
      const cols: string[] = [];
      let depth = 0;
      let cur = '';
      for (const ch of body) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && depth === 0) {
          cols.push(cur.trim());
          cur = '';
        } else cur += ch;
      }
      if (cur.trim()) cols.push(cur.trim());
      let hasId = false;
      for (const col of cols) {
        const m = /^"?(\w+)"?\s+([a-z_]+(?:\([^)]*\))?(?:\[\])?)/i.exec(col);
        if (!m || /^(primary|foreign|unique|check|constraint)\b/i.test(col)) continue;
        const name = (m[1] as string).toLowerCase();
        const type = (m[2] as string).toLowerCase();
        if (name === 'id') {
          hasId = true;
          if (type !== 'uuid')
            out.push({ rule: 'uuid-pk', detail: `${table}.id must be uuid, is ${type}` });
          if (/\bdefault\b/i.test(col)) {
            out.push({
              rule: 'no-id-default',
              detail: `${table}.id must have no database-side default`,
            });
          }
          if (!/primary\s+key/i.test(col))
            out.push({ rule: 'uuid-pk', detail: `${table}.id must be the primary key` });
        } else if (name === 'tenant_id' || name.endsWith('_id')) {
          if (type !== 'uuid')
            out.push({ rule: 'uuid-fk', detail: `${table}.${name} must be uuid, is ${type}` });
        }
        if (name === 'tenant_id') tenantTables.add(table);
      }
      if (!hasId) out.push({ rule: 'uuid-pk', detail: `${table} has no id column` });
    }
    const en =
      /^alter\s+table\s+(?:only\s+)?(?:\w+\.)?"?(\w+)"?\s+enable\s+row\s+level\s+security$/i.exec(
        st,
      );
    if (en) enabled.add(en[1] as string);
    const fo =
      /^alter\s+table\s+(?:only\s+)?(?:\w+\.)?"?(\w+)"?\s+force\s+row\s+level\s+security$/i.exec(
        st,
      );
    if (fo) forced.add(fo[1] as string);

    const pol = /^create\s+policy\s+"?(\w+)"?\s+on\s+(?:\w+\.)?"?(\w+)"?([\s\S]*)$/i.exec(st);
    if (pol) {
      const [, name, table, rest] = pol as unknown as [string, string, string, string];
      if (/\bto\s+multistore_app\b/i.test(rest) && !/current_setting\(\s*'app\.role'/i.test(rest)) {
        out.push({
          rule: 'policy-app-role',
          detail: `policy ${name} on ${table} (multistore_app) has no app.role check`,
        });
      }
    }
  }
  for (const t of tenantTables) {
    if (!enabled.has(t))
      out.push({ rule: 'rls-enabled', detail: `${t} has tenant_id but RLS is not enabled` });
    if (!forced.has(t))
      out.push({ rule: 'rls-forced', detail: `${t} has tenant_id but RLS is not forced` });
  }
  const joined = Object.values(sqlFiles).map(stripComments).join('\n');
  const cast = /current_setting\(\s*'app\.(tenant_id|user_id)'[^)]*\)\s*::\s*uuid/gi;
  for (const m of joined.matchAll(cast)) {
    out.push({
      rule: 'nullif-uuid-cast',
      detail: `app.${m[1]} cast to uuid without NULLIF(..., '')`,
    });
  }
  return out;
}

/** Source rule (spec 6.4): set_config only with the local flag true; no SET / SET SESSION. */
export function lintContextSource(files: Record<string, string>): Violation[] {
  const out: Violation[] = [];
  for (const [file, text] of Object.entries(files)) {
    for (const m of text.matchAll(/set_config\s*\(([^)]*)\)/gi)) {
      const args = (m[1] as string).split(',').map((a) => a.trim().toLowerCase());
      if (
        args[args.length - 1] !== 'true' &&
        !/\$\{[^}]*\}\s*,\s*true$/i.test((m[1] as string).trim())
      ) {
        out.push({
          rule: 'set-config-local',
          detail: `${file}: set_config without local flag true`,
        });
      }
    }
    if (/\bSET\s+SESSION\b/i.test(text) || /`\s*SET\s+(?!LOCAL)[\w.]+\s*(=|TO)/i.test(text)) {
      out.push({ rule: 'no-session-set', detail: `${file}: SET / SET SESSION is not allowed` });
    }
  }
  return out;
}
