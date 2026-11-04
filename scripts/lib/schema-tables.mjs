/**
 * schema-tables.mjs — the table inventory of the database, read from the repo.
 *
 * The schema of record is `supabase/baseline.sql` (a pg_dump of production,
 * 9 Sept 2026) plus every TIMESTAMPED migration applied on top of it, oldest
 * first — exactly what CI's `db` job builds. The sequential migrations
 * (001–148) are historical and cannot rebuild the schema
 * (docs/SCHEMA-BASELINE.md), so they are not read here.
 *
 * For each table this records the columns, whether RLS is enabled, which
 * columns lead an index and its triggers (enabled or not). It is a
 * regex/statement parser, not a SQL engine: it understands the shapes this
 * repo actually uses (CREATE TABLE, ALTER TABLE … ADD COLUMN / RENAME TO /
 * ENABLE ROW LEVEL SECURITY / ENABLE|DISABLE TRIGGER, DROP TABLE, CREATE
 * [UNIQUE] INDEX, PRIMARY KEY / UNIQUE constraints).
 *
 * FAIL CLOSED for new migrations. A parser that silently skips what it does
 * not understand is a gate with a hole in it: `CREATE TABLE … AS SELECT`,
 * `PARTITION OF`, DDL run from a DO block or a function (`EXECUTE '…'` or
 * static), `SELECT … INTO`, `session_replication_role`, a trigger disabled
 * and never re-enabled. With `strict` (the caller sets it for migrations at
 * or after S3), every such statement is reported in `issues` instead of
 * being ignored; scripts/check-migration-tenancy.mjs turns each into a
 * failure unless it is allowlisted there with a reason.
 *
 * Used by scripts/check-migration-tenancy.mjs and lib/tenancy/registry.test.ts
 * (multi-tenancy plan S3). Dependency-free so Node runs it directly.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { splitStatements } from '../check-migration-security.mjs'

export const BASELINE = 'supabase/baseline.sql'
export const MIGRATIONS_DIR = 'supabase/migrations'
export const TIMESTAMPED = /^\d{14}_.+\.sql$/

/** Schemas whose tables the registry must classify. */
export const SCHEMAS = ['public', 'entitlements']

const IDENT = String.raw`(?:"[^"]+"|[a-z0-9_]+)`
const QUALIFIED = String.raw`(?:(${IDENT})\s*\.\s*)?(${IDENT})`

const unquote = (s) => s.replace(/^"|"$/g, '').toLowerCase()

/** `schema.table`, defaulting the schema to public. */
export function qualify(schema, table) {
  return `${schema ? unquote(schema) : 'public'}.${unquote(table)}`
}

