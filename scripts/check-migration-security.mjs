/**
 * check-migration-security.mjs — fail a migration that adds a SECURITY DEFINER
 * function without locking it down to the public API roles.
 *
 * Sibling of check-migration-names.mjs; both run under `npm run lint:migrations`
 * (and in `prebuild`, so they gate the build).
 *
 * ── Why this exists (deep review DB-N3) ──────────────────────────────────────
 * A SECURITY DEFINER function runs as its owner, so RLS never applies to it.
 * Postgres grants EXECUTE on every new function to PUBLIC by default, AND — on
 * this project's Supabase — the default privileges ALSO grant EXECUTE to `anon`
 * and `authenticated` DIRECTLY. The anon key ships in every browser bundle and
 * the repo is public, so a SECURITY DEFINER function that forgets the explicit
 * `anon`/`authenticated` revoke is an unauthenticated RPC the moment it lands.
 *
 * The project has re-learned this by hand three times:
 *   • C-6 / DB-1 — the whole `entitlements` schema was anon-callable (15 definer
 *     functions: grant allocations, confirm unpaid bookings, mint credit) until
 *     20261009162158 revoked it.
 *   • The esign fix shipped as TWO migrations: 20261009185923 revoked EXECUTE
 *     `FROM PUBLIC` only — which left the direct anon/authenticated grants intact
 *     (a signing DoS on a minor's consent form) — and 20261009202141 had to add
 *     `FROM anon, authenticated` afterwards.
 *
 * NEITHER revoke alone is sufficient: `FROM PUBLIC` leaves the direct
 * anon/authenticated grants (the esign lesson above), and `FROM anon,
 * authenticated` leaves the default PUBLIC grant — which
 * `has_function_privilege('anon', …)` still resolves through, so anon can still
 * call it (observed on `bump_email_quota`, 10 Oct 2026, which the first cut of
 * this lint wrongly passed). The revoke must name `public`, `anon` AND
 * `authenticated` (or seal the schema from all three). This lint makes the next
 * one fail in CI instead of in production.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 * For every SECURITY DEFINER function a migration declares, one of these must be
 * true somewhere in the migrations corpus (a revoke may live in a later, atomic
 * follow-up migration — but if it is missing when CI runs, the build is red):
 *
 *   (a) EXECUTE is revoked from `public`, `anon` AND `authenticated` for that
 *       function — `REVOKE EXECUTE ON FUNCTION <fn>(...) FROM PUBLIC, anon,
 *       authenticated` (the three may be spread across atomic follow-ups); or
 *   (b) its schema is sealed from all three — `REVOKE EXECUTE ON ALL FUNCTIONS
 *       IN SCHEMA <s> FROM PUBLIC, anon, authenticated` or `REVOKE USAGE ON
 *       SCHEMA <s> FROM PUBLIC, anon, authenticated` (the entitlements shape); or
 *   (c) the function carries an allowlist comment justifying that it KEEPS a
 *       public role's EXECUTE — `-- rls-helper: keep authenticated EXECUTE`.
 *
 * (c) is the escape hatch for the RLS helpers `can_read_space` and
 * `can_read_chat_channel`: they are SECURITY DEFINER (to avoid RLS recursion)
 * and MUST stay EXECUTE-able by `authenticated`, or the authenticated SELECT
 * policies that call them fail closed and break chat/community reads (see
 * migration 118 / 132). They revoke only `anon`, by design.
 *
 * ── Grandfathering ───────────────────────────────────────────────────────────
 * Migrations already applied before this lint existed are frozen history — they
 * cannot be edited (editing an applied migration does not re-run it) and are not
 * this lint's job to retrofit. As with check-migration-names.mjs's LAST_LEGACY,
 * the sequentially-numbered migrations (≤ 148) are grandfathered. Every
 * TIMESTAMPED migration must satisfy (a), (b) or (c); the three that once sat on
 * a grandfather list (esign_native, post_event_survey — DB-N3) were sealed by a
 * later migration, 20261102220634. Their one RLS helper, which must keep
 * `authenticated`, is named in FROZEN_RLS_HELPERS and must still lose PUBLIC and
 * anon.
 *
 * ── Second rule: a new public table revokes the API roles (S2-revoke-lint) ──
 * `supabase/baseline.sql` sets default privileges that GRANT ALL on every new
 * table in schema `public` to `anon` and `authenticated`. RLS is linted
 * (check-migration-tenancy.mjs), but a permissive policy plus that default
 * grant still exposes the table to the public anon key (THREAT-MODEL TB5 E,
 * R4a). So a migration that runs `CREATE TABLE` in schema `public` must, in
 * the SAME file, revoke both roles:
 *
 *     REVOKE ALL ON public.<table> FROM PUBLIC, anon, authenticated;
 *
 * Names may be quoted or unquoted and schema-qualified or not; `PUBLIC` is
 * optional (tables get no PUBLIC grant by default) but anon AND authenticated
 * must both be named, in one statement or several in that file. `REVOKE ALL ON
 * ALL TABLES IN SCHEMA public FROM anon, authenticated` placed AFTER the
 * `CREATE TABLE` also counts. Temporary tables are exempt (session-local).
 * Unlike the definer rule, a later migration does not cure it: between the two
 * deploys the table is open, so the revoke must ship with the table.
 *
 * Every migration at or before TABLE_REVOKE_CUTOFF (the newest migration on
 * `dev` when this rule landed) is grandfathered: it is applied history, and
 * editing it would not re-run it. The grant revoke for those tables is S0's
 * job, not this lint's.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const MIGRATIONS_DIR = 'supabase/migrations'

/** Mirrors check-migration-names.mjs: sequential migrations up to here predate
 *  the timestamp convention and this lint, and are frozen history. */
