/**
 * migration-report.mjs — a plain-English report on database migrations, with a
 * deterministic RED FLAGS section (multi-tenant plan, S2 review controls).
 *
 * WHY: migrations are the one change that cannot be rolled back by a redeploy,
 * and production migrations are applied by the owner, who reviews them as SQL.
 * This report says what each statement does in words, and lists every pattern
 * that has caused (or could cause) data loss or an access hole, so a dangerous
 * line cannot hide in a long file. The S2 gate is "the owner spots a seeded
 * dangerous change in a migration report".
 *
 * The red flags are pattern rules, not judgement: the same SQL always yields
 * the same flags, in the same order. A flag is a reason to read the statement,
 * not proof it is wrong (dropping and re-creating a policy is routine).
 *
 *   DROP               DROP <object>, or ALTER … DROP CONSTRAINT
 *   DROP_COLUMN        ALTER TABLE … DROP [COLUMN] <name>
 *   TRUNCATE           TRUNCATE <table>
 *   DELETE_NO_WHERE    DELETE FROM <table> with no top-level WHERE (a WHERE
 *                      inside a subquery does not count), including inside
 *                      a WITH … AS (…) CTE or after one
 *   UPDATE_NO_WHERE    the same for UPDATE <table> SET …
 *   GRANT_PUBLIC_ROLE  GRANT … TO anon / authenticated / PUBLIC (WITH … OPTION
 *                      and GRANTED BY after the role list are ignored)
 *   SECURITY_DEFINER   a function declared SECURITY DEFINER
 *   RLS_DISABLED       DISABLE ROW LEVEL SECURITY or NO FORCE ROW LEVEL SECURITY
 *   PRIVILEGED         role attributes (ALTER/CREATE ROLE … BYPASSRLS,
 *                      SUPERUSER, LOGIN …), REASSIGN OWNED, OWNER TO anon /
 *                      authenticated / PUBLIC, COPY … PROGRAM, ALTER SYSTEM
 *   POLICY_TRUE        a policy whose USING or WITH CHECK is always true
 *                      (true, (true), 1 = 1, … OR true) for any role other
 *                      than service_role (which bypasses RLS anyway)
 *   POLICY_WIDENED     ALTER POLICY … TO a role list that includes anon,
 *                      authenticated or PUBLIC
 *   AUTH_STORAGE       creates, alters, drops, writes or grants on an object in
 *                      the auth or storage schema (Supabase-owned), whether
 *                      named outright or reached through a search_path that
 *                      puts auth or storage first; and any SET search_path
 *                      that names either
 *   DYNAMIC_SQL        EXECUTE inside a function or DO body: SQL built at run
 *                      time. Its string literals are checked as SQL too
 *                      (format() placeholders and concatenated values become
 *                      a placeholder name), but a statement held in a variable
 *                      cannot be, so the EXECUTE itself is always flagged.
 *
 * Statements inside function bodies ($$ … $$) are checked too, and flagged as
 * "in the body of <function>": a function that truncates a table is as
 * dangerous as a migration that does. Flags found in an EXECUTE's SQL say
 * "in dynamic SQL (EXECUTE) in …".
 *
 *   node scripts/migration-report.mjs                      # changed vs origin/dev
 *   node scripts/migration-report.mjs --base origin/main
 *   node scripts/migration-report.mjs supabase/migrations/2026…_x.sql
 *   node scripts/migration-report.mjs --out report.md --fail-on-flags
 *
 * Default files: supabase/migrations/*.sql added or modified since the merge
 * base with --base (committed, uncommitted and untracked). Writes Markdown to
 * stdout (or --out). Exit 0 unless --fail-on-flags and a flag fired, or a named
 * file cannot be read. CI appends the report to the job summary
 * (.github/workflows/security.yml, `migration-report`).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const DEFAULT_BASE = 'origin/dev'
export const MIGRATIONS_DIR = 'supabase/migrations'

/** Every flag, in report order, with the reason it matters. */
export const FLAGS = {
  DROP: 'Removes a database object. Data or protections it held are gone unless re-created in the same migration.',
  DROP_COLUMN: 'Deletes a column and every value in it. Not recoverable without a backup.',
  TRUNCATE: 'Empties a table. Not recoverable without a backup.',
  DELETE_NO_WHERE: 'Deletes every row in the table: there is no WHERE clause.',
  UPDATE_NO_WHERE: 'Changes every row in the table: there is no WHERE clause.',
  GRANT_PUBLIC_ROLE:
    'Grants a privilege to anon, authenticated or PUBLIC. The anon key ships in every browser, so this is reachable by anyone unless RLS stops it.',
  SECURITY_DEFINER:
    'Runs as the function owner, so RLS does not apply inside it. Needs SET search_path and REVOKE EXECUTE FROM PUBLIC, anon, authenticated.',
  RLS_DISABLED: 'Turns row level security off (or stops forcing it). Every policy on the table stops applying.',
  PRIVILEGED:
    'Changes role attributes or ownership, or reaches the server itself (COPY … PROGRAM, ALTER SYSTEM). A role with BYPASSRLS or ownership ignores every policy.',
  POLICY_TRUE: 'A policy whose condition is always true: every row is visible or writable to the roles it names.',
  POLICY_WIDENED:
    'Points an existing policy at anon, authenticated or PUBLIC. Whatever rows the policy allows (often everything, for a service-role policy) become reachable by them.',
  AUTH_STORAGE: 'Touches the auth or storage schema, which Supabase owns. Changes there affect sign-in or every file bucket.',
  DYNAMIC_SQL:
    'Runs SQL built at run time (EXECUTE). Only its literal parts can be checked here; read what it builds, including any SQL held in a variable.',
}