/** Split a CREATE TABLE body on top-level commas (ignores commas in parens). */
function splitColumns(body) {
  const parts = []
  let depth = 0
  let cur = ''
  for (const c of body) {
    if (c === '(') depth++
    if (c === ')') depth--
    if (c === ',' && depth === 0) {
      parts.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

const CONSTRAINT_START = /^(constraint|primary\s+key|unique|check|foreign\s+key|exclude|like)\b/i

function newTable(name, source) {
  return { name, source, columns: new Set(), rls: false, indexed: new Set(), triggers: new Map() }
}

/**
 * DDL that, inside a DO block or a function body, the parser cannot follow —
 * whether it runs through EXECUTE or as a static plpgsql statement.
 */
const PLPGSQL_DDL = new RegExp(
  [
    String.raw`create\s+(?:unlogged\s+)?table`,
    String.raw`create\s+materialized\s+view`,
    String.raw`alter\s+table`,
    String.raw`drop\s+table`,
    String.raw`alter\s+trigger`,
    String.raw`(?:enable|disable)\s+(?:always\s+|replica\s+)?trigger`,
    String.raw`row\s+level\s+security`,
    String.raw`session_replication_role`,
    String.raw`drop\s+index`,
  ].map((r) => String.raw`\b${r}\b`).join('|'),
  'i',
)

/** Index of the parenthesis closing the one at `open`. */
function closingParen(s, open) {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++
    if (s[i] === ')') depth--
    if (depth === 0) return i
  }
  return s.length
}

/**
 * The statement shapes a strict (S3-or-later) migration may not use without
 * an allowlist entry, because the inventory cannot follow them. Returns an
 * issue kind, or null. Checked before the statement is applied.
 */
export function unparsedKind(s) {
  if (/^do\b/i.test(s) || /^create\s+(?:or\s+replace\s+)?(?:function|procedure)\b/i.test(s)) {
    return PLPGSQL_DDL.test(s) ? 'ddl-in-plpgsql' : null
  }
  if (/\bsession_replication_role\b/i.test(s)) return 'session-replication-role'
  if (/^create\s+(?:(?:global|local)\s+)?(?:temp|temporary)\s+table\b/i.test(s)) return null
  if (/^create\s+(?:unlogged\s+)?table\b/i.test(s)) {
    const m = new RegExp(String.raw`^create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${QUALIFIED}\s*\(`, 'i').exec(s)
    if (!m) return 'create-table-form' // AS SELECT, PARTITION OF, OF type, …
    const tail = s.slice(closingParen(s, m.index + m[0].length - 1) + 1)
    if (/\b(?:as|inherits|partition\s+of)\b/i.test(tail)) return 'create-table-form'
    return null
  }
  if (/^create\s+materialized\s+view\b/i.test(s)) return 'materialized-view'
  if (/^(?:select|with)\b/i.test(s) && /(?<!\b(?:insert|merge)\s+)\binto\b/i.test(s)) return 'select-into'
  if (/^alter\s+trigger\b/i.test(s)) return 'alter-trigger'
  if (/^alter\s+table\b/i.test(s) && /\b(?:set\s+schema|inherit|attach\s+partition)\b/i.test(s)) return 'alter-table-form'
  if (/^drop\s+index\b/i.test(s) && /tenant_id/i.test(s)) return 'drop-tenant-index'
  return null
}

/**
 * Apply one SQL file's statements to the inventory (a Map name -> table).
 * `source` is recorded on tables the file creates.
 *
 * opts.strict: report every statement the inventory cannot follow, and every
 * trigger the file disables without re-enabling, into opts.issues as
 * `{ source, kind, statement }`.
 */
export function applySql(tables, sql, source, opts = {}) {
  const { strict = false, issues = [] } = opts
  /** Triggers this file disabled: `table|name` (name '*' for ALL/USER). */
  const disabledHere = new Map()
  for (const { text } of splitStatements(sql)) {
    const s = text.replace(/\s+/g, ' ').trim()
    let m

    if (strict) {
      const kind = unparsedKind(s)
      if (kind) issues.push({ source, kind, statement: s.length > 160 ? `${s.slice(0, 157)}...` : s })
    }

    // DO $$ … FOREACH t IN ARRAY ARRAY['a', 'b'] LOOP EXECUTE format('ALTER
    // TABLE public.%I ENABLE ROW LEVEL SECURITY', t) … $$ — the post-event
    // survey shape. Only that shape is understood: the array's names are the
    // tables the loop enables RLS on.
    if (/^do\b/i.test(s) && /alter\s+table\s+public\.%I\s+enable\s+row\s+level\s+security/i.test(s)) {
      const arr = /array\s*\[([^\]]+)\]/i.exec(s)
      if (arr) {
        for (const lit of arr[1].matchAll(/'([a-z0-9_]+)'/gi)) {
          const t = tables.get(qualify(null, lit[1]))
          if (t) t.rls = true
        }
      }
      continue
    }

    // CREATE TABLE [IF NOT EXISTS] x ( ... ) [PARTITION BY ...]
    if ((m = new RegExp(String.raw`^create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${QUALIFIED}\s*\(`, 'i').exec(s))) {
      const name = qualify(m[1], m[2])
      const open = s.indexOf('(', m.index + m[0].length - 1)
      let depth = 0
      let end = open
      for (let i = open; i < s.length; i++) {
        if (s[i] === '(') depth++
        if (s[i] === ')') depth--
        if (depth === 0) {
          end = i
          break
        }
      }
      const t = tables.get(name) ?? newTable(name, source)
      for (const part of splitColumns(s.slice(open + 1, end))) {
        const pk = /^(?:constraint\s+\S+\s+)?(?:primary\s+key|unique)\s*\(\s*([^),\s]+)/i.exec(part)
        if (pk) t.indexed.add(unquote(pk[1]))
        if (CONSTRAINT_START.test(part)) continue
        const col = new RegExp(`^(${IDENT})\\s`, 'i').exec(part + ' ')
        if (!col) continue
        const cname = unquote(col[1])
        t.columns.add(cname)
        if (/\b(primary\s+key|unique)\b/i.test(part)) t.indexed.add(cname)
      }
      tables.set(name, t)
      continue
    }

    // CREATE [OR REPLACE] [CONSTRAINT] TRIGGER name … ON x … EXECUTE FUNCTION|PROCEDURE fn(args)
    if ((m = new RegExp(String.raw`^create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+(${IDENT})\s.*?\son\s+${QUALIFIED}\s.*?execute\s+(?:function|procedure)\s+${QUALIFIED}\s*\(([^)]*)\)`, 'i').exec(s))) {
      const t = tables.get(qualify(m[2], m[3]))
      if (t) {
        t.triggers.set(unquote(m[1]), {
          function: qualify(m[4], m[5]),
          args: m[6].split(',').map((a) => a.trim().replace(/^'|'$/g, '')).filter(Boolean),
          definition: s,
          enabled: true,
        })
      }
      continue
    }
    if ((m = new RegExp(String.raw`^drop\s+trigger\s+(?:if\s+exists\s+)?(${IDENT})\s+on\s+${QUALIFIED}`, 'i').exec(s))) {
      tables.get(qualify(m[2], m[3]))?.triggers.delete(unquote(m[1]))
      continue
    }

    // DROP TABLE [IF EXISTS] a, b
    if ((m = /^drop\s+table\s+(?:if\s+exists\s+)?(.+?)(?:\s+(?:cascade|restrict))?$/i.exec(s))) {
      for (const raw of m[1].split(',')) {
        const parts = raw.trim().split('.')
        tables.delete(parts.length === 2 ? qualify(parts[0], parts[1]) : qualify(null, parts[0]))
      }
      continue
    }

    // CREATE [UNIQUE] INDEX [CONCURRENTLY] [IF NOT EXISTS] name ON [ONLY] x [USING m] (col, ...)
    if ((m = new RegExp(String.raw`^create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?(?:${IDENT}\s+)?on\s+(?:only\s+)?${QUALIFIED}(?:\s+using\s+\w+)?\s*\(\s*(${IDENT})`, 'i').exec(s))) {
      const t = tables.get(qualify(m[1], m[2]))
      if (t) t.indexed.add(unquote(m[3]))
      continue
    }

    // ALTER TABLE [IF EXISTS] [ONLY] x <actions>
    if ((m = new RegExp(String.raw`^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${QUALIFIED}\s+(.*)$`, 'i').exec(s))) {
      const name = qualify(m[1], m[2])
      const rest = m[3]
      const t = tables.get(name)
      let r
      if ((r = new RegExp(`^rename\\s+to\\s+(${IDENT})`, 'i').exec(rest))) {
        if (t) {
          tables.delete(name)
          const renamed = `${name.split('.')[0]}.${unquote(r[1])}`
          t.name = renamed
          tables.set(renamed, t)
        }
        continue
      }
      // [ENABLE [ALWAYS|REPLICA] | DISABLE] TRIGGER name|ALL|USER (one or more
      // actions). Tracked even on a table the inventory does not know, so a
      // strict file cannot switch a trigger off unseen.
      for (const tr of rest.matchAll(new RegExp(`\\b(enable|disable)\\s+(?:always\\s+|replica\\s+)?trigger\\s+(${IDENT})`, 'gi'))) {
        const on = tr[1].toLowerCase() === 'enable'
        const which = unquote(tr[2])
        const all = which === 'all' || which === 'user'
        if (t) {
          for (const tname of all ? [...t.triggers.keys()] : [which]) {
            const trg = t.triggers.get(tname)
            if (trg) trg.enabled = on
          }
        }
        const key = `${name}|${all ? '*' : which}`
        if (!on) {
          disabledHere.set(key, s)
        } else if (all) {
          // ENABLE TRIGGER ALL/USER re-enables everything this file disabled on the table.
          for (const k of [...disabledHere.keys()]) {
            if (k.startsWith(`${name}|`)) disabledHere.delete(k)
          }
        } else {
          disabledHere.delete(key)
        }
      }
      if (!t) continue
      if (/enable\s+row\s+level\s+security/i.test(rest)) t.rls = true
      if (/disable\s+row\s+level\s+security/i.test(rest)) t.rls = false
      for (const action of splitColumns(rest)) {
        let a
        if ((a = new RegExp(`^add\\s+(?:column\\s+)?(?:if\\s+not\\s+exists\\s+)?(${IDENT})\\s`, 'i').exec(action + ' '))) {
          const cname = unquote(a[1])
          if (!/^(constraint|primary|unique|check|foreign|exclude)$/i.test(cname)) {
            t.columns.add(cname)
            if (/\b(primary\s+key|unique)\b/i.test(action)) t.indexed.add(cname)
            continue
          }
        }
        if ((a = /add\s+(?:constraint\s+\S+\s+)?(?:primary\s+key|unique)\s*\(\s*([^),\s]+)/i.exec(action))) {
          t.indexed.add(unquote(a[1]))
          continue
        }
        if ((a = new RegExp(`^drop\\s+column\\s+(?:if\\s+exists\\s+)?(${IDENT})`, 'i').exec(action))) {
          t.columns.delete(unquote(a[1]))
          continue
        }
        if ((a = new RegExp(`^rename\\s+(?:column\\s+)?(${IDENT})\\s+to\\s+(${IDENT})`, 'i').exec(action))) {
          if (t.columns.delete(unquote(a[1]))) t.columns.add(unquote(a[2]))
        }
      }
    }
  }
  if (strict) {
    for (const [key, statement] of disabledHere) {
      issues.push({ source, kind: 'trigger-left-disabled', statement: `${key.replace('|', ': trigger ')} — ${statement}` })
    }
  }
  return tables
}

/** The ordered list of SQL sources: baseline, then timestamped migrations. */
export function schemaSources(root = '.') {
  const files = readdirSync(`${root}/${MIGRATIONS_DIR}`)
    .filter((f) => TIMESTAMPED.test(f))
    .sort()
  return [
    { name: BASELINE, sql: readFileSync(`${root}/${BASELINE}`, 'utf8') },
    ...files.map((f) => ({ name: f, sql: readFileSync(`${root}/${MIGRATIONS_DIR}/${f}`, 'utf8') })),
  ]
}

/**
 * The current table inventory (Map `schema.table` -> table) for `SCHEMAS`,
 * plus the statements it could not follow in migrations whose 14-digit
 * version is >= `strictFrom` (none when it is omitted).
 *
 * @param {string} [root]
 * @param {string | null} [strictFrom]
 */
export function readSchemaInventory(root = '.', strictFrom = null) {
  const tables = new Map()
  const issues = []
  for (const { name, sql } of schemaSources(root)) {
    const strict = strictFrom != null && TIMESTAMPED.test(name) && name.slice(0, 14) >= strictFrom
    applySql(tables, sql, name, { strict, issues })
  }
  for (const key of [...tables.keys()]) {
    if (!SCHEMAS.includes(key.split('.')[0])) tables.delete(key)
  }
  return { tables, issues }
}

/** The current table inventory (Map `schema.table` -> table) for `SCHEMAS`. */
export function readSchemaTables(root = '.') {
  return readSchemaInventory(root).tables
}