export const LAST_LEGACY = 148

/**
 * Pre-existing TIMESTAMPED migrations exempt from the rule. Empty since
 * 20261102220634_seal_definer_functions_db_n3 sealed the three files that used
 * to sit here (esign_native_engine, post_event_survey, post_event_survey_member_link
 * revoked `FROM PUBLIC` only — DB-N3). Do not add to this list to silence a NEW
 * migration: seal it (a/b) or annotate it (c) instead. A frozen file whose
 * functions are left callable needs a sealing migration, not an exemption.
 */
export const GRANDFATHERED_PREEXISTING = []

/**
 * RLS helpers declared in FROZEN migrations (so rule (c)'s comment cannot be
 * added to their declaration) that must keep `authenticated` EXECUTE because an
 * authenticated SELECT policy calls them. Each still has to be revoked from
 * PUBLIC and anon somewhere in the corpus, or it is flagged. Key = schema.fn.
 */
export const FROZEN_RLS_HELPERS = {
  // survey_responses / survey_answers self-read policies (post_event_survey.sql:585-623)
  'public.survey_current_member_id': 'survey self-read RLS policies',
}

/** The roles a frozen RLS helper must still lose (it keeps authenticated). */
export const RLS_HELPER_REVOKES = ['public', 'anon']

/** The allowlist-comment escape hatch (rule c). */
export const ALLOWLIST_MARKER = /rls-helper|security-definer-allow(?:list)?/i

const CREATE_FN =
  /create\s+(?:or\s+replace\s+)?function\s+(?:([a-z0-9_]+)\s*\.\s*)?([a-z0-9_]+)\s*\(/i
const SECURITY_DEFINER = /security\s+definer/i

export function isGrandfathered(file) {
  const base = file.replace(/^.*\//, '')
  const legacy = /^(\d{1,3})_/.exec(base)
  if (legacy && Number(legacy[1]) <= LAST_LEGACY) return true
  return GRANDFATHERED_PREEXISTING.includes(base)
}

/**
 * Split SQL into top-level statements, aware of `--` line comments, `/* *\/`
 * block comments, '...' single-quoted strings (with '' escapes) and $tag$ dollar
 * quotes, so a `;` inside any of those does not split. `text` is the
 * comment-stripped statement (for keyword matching); `rawStart`/`rawEnd` bound
 * the statement in the original SQL (for allowlist-comment lookup, which must
 * see the comments that precede the declaration).
 */
export function splitStatements(sql) {
  const statements = []
  let buf = ''
  let rawStart = 0
  let i = 0
  const n = sql.length
  while (i < n) {
    const two = sql.slice(i, i + 2)
    if (two === '--') {
      let j = i + 2
      while (j < n && sql[j] !== '\n') j++
      i = j
      continue
    }
    if (two === '/*') {
      let j = i + 2
      while (j < n && sql.slice(j, j + 2) !== '*/') j++
      i = Math.min(n, j + 2)
      continue
    }
    const c = sql[i]
    if (c === "'") {
      buf += c
      let j = i + 1
      while (j < n) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            buf += "''"
            j += 2
            continue
          }
          buf += "'"
          j++
          break
        }
        buf += sql[j]
        j++
      }
      i = j
      continue
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
      if (m) {
        const tag = m[0]
        const close = sql.indexOf(tag, i + tag.length)
        const end = close === -1 ? n : close + tag.length
        buf += sql.slice(i, end)
        i = end
        continue
      }
    }
    if (c === ';') {
      const text = buf.trim()
      if (text) statements.push({ text, rawStart, rawEnd: i })
      buf = ''
      i++
      rawStart = i
      continue
    }
    buf += c
    i++
  }
  const text = buf.trim()
  if (text) statements.push({ text, rawStart, rawEnd: n })
  return statements
}