const PUBLIC_ROLES = new Set(['anon', 'authenticated', 'public'])

// ── Lexing ───────────────────────────────────────────────────────────────────

/**
 * Masks comments and string literals with spaces (newlines kept, so offsets and
 * line numbers survive) and pulls out dollar-quoted bodies, masking them too.
 * Returns the masked text plus the bodies with their offsets.
 */
export function maskSql(sql) {
  const out = sql.split('')
  const bodies = []
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '
  }
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    const n = sql[i + 1]
    if (c === '-' && n === '-') {
      const end = sql.indexOf('\n', i)
      const stop = end === -1 ? sql.length : end
      blank(i, stop)
      i = stop
    } else if (c === '/' && n === '*') {
      // Postgres block comments nest.
      let depth = 1
      let j = i + 2
      while (j < sql.length && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') (depth++, (j += 2))
        else if (sql[j] === '*' && sql[j + 1] === '/') (depth--, (j += 2))
        else j++
      }
      blank(i, j)
      i = j
    } else if (c === "'") {
      // '' is an escaped quote inside a literal; E'…' backslash escapes too.
      const escapes = i > 0 && /[eE]/.test(sql[i - 1]) && !/[\w$]/.test(sql[i - 2] ?? '')
      let j = i + 1
      while (j < sql.length) {
        if (escapes && sql[j] === '\\') j += 2
        else if (sql[j] === "'" && sql[j + 1] === "'") j += 2
        else if (sql[j] === "'") break
        else j++
      }
      blank(i + 1, j)
      i = j + 1
    } else if (c === '"') {
      // Quoted identifier: keep the name as one word ("anyone reads x" →
      // anyone_reads_x), drop the quotes.
      const j = sql.indexOf('"', i + 1)
      const stop = j === -1 ? sql.length : j
      out[i] = ' '
      for (let k = i + 1; k < stop; k++) if (!/[\w$]/.test(sql[k])) out[k] = '_'
      if (j !== -1) out[j] = ' '
      i = stop + 1
    } else if (c === '$' && !/[\w$]/.test(sql[i - 1] ?? '')) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
      if (!m) {
        i++
        continue
      }
      const tag = m[0]
      const start = i + tag.length
      const end = sql.indexOf(tag, start)
      const stop = end === -1 ? sql.length : end
      bodies.push({ offset: start, text: sql.slice(start, stop) })
      blank(i, end === -1 ? sql.length : end + tag.length)
      i = end === -1 ? sql.length : end + tag.length
    } else {
      i++
    }
  }
  return { masked: out.join(''), bodies }
}

const lineAt = (text, offset) => text.slice(0, offset).split('\n').length

/**
 * Splits masked SQL into statements on top-level semicolons. Each has its
 * masked text (for matching), original text (for excerpts), offset and line.
 */
export function splitStatements(sql) {
  const { masked, bodies } = maskSql(sql)
  const statements = []
  let start = 0
  const push = (end) => {
    const raw = masked.slice(start, end)
    const lead = raw.length - raw.trimStart().length
    if (raw.trim()) {
      const offset = start + lead
      statements.push({
        masked: raw.trim(),
        original: sql.slice(offset, end).trim(),
        offset,
        line: lineAt(sql, offset),
        bodies: bodies.filter((b) => b.offset >= start && b.offset < end),
      })
    }
    start = end + 1
  }
  for (let i = 0; i < masked.length; i++) if (masked[i] === ';') push(i)
  push(masked.length)
  return statements
}

// ── Reading a statement ──────────────────────────────────────────────────────

