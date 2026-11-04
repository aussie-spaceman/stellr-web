/**
 * schema-tables.mjs — the table inventory of the database, read from the repo.
 *
 * The schema of record is `supabase/baseline.sql` (a pg_dump of production,
 * 9 Sept 2026) plus every TIMESTAMPED migration applied on top of it, oldest
 * first — exactly what CI's `db` job builds. The sequential migrations
 * (001–148) are historical and cannot rebuild the schema
 * (docs/SCHEMA-BASELINE.md), so they are not read here.
 *
 * For each table this records the columns, whether RLS is enabled and which
 * columns lead an index. It is a regex/statement parser, not a SQL engine: it
 * understands the shapes this repo actually uses (CREATE TABLE, ALTER TABLE …
 * ADD COLUMN / RENAME TO / ENABLE ROW LEVEL SECURITY, DROP TABLE, CREATE
 * [UNIQUE] INDEX, PRIMARY KEY / UNIQUE constraints).
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
 * Apply one SQL file's statements to the inventory (a Map name -> table).
 * `source` is recorded on tables the file creates.
 */
export function applySql(tables, sql, source) {
  for (const { text } of splitStatements(sql)) {
    const s = text.replace(/\s+/g, ' ').trim()
    let m

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

/** The current table inventory (Map `schema.table` -> table) for `SCHEMAS`. */
export function readSchemaTables(root = '.') {
  const tables = new Map()
  for (const { name, sql } of schemaSources(root)) applySql(tables, sql, name)
  for (const key of [...tables.keys()]) {
    if (!SCHEMAS.includes(key.split('.')[0])) tables.delete(key)
  }
  return tables
}