/** The three public-facing roles that must ALL lose EXECUTE before a SECURITY
 *  DEFINER function is sealed. Neither revoke alone is enough: `FROM PUBLIC`
 *  leaves Supabase's direct anon/authenticated grants (the esign two-step
 *  lesson), and `FROM anon, authenticated` leaves Postgres's default PUBLIC
 *  grant — which `has_function_privilege('anon', …)` still resolves through, so
 *  anon can still call it (observed on bump_email_quota, 10 Oct 2026). */
export const REQUIRED_REVOKES = ['public', 'anon', 'authenticated']

/** The REQUIRED_REVOKES roles named in a REVOKE statement's FROM clause. */
function revokedRolesIn(stmt) {
  const idx = stmt.toLowerCase().lastIndexOf(' from ')
  if (idx === -1) return []
  const tokens = new Set(
    stmt
      .slice(idx + 6)
      .toLowerCase()
      .split(/[^a-z_]+/)
      .filter(Boolean),
  )
  return REQUIRED_REVOKES.filter((r) => tokens.has(r))
}

/**
 * Scan an array of { name, sql } migration files. Returns the offenders plus the
 * sealed sets (exposed for the self-test). Sealing is corpus-wide and additive:
 * the required revokes may be spread across atomic follow-up migrations (the
 * esign shape — PUBLIC in one, anon/authenticated in the next), so a function or
 * schema is sealed once ALL THREE roles have been revoked somewhere in the corpus.
 */