const IDENT = String.raw`[A-Za-z_][\w$]*(?:\s*\.\s*[A-Za-z_][\w$]*)?`
const norm = (name) => name.replace(/\s+/g, '').toLowerCase()
const squash = (s) => s.replace(/\s+/g, ' ').trim()

/** The objects a statement creates, changes, writes or grants on. */
export function targetsOf(stmt) {
  const s = squash(stmt)
  const found = []
  const add = (re) => {
    const m = re.exec(s)
    if (m) found.push(norm(m[1]))
  }
  add(new RegExp(String.raw`^create (?:or replace )?(?:temp(?:orary)? |unlogged )?(?:table|view|materialized view|function|procedure|type|sequence|domain) (?:if not exists )?(${IDENT})`, 'i'))
  add(new RegExp(String.raw`^create (?:unique )?index (?:concurrently )?(?:if not exists )?(?:${IDENT} )?on (?:only )?(${IDENT})`, 'i'))
  add(new RegExp(String.raw`^(?:create|alter|drop) policy (?:if exists )?${IDENT} on (${IDENT})`, 'i'))
  add(new RegExp(String.raw`^create (?:or replace )?(?:constraint )?trigger ${IDENT} .*? on (${IDENT})`, 'i'))
  add(new RegExp(String.raw`^drop trigger (?:if exists )?${IDENT} on (${IDENT})`, 'i'))
  add(new RegExp(String.raw`^alter (?:table|view|materialized view|function|procedure|type|sequence|domain) (?:if exists )?(?:only )?(${IDENT})`, 'i'))
  add(new RegExp(String.raw`^drop (?:table|view|materialized view|function|procedure|type|sequence|domain|index) (?:concurrently )?(?:if exists )?(${IDENT})`, 'i'))
  add(new RegExp(String.raw`^insert into (${IDENT})`, 'i'))
  add(new RegExp(String.raw`^update (?:only )?(${IDENT})`, 'i'))
  add(new RegExp(String.raw`^delete from (?:only )?(${IDENT})`, 'i'))
  add(new RegExp(String.raw`^truncate (?:table )?(?:only )?(${IDENT})`, 'i'))
  add(new RegExp(String.raw`^comment on (?:table|column|function|view|policy ${IDENT} on) (${IDENT})`, 'i'))
  add(new RegExp(String.raw`^(?:grant|revoke) .*? on (?:table |function |sequence |view )?(?!all |schema )(${IDENT})`, 'i'))
  const schema = /^(?:create|alter|drop) schema (?:if (?:not )?exists )?([A-Za-z_][\w$]*)/i.exec(s)
  if (schema) found.push(`schema:${schema[1].toLowerCase()}`)
  const inSchema = /\b(?:in schema|on schema|on all (?:tables|functions|sequences|routines) in schema)\s+([A-Za-z_][\w$]*)/i.exec(s)
  if (inSchema && /^(?:grant|revoke|alter default privileges)\b/i.test(s)) found.push(`schema:${inSchema[1].toLowerCase()}`)
  return found
}

const SUPABASE_SCHEMAS = ['auth', 'storage']

/** The schema a target lives in; unqualified names resolve via searchPath[0]. */
const schemaOf = (target, searchPath) =>
  target.startsWith('schema:') ? target.slice(7) : target.includes('.') ? target.split('.')[0] : (searchPath?.[0] ?? 'public')

/** Blanks everything inside parentheses, so a match is at the top level. */
export function topLevel(s) {
  let depth = 0
  let out = ''
  for (const c of s) {
    if (c === '(') (depth++, (out += ' '))
    else if (c === ')') ((depth = Math.max(0, depth - 1)), (out += ' '))
    else out += depth ? ' ' : c
  }
  return out
}

/** The text inside the parenthesis that opens at `open`, and the index after it. */
function balanced(s, open) {
  let depth = 1
  let j = open + 1
  while (j < s.length && depth) {
    if (s[j] === '(') depth++
    else if (s[j] === ')') depth--
    j++
  }
  return { inner: s.slice(open + 1, depth ? j : j - 1), end: j }
}

/**
 * Splits `WITH a AS (…), b AS (…) <main>` into the CTE bodies and the main
 * statement, each of which is checked as a statement of its own (a CTE may
 * DELETE or UPDATE). Null when the shape is not recognised.
 */