export function scanMigrations(files) {
  const schemaRoles = new Map() // schema -> Set<role revoked>
  const funcRoles = new Map() // qualified fn -> Set<role revoked>
  const sdFunctions = []
  const accumulate = (map, key, roles) => {
    const cur = map.get(key) ?? new Set()
    for (const r of roles) cur.add(r)
    map.set(key, cur)
  }

  for (const { name: file, sql } of files) {
    for (const st of splitStatements(sql)) {
      const s = st.text
      let m
      if ((m = /revoke\s+execute\s+on\s+all\s+functions\s+in\s+schema\s+([a-z0-9_]+)/i.exec(s))) {
        accumulate(schemaRoles, m[1].toLowerCase(), revokedRolesIn(s))
      } else if ((m = /revoke\s+usage\s+on\s+schema\s+([a-z0-9_]+)/i.exec(s))) {
        accumulate(schemaRoles, m[1].toLowerCase(), revokedRolesIn(s))
      } else if ((m = /revoke\s+execute\s+on\s+function\s+(?:([a-z0-9_]+)\s*\.\s*)?([a-z0-9_]+)\s*\(/i.exec(s))) {
        accumulate(funcRoles, `${(m[1] || 'public').toLowerCase()}.${m[2].toLowerCase()}`, revokedRolesIn(s))
      }

      const cf = CREATE_FN.exec(s)
      if (cf && SECURITY_DEFINER.test(s)) {
        sdFunctions.push({
          file,
          schema: (cf[1] || 'public').toLowerCase(),
          name: cf[2].toLowerCase(),
          raw: sql.slice(st.rawStart, st.rawEnd),
        })
      }
    }
  }

  const hasAll = (roles) => !!roles && REQUIRED_REVOKES.every((r) => roles.has(r))
  const schemaSealed = new Set([...schemaRoles].filter(([, r]) => hasAll(r)).map(([k]) => k))
  const funcSealed = new Set([...funcRoles].filter(([, r]) => hasAll(r)).map(([k]) => k))

  const offenders = []
  for (const fn of sdFunctions) {
    const qualified = `${fn.schema}.${fn.name}`
    const sealed = schemaSealed.has(fn.schema) || funcSealed.has(qualified)
    const frozenHelper =
      Object.hasOwn(FROZEN_RLS_HELPERS, qualified) &&
      RLS_HELPER_REVOKES.every((r) => funcRoles.get(qualified)?.has(r))
    const allowlisted = ALLOWLIST_MARKER.test(fn.raw) || frozenHelper
    if (sealed || allowlisted || isGrandfathered(fn.file)) continue
    offenders.push({ file: fn.file, fn: qualified })
  }

  return { offenders, sdFunctions, schemaSealed, funcSealed }
}

/**
 * Table rule cutoff: the newest migration on origin/dev when the REVOKE rule
 * landed (20261114090000_record_access_log.sql, 13 Nov 2026). Every migration
 * whose timestamp is at or before this, and every sequential legacy migration,
 * is grandfathered by the table rule. Never move this forward to silence a new
 * migration: add the REVOKE instead.
 */
export const TABLE_REVOKE_CUTOFF = '20261114090000'

/** The roles a new public table must revoke ALL from (PUBLIC is optional). */
export const TABLE_REQUIRED_REVOKES = ['anon', 'authenticated']

/** Whether a migration file predates the table REVOKE rule. */
export function isTableRuleGrandfathered(file) {
  const base = file.replace(/^.*\//, '')
  if (/^\d{1,3}_/.test(base)) return true
  const ts = /^(\d{14})_/.exec(base)
  return !!ts && ts[1] <= TABLE_REVOKE_CUTOFF
}

// An identifier: "quoted" (case kept, "" escapes) or unquoted (folded to lower case).
const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`
const QUALIFIED = String.raw`${IDENT}(?:\s*\.\s*${IDENT})?`

/** Normalise one identifier the way Postgres does. */
function normIdent(raw) {
  const t = raw.trim()
  return t.startsWith('"') ? t.slice(1, -1).replace(/""/g, '"') : t.toLowerCase()
}

/** { schema, table } for a possibly schema-qualified name (default schema public). */
function parseQualified(raw) {
  const parts = []
  const re = new RegExp(IDENT, 'g')
  let m
  while ((m = re.exec(raw))) parts.push(normIdent(m[0]))
  return parts.length === 2 ? { schema: parts[0], table: parts[1] } : { schema: 'public', table: parts[0] }
}

const CREATE_TABLE = new RegExp(
  String.raw`^create\s+(?:(global|local)\s+)?(temp|temporary|unlogged)?\s*table\s+(?:if\s+not\s+exists\s+)?(${QUALIFIED})`,
  'i',
)
// `REVOKE GRANT OPTION FOR ALL ON …` is deliberately NOT matched: it removes
// only the right to re-grant, so anon/authenticated keep every privilege the
// default grant gave them. It does not count as a revoke.
const REVOKE_ALL_ON = /^revoke\s+all(?:\s+privileges)?\s+on\s+/i
const ALL_TABLES_IN_SCHEMA = new RegExp(String.raw`^all\s+tables\s+in\s+schema\s+(${IDENT})`, 'i')

/** Roles named in a REVOKE's FROM clause, normalised ('public' for PUBLIC). */
function revokeFromRoles(stmt) {
  const m = /\bfrom\b([\s\S]*)$/i.exec(stmt)
  if (!m) return []
  const list = m[1].replace(/\b(?:cascade|restrict)\b\s*$/i, '').replace(/\bgranted\s+by\b[\s\S]*$/i, '')
  return list
    .split(',')
    .map((r) => r.trim().replace(/^group\s+/i, ''))
    .filter(Boolean)
    .map(normIdent)
}

/** Top-level statements plus the statements inside each `DO $$ … $$` body. */
function flatStatements(sql) {
  const out = []
  for (const st of splitStatements(sql)) {
    const t = st.text
    const doBody = /^do\s+(?:language\s+\S+\s+)?(\$[A-Za-z_]*\$)([\s\S]*)\1/i.exec(t)
    if (doBody) {
      // A PL/pgSQL body: strip BEGIN/END and DECLARE scaffolding enough that
      // a CREATE TABLE or REVOKE inside is seen at the start of a statement.
      for (const inner of splitStatements(doBody[2])) {
        out.push(inner.text.replace(/^(?:declare[\s\S]*?\bbegin|begin)\s+/i, '').replace(/^end\s*(?:if|loop)?\s*/i, ''))
      }
      continue
    }
    out.push(t)
  }
  return out
}

/**
 * S2-revoke-lint: every public table a non-grandfathered migration creates must
 * have ALL revoked from anon AND authenticated in the same file. Returns the
 * offenders ({ file, table }) and every public table seen (for the self-test).
 */
export function scanTableRevokes(files) {
  const offenders = []
  const tables = []
  for (const { name: file, sql } of files) {
    const created = [] // { key, index }
    const revoked = new Map() // key -> Set<role>
    const schemaRevokes = [] // { schema, index, roles }
    const statements = flatStatements(sql)
    statements.forEach((s, index) => {
      const ct = CREATE_TABLE.exec(s)
      if (ct) {
        if (ct[2] && /^temp/i.test(ct[2])) return
        const { schema, table } = parseQualified(ct[3])
        if (schema === 'public') created.push({ key: `${schema}.${table}`, table, index })
        return
      }
      const rv = REVOKE_ALL_ON.exec(s)
      if (!rv) return
      const rest = s.slice(rv[0].length)
      const roles = revokeFromRoles(rest)
      const all = ALL_TABLES_IN_SCHEMA.exec(rest)
      if (all) {
        schemaRevokes.push({ schema: normIdent(all[1]), index, roles })
        return
      }
      const target = /^(?:table\s+)?([\s\S]*?)\s+from\b/i.exec(rest)
      if (!target) return
      for (const raw of target[1].split(',')) {
        if (!raw.trim()) continue
        const { schema, table } = parseQualified(raw)
        const key = `${schema}.${table}`
        const cur = revoked.get(key) ?? new Set()
        for (const r of roles) cur.add(r)
        revoked.set(key, cur)
      }
    })
    for (const c of created) {
      tables.push({ file, table: c.key })
      if (isTableRuleGrandfathered(file)) continue
      const roles = new Set(revoked.get(c.key) ?? [])
      for (const sr of schemaRevokes) if (sr.schema === 'public' && sr.index > c.index) for (const r of sr.roles) roles.add(r)
      if (TABLE_REQUIRED_REVOKES.every((r) => roles.has(r))) continue
      offenders.push({ file, table: c.key, missing: TABLE_REQUIRED_REVOKES.filter((r) => !roles.has(r)) })
    }
  }
  return { offenders, tables }
}

export function readMigrationFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(`${dir}/${name}`, 'utf8') }))
}

function main() {
  const files = readMigrationFiles(MIGRATIONS_DIR)
  const { offenders, sdFunctions } = scanMigrations(files)
  const tableScan = scanTableRevokes(files)
  if (offenders.length) {
    console.error('\n✗ migration security: SECURITY DEFINER function(s) reachable by anon/authenticated\n')
    for (const o of offenders) console.error(`  ${o.file}\n    ${o.fn}`)
    console.error(
      '\n  A SECURITY DEFINER function bypasses RLS and is EXECUTE-able by anon +\n' +
        '  authenticated by default — an unauthenticated RPC on a public repo.\n' +
        '  In the SAME migration (or an atomic follow-up), add one of:\n\n' +
        '      REVOKE EXECUTE ON FUNCTION <schema>.<fn>(<args>) FROM PUBLIC, anon, authenticated;\n' +
        '      REVOKE USAGE ON SCHEMA <schema> FROM PUBLIC, anon, authenticated;   -- whole schema\n\n' +
        '  All three must go: FROM PUBLIC alone leaves the direct anon/authenticated\n' +
        '  grants, and FROM anon, authenticated alone leaves the default PUBLIC grant\n' +
        '  (anon still reaches it through PUBLIC). If the function MUST keep a public\n' +
        '  role EXECUTE (an RLS helper), annotate it:  -- rls-helper: keep authenticated EXECUTE\n',
    )
  }
  if (tableScan.offenders.length) {
    console.error('\n✗ migration security: new public table(s) without REVOKE ALL FROM anon, authenticated\n')
    for (const o of tableScan.offenders) {
      console.error(`  ${o.file}\n    table ${o.table} (not revoked from: ${o.missing.join(', ')})`)
    }
    console.error(
      '\n  Default privileges GRANT ALL on every new public table to anon and\n' +
        '  authenticated, so the public anon key can reach it through any permissive\n' +
        '  policy. In the SAME migration that creates the table, add:\n\n' +
        '      REVOKE ALL ON public.<table> FROM PUBLIC, anon, authenticated;\n\n' +
        '  then GRANT back only what the app needs (usually to service_role).\n',
    )
  }
  if (offenders.length || tableScan.offenders.length) process.exit(1)
  console.log(
    `✓ migration security: ${sdFunctions.length} SECURITY DEFINER function(s), all revoked from public+anon+authenticated, schema-sealed, or allowlisted`,
  )
  console.log(
    `✓ migration security: ${tableScan.tables.length} public table(s) created; every one after ${TABLE_REVOKE_CUTOFF} revokes ALL from anon+authenticated`,
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