export function cteSegments(stmt) {
  const s = squash(stmt)
  const head = /^with\s+(?:recursive\s+)?/i.exec(s)
  if (!head) return null
  const segments = []
  let i = head[0].length
  for (;;) {
    const m = /^[A-Za-z_][\w$]*\s*(?:\([^()]*\)\s*)?as\s+(?:not\s+)?(?:materialized\s+)?\(/i.exec(s.slice(i))
    if (!m) return null
    const { inner, end } = balanced(s, i + m[0].length - 1)
    segments.push(inner.trim())
    i = end
    const comma = /^\s*,\s*/.exec(s.slice(i))
    if (!comma) break
    i += comma[0].length
  }
  segments.push(s.slice(i).trim())
  return segments.filter(Boolean)
}

/** The expressions of every USING ( … ) and WITH CHECK ( … ) clause. */
function policyExpressions(s) {
  const out = []
  const re = /\b(?:using|with check)\s*\(/gi
  let m
  while ((m = re.exec(s))) {
    const { inner, end } = balanced(s, m.index + m[0].length - 1)
    out.push(inner)
    re.lastIndex = end
  }
  return out
}

/** Whether a policy expression is trivially always true. */
export function alwaysTrue(expr) {
  let e = expr.trim()
  while (e.startsWith('(') && balanced(e, 0).end === e.length) e = e.slice(1, -1).trim()
  const mask = topLevel(e)
  const cuts = [...mask.matchAll(/\bor\b/gi)].map((m) => m.index)
  if (cuts.length) {
    const parts = []
    let from = 0
    for (const c of cuts) (parts.push(e.slice(from, c)), (from = c + 2))
    parts.push(e.slice(from))
    return parts.some(alwaysTrue)
  }
  if (/^(?:true|not\s+false)$/i.test(e)) return true
  const eq = /^(\d+(?:\.\d+)?)\s*=\s*(\d+(?:\.\d+)?)$/.exec(e)
  return Boolean(eq && Number(eq[1]) === Number(eq[2]))
}

/** The role names after the first top-level ` TO ` of a policy statement. */
function policyRoles(s) {
  const to = /\bto\s+(.+?)(?:\s+using\b|\s+with\s+check\b|$)/i.exec(s)
  return to ? to[1].split(',').map((r) => r.trim().toLowerCase()) : null
}

/**
 * The schemas a statement sets search_path to — `SET [LOCAL|SESSION]
 * search_path = …`, or a function's `SET search_path TO …` clause — read from
 * the ORIGINAL text (the value is often a quoted string, which masking
 * blanks). Null when it sets none.
 */
export function searchPathSet(original) {
  const value = String.raw`(?:'[^']*'|"[^"]*"|[\w$]+)`
  const m = new RegExp(String.raw`(?:^|[\s;])set\s+(?:local\s+|session\s+)?search_path\s*(?:=|to)\s*(${value}(?:\s*,\s*${value})*)`, 'i').exec(original)
  if (!m) return null
  return m[1]
    .split(',')
    .map((x) => x.replace(/['"]/g, '').trim().toLowerCase())
    .filter((x) => x && x !== '$user')
}

/**
 * Red-flag codes for one masked statement (top level or inside a body).
 * `searchPath` resolves unqualified names for AUTH_STORAGE.
 */
export function flagsForStatement(stmt, { searchPath } = {}) {
  const s = squash(stmt)
  const flags = new Set()

  const ctes = /^with\b/i.test(s) ? cteSegments(s) : null
  if (ctes) for (const seg of ctes) for (const f of flagsForStatement(seg, { searchPath })) flags.add(f)

  if (/^drop\s/i.test(s)) flags.add('DROP')
  if (/^alter\s/i.test(s) && /\bdrop constraint\b/i.test(s)) flags.add('DROP')
  if (/^alter table\b/i.test(s)) {
    // DROP [COLUMN] [IF EXISTS] name — but not DROP CONSTRAINT / DEFAULT /
    // NOT NULL / IDENTITY / EXPRESSION (ALTER COLUMN … DROP NOT NULL is benign).
    const re = /\bdrop (column )?(?:if exists )?([A-Za-z_][\w$]*)/gi
    let m
    while ((m = re.exec(s))) {
      if (m[1] || !/^(constraint|default|not|identity|expression)$/i.test(m[2])) flags.add('DROP_COLUMN')
    }
  }
  if (/^truncate\b/i.test(s)) flags.add('TRUNCATE')
  // Only a top-level WHERE filters the statement: one inside a subquery
  // (USING (SELECT … WHERE …), SET a = (SELECT … WHERE …)) does not.
  const top = topLevel(s)
  if (/^delete from\b/i.test(s) && !/\bwhere\b/i.test(top)) flags.add('DELETE_NO_WHERE')
  if (/^update\b/i.test(s) && /\bset\b/i.test(top) && !/\bwhere\b/i.test(top)) flags.add('UPDATE_NO_WHERE')

  const grant = /^(?:alter default privileges\b.*?\s)?grant\b.*?\bto\s+(.+)$/i.exec(s)
  if (grant) {
    // The role list ends at WITH GRANT/ADMIN/INHERIT/SET … or GRANTED BY.
    const list = grant[1].replace(/\s+(?:with\s+(?:grant|admin|inherit|set)\b|granted\s+by\b).*$/i, '')
    const roles = list.split(',').map((r) => r.trim().replace(/^group\s+/i, '').toLowerCase())
    if (roles.some((r) => PUBLIC_ROLES.has(r))) flags.add('GRANT_PUBLIC_ROLE')
  }

  if (/\bsecurity definer\b/i.test(s)) flags.add('SECURITY_DEFINER')
  if (/\b(?:disable|no force) row level security\b/i.test(s)) flags.add('RLS_DISABLED')

  if (
    (/^(?:create|alter) (?:role|user|group)\b/i.test(s) && /\b(?:superuser|bypassrls|createrole|createdb|replication|login|password)\b/i.test(s)) ||
    /^reassign owned\b/i.test(s) ||
    (/^copy\b/i.test(s) && /\bprogram\b/i.test(s)) ||
    /^alter system\b/i.test(s) ||
    /\bowner to (?:anon|authenticated|public)\b/i.test(s)
  )
    flags.add('PRIVILEGED')

  if (/^(?:create|alter) policy\b/i.test(s) && policyExpressions(s).some(alwaysTrue)) {
    // service_role bypasses RLS anyway, so a policy TO service_role alone is
    // the repo's routine "service role full access" shape, not a hole. No TO
    // clause means PUBLIC (for ALTER POLICY: the roles it already had, which
    // this report cannot see, so it is flagged too).
    const roles = policyRoles(s) ?? ['public']
    if (roles.some((r) => r !== 'service_role')) flags.add('POLICY_TRUE')
  }
  if (/^alter policy\b/i.test(s) && !/\brename to\b/i.test(s)) {
    const roles = policyRoles(s)
    if (roles?.some((r) => PUBLIC_ROLES.has(r))) flags.add('POLICY_WIDENED')
  }

  if (targetsOf(s).some((t) => SUPABASE_SCHEMAS.includes(schemaOf(t, searchPath)))) flags.add('AUTH_STORAGE')
  return [...flags]
}

/**
 * A statement inside a PL/pgSQL body is often preceded by block syntax
 * (`BEGIN`, `IF … THEN`, `LOOP`, a DECLARE section) up to the previous
 * semicolon. Returns the text from the first SQL command keyword on, or null
 * when the statement holds none (an assignment, RETURN, RAISE, END IF …).
 */
export function bodyStatement(stmt) {
  const m = /\b(with|delete\s+from|truncate|update|drop|grant|revoke|alter|insert\s+into|create|reassign|copy)\b/i.exec(stmt)
  return m ? stmt.slice(m.index) : null
}

/**
 * The offset of a PL/pgSQL EXECUTE (dynamic SQL) in a masked body statement,
 * or -1. Not GRANT/REVOKE EXECUTE (a privilege) and not EXECUTE FUNCTION /
 * PROCEDURE (a trigger's action).
 */
export function dynamicExecute(stmt) {
  for (const m of stmt.matchAll(/\bexecute\b/gi)) {
    const before = stmt.slice(0, m.index).trimEnd()
    const after = stmt.slice(m.index + m[0].length).trimStart()
    if (/(?:\bgrant|\brevoke|,)$/i.test(before)) continue
    if (/^(?:function|procedure|on)\b/i.test(after)) continue
    return m.index
  }
  return -1
}

/**
 * The SQL an EXECUTE runs, as far as it can be read: its string literals
 * ('…', E'…', $tag$…$tag$) joined, with format() placeholders and the gaps
 * between concatenated literals replaced by a placeholder name.
 */
export function dynamicSqlText(original) {
  const parts = []
  let i = 0
  while (i < original.length) {
    const c = original[i]
    if (c === '-' && original[i + 1] === '-') {
      const end = original.indexOf('\n', i)
      i = end === -1 ? original.length : end
    } else if (c === "'") {
      const escapes = i > 0 && /[eE]/.test(original[i - 1]) && !/[\w$]/.test(original[i - 2] ?? '')
      let j = i + 1
      let text = ''
      while (j < original.length) {
        if (escapes && original[j] === '\\') ((text += original[j + 1] ?? ''), (j += 2))
        else if (original[j] === "'" && original[j + 1] === "'") ((text += "'"), (j += 2))
        else if (original[j] === "'") break
        else text += original[j++]
      }
      parts.push(text)
      i = j + 1
    } else if (c === '$' && !/[\w$]/.test(original[i - 1] ?? '')) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(original.slice(i))
      if (!m) {
        i++
        continue
      }
      const start = i + m[0].length
      const end = original.indexOf(m[0], start)
      parts.push(original.slice(start, end === -1 ? original.length : end))
      i = end === -1 ? original.length : end + m[0].length
    } else {
      i++
    }
  }
  return parts.join(' _dyn_ ').replace(/%(?:\d+\$)?-?\d*[IsL]/g, '_dyn_')
}

/** The name a CREATE FUNCTION / PROCEDURE statement declares, if any. */
function functionName(stmt) {
  const m = new RegExp(String.raw`^create (?:or replace )?(?:function|procedure) (${IDENT})`, 'i').exec(squash(stmt))
  return m ? norm(m[1]) : null
}

/** A one-line plain-English description of a statement. */
export function describe(stmt) {
  const s = squash(stmt)
  const ctes = /^with\b/i.test(s) ? cteSegments(s) : null
  if (ctes) return `With ${ctes.length - 1} CTE${ctes.length === 2 ? '' : 's'}: ${describe(ctes.at(-1))}`
  const first = targetsOf(s)[0]
  const t = first?.startsWith('schema:') ? first.slice(7) : first
  const m = (re) => re.exec(s)
  let r
  if ((r = m(/^create (?:or replace )?(?:temp(?:orary)? |unlogged )?table/i))) return `Creates table ${t}.`
  if ((r = m(/^create (?:or replace )?(materialized view|view)/i))) return `Creates ${r[1].toLowerCase()} ${t}.`
  if ((r = m(/^create (?:or replace )?(function|procedure)/i))) {
    const definer = /\bsecurity definer\b/i.test(s) ? ' (SECURITY DEFINER: runs as its owner, RLS does not apply)' : ''
    return `Creates or replaces ${r[1].toLowerCase()} ${t}${definer}.`
  }
  if ((r = m(/^create (unique )?index/i))) return `Creates ${r[1] ? 'a unique ' : 'an '}index on ${t}.`
  if ((r = m(/^create policy ([\w$]+) on \S+(?: as (permissive|restrictive))?(?: for (all|select|insert|update|delete))?(?: to ([^()]+?))?(?: using| with check|$)/i)))
    return `Creates policy ${r[1]} on ${t}: ${(r[3] ?? 'all').toUpperCase()} for ${r[4]?.trim() ?? 'PUBLIC'}.`
  if ((r = m(/^alter policy ([\w$]+)/i))) return `Changes policy ${r[1]} on ${t}.`
  if ((r = m(/^drop policy (?:if exists )?([\w$]+)/i))) return `Drops policy ${r[1]} on ${t}.`
  if ((r = m(/^create (?:or replace )?(?:constraint )?trigger ([\w$]+)/i))) return `Creates trigger ${r[1]} on ${t}.`
  if ((r = m(/^drop (\w+(?: view)?)/i))) return `Drops ${r[1].toLowerCase()} ${t ?? ''}`.trim() + '.'
  if (/^alter table\b/i.test(s)) {
    const parts = []
    if (/\benable row level security\b/i.test(s)) parts.push('enables row level security')
    if (/\bdisable row level security\b/i.test(s)) parts.push('DISABLES row level security')
    if (/\bno force row level security\b/i.test(s)) parts.push('stops forcing row level security')
    else if (/\bforce row level security\b/i.test(s)) parts.push('forces row level security (even for the owner)')
    for (const a of s.matchAll(/\badd (?:column )?(?:if not exists )?(?!constraint\b)([\w$]+) ([\w$]+(?:\[\])?)/gi)) parts.push(`adds column ${a[1]} (${a[2].toLowerCase()})`)
    for (const a of s.matchAll(/\badd constraint ([\w$]+)/gi)) parts.push(`adds constraint ${a[1]}`)
    for (const a of s.matchAll(/\bdrop constraint (?:if exists )?([\w$]+)/gi)) parts.push(`drops constraint ${a[1]}`)
    for (const a of s.matchAll(/\balter column ([\w$]+) (set not null|drop not null|set default|drop default|type|set data type)/gi))
      parts.push(`column ${a[1]}: ${a[2].toLowerCase()}`)
    for (const a of s.matchAll(/\bdrop (column )?(?:if exists )?([\w$]+)/gi))
      if (a[1] || !/^(constraint|default|not|identity|expression)$/i.test(a[2])) parts.push(`DROPS column ${a[2]}`)
    if (/\bowner to\b/i.test(s)) parts.push('changes owner')
    return `On table ${t}: ${parts.length ? parts.join(', ') : 'alters the table'}.`
  }
  if ((r = m(/^alter (function|procedure|view|type|sequence)/i))) return `Alters ${r[1].toLowerCase()} ${t}.`
  if ((r = m(/^(grant|revoke) (.+?) on (.+?) (to|from) (.+)$/i))) {
    const verb = r[1].toLowerCase() === 'grant' ? 'Grants' : 'Revokes'
    return `${verb} ${r[2]} on ${r[3]} ${r[4].toLowerCase()} ${r[5]}.`
  }
  if ((r = m(/^alter default privileges/i))) return 'Changes default privileges for objects created later.'
  if ((r = m(/^insert into/i))) return `Inserts rows into ${t}.`
  if ((r = m(/^update/i))) return `Updates rows in ${t}${/\bwhere\b/i.test(s) ? ' (filtered by WHERE)' : ' (EVERY row: no WHERE)'}.`
  if ((r = m(/^delete from/i))) return `Deletes rows from ${t}${/\bwhere\b/i.test(s) ? ' (filtered by WHERE)' : ' (EVERY row: no WHERE)'}.`
  if ((r = m(/^truncate/i))) return `Empties table ${t}.`
  if ((r = m(/^comment on (\w+)/i))) return `Sets a comment on ${r[1].toLowerCase()} ${t}.`
  if ((r = m(/^create schema/i))) return `Creates schema ${t}.`
  if ((r = m(/^create extension (?:if not exists )?([\w$-]+)/i))) return `Enables extension ${r[1]}.`
  if ((r = m(/^(begin|commit|rollback)\b/i))) return `Transaction control: ${r[1].toUpperCase()}.`
  if ((r = m(/^set\b/i))) return `Sets a session setting: ${s.slice(0, 80)}.`
  if ((r = m(/^select\b/i))) return 'Runs a SELECT (e.g. calls a function).'
  if ((r = m(/^do\b/i))) return 'Runs an anonymous code block (DO).'
  if ((r = m(/^notify pgrst\b/i))) return 'Tells the API (PostgREST) to reload its schema cache.'
  return `Runs: ${s.slice(0, 100)}${s.length > 100 ? '…' : ''}`
}

// ── Analysis and report ─────────────────────────────────────────────────────

const excerpt = (text) => {
  const one = squash(text)
  return one.length > 140 ? `${one.slice(0, 137)}…` : one
}

/**
 * Analyses one migration. Returns its statements (described) and flags, each
 * flag with code, line and excerpt, sorted by line then flag order.
 */
const touchesSupabaseSchema = (path) => Boolean(path?.some((x) => SUPABASE_SCHEMAS.includes(x)))

export function analyse(path, sql) {
  const statements = splitStatements(sql)
  const flags = []
  const order = Object.keys(FLAGS)
  const described = []
  // The file's search_path, as SET statements change it (null: the default,
  // which puts public first).
  let searchPath = null

  const push = (line, code, text, where) => flags.push({ path, line, code, excerpt: excerpt(text), where })

  // Checks a dollar-quoted body (absolute offset `at`). Statements in it may
  // SET search_path, run EXECUTE, or hold nested bodies of their own.
  const checkBody = (text, at, where, initialPath) => {
    let bodyPath = initialPath
    for (const inner of splitStatements(text)) {
      const set = searchPathSet(inner.original)
      if (set) {
        if (touchesSupabaseSchema(set)) push(lineAt(sql, at + inner.offset), 'AUTH_STORAGE', inner.original, where)
        bodyPath = set
      }
      const exec = dynamicExecute(inner.masked)
      if (exec !== -1) {
        const line = lineAt(sql, at + inner.offset + exec)
        const execText = inner.original.slice(exec)
        push(line, 'DYNAMIC_SQL', execText, where)
        for (const dyn of splitStatements(dynamicSqlText(execText))) {
          const cmd = bodyStatement(dyn.masked)
          if (!cmd) continue
          for (const code of flagsForStatement(cmd, { searchPath: bodyPath })) push(line, code, execText, `in dynamic SQL (EXECUTE) ${where}`)
        }
        continue
      }
      const cmd = bodyStatement(inner.masked)
      if (cmd) {
        const skip = inner.masked.length - cmd.length
        for (const code of flagsForStatement(cmd, { searchPath: bodyPath })) {
          if (code === 'SECURITY_DEFINER') continue
          push(lineAt(sql, at + inner.offset + skip), code, inner.original.slice(skip), where)
        }
      }
      // A function created inside a DO block, for one.
      const fn = cmd ? functionName(cmd) : null
      for (const nested of inner.bodies) checkBody(nested.text, at + nested.offset, fn ? `in the body of ${fn}` : where, bodyPath)
    }
  }

  for (const st of statements) {
    described.push({ line: st.line, text: describe(st.masked) })
    // The statement's own text outside its bodies: where a SET clause lives.
    let head = st.original
    for (const b of st.bodies) {
      const rel = b.offset - st.offset
      head = head.slice(0, rel) + ' '.repeat(b.text.length) + head.slice(rel + b.text.length)
    }
    const set = searchPathSet(head)
    const flagsHere = new Set(flagsForStatement(st.masked, { searchPath }))
    if (touchesSupabaseSchema(set)) flagsHere.add('AUTH_STORAGE')
    for (const code of flagsHere) push(st.line, code, st.original, null)
    if (set && /^set\b/i.test(st.masked)) searchPath = set
    if (/^reset\s+(?:search_path|all)\b/i.test(st.masked)) searchPath = null

    const fn = functionName(st.masked)
    // A function's own SET search_path clause governs its body.
    const bodyPath = fn && set ? set : searchPath
    for (const body of st.bodies) checkBody(body.text, body.offset, fn ? `in the body of ${fn}` : 'in a code block', bodyPath)
  }
  flags.sort((a, b) => a.line - b.line || order.indexOf(a.code) - order.indexOf(b.code))
  return { path, statements: described, flags }
}

const md = (s) => s.replace(/\|/g, '\\|').replace(/`/g, "'")

/** Renders analyses as Markdown. Deterministic: same input, same bytes. */
export function renderReport(analyses, { base } = {}) {
  const out = []
  const total = analyses.reduce((n, a) => n + a.flags.length, 0)
  out.push('## Migration report', '')
  if (!analyses.length) {
    out.push(`No migration files changed${base ? ` since ${base}` : ''}.`, '')
    return out.join('\n')
  }
  out.push(
    `${analyses.length} migration file${analyses.length === 1 ? '' : 's'}${base ? ` changed since ${base}` : ''}, ` +
      `${analyses.reduce((n, a) => n + a.statements.length, 0)} statements.`,
    '',
  )
  out.push(`### RED FLAGS (${total})`, '')
  if (!total) {
    out.push('None found. The pattern rules in scripts/migration-report.mjs matched nothing; still read the SQL.', '')
  } else {
    out.push('Each line is a pattern match, not a verdict: read the statement and confirm it is intended.', '')
    for (const a of analyses) {
      for (const f of a.flags) {
        out.push(`- **${f.code}** \`${f.path}:${f.line}\`${f.where ? ` (${f.where})` : ''}: ${FLAGS[f.code]}`, `  \`${md(f.excerpt)}\``)
      }
    }
    out.push('')
    const counts = Object.keys(FLAGS)
      .map((code) => [code, analyses.reduce((n, a) => n + a.flags.filter((f) => f.code === code).length, 0)])
      .filter(([, n]) => n)
    out.push(`Counts: ${counts.map(([c, n]) => `${c} ${n}`).join(', ')}.`, '')
  }
  for (const a of analyses) {
    out.push(`### \`${a.path}\``, '')
    if (!a.statements.length) out.push('_No statements._')
    for (const st of a.statements) out.push(`- Line ${st.line}: ${md(st.text)}`)
    out.push('')
  }
  return out.join('\n')
}

// ── Files ────────────────────────────────────────────────────────────────────

const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** supabase/migrations/*.sql added or modified since the merge base with `base`. */
export function changedMigrations(base) {
  const mergeBase = git(['merge-base', base, 'HEAD']).trim()
  const tracked = git(['diff', '--name-only', '--no-renames', '--diff-filter=AM', mergeBase, '--', MIGRATIONS_DIR])
  const untracked = git(['ls-files', '--others', '--exclude-standard', '--', MIGRATIONS_DIR])
  return [...new Set(`${tracked}\n${untracked}`.split('\n').map((f) => f.trim()))]
    .filter((f) => f.endsWith('.sql') && existsSync(f))
    .sort()
}

export function parseArgs(argv) {
  const opts = { base: DEFAULT_BASE, out: null, failOnFlags: false, files: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--base') opts.base = argv[++i]
    else if (a === '--out') opts.out = argv[++i]
    else if (a === '--fail-on-flags') opts.failOnFlags = true
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`)
    else opts.files.push(a)
  }
  return opts
}

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv)
  const named = opts.files.length > 0
  const files = named ? opts.files : changedMigrations(opts.base)
  const analyses = files.map((f) => analyse(f, readFileSync(f, 'utf8')))
  const report = renderReport(analyses, { base: named ? undefined : opts.base })
  if (opts.out) writeFileSync(opts.out, `${report}\n`)
  else process.stdout.write(`${report}\n`)
  const flagged = analyses.some((a) => a.flags.length)
  return opts.failOnFlags && flagged ? 1 : 0
}

const invokedDirectly = (() => {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()

if (invokedDirectly) {
  try {
    process.exitCode = main()
  } catch (err) {
    console.error(`migration-report: ${err.message}`)
    process.exitCode = 2
  }
}
