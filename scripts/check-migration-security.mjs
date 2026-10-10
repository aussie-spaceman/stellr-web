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
 * A `FROM PUBLIC` revoke is therefore NOT sufficient here; the revoke must name
 * `anon` AND `authenticated` (or revoke them at the schema level). This lint
 * makes the next one fail in CI instead of in production.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 * For every SECURITY DEFINER function a migration declares, one of these must be
 * true somewhere in the migrations corpus (a revoke may live in a later, atomic
 * follow-up migration — but if it is missing when CI runs, the build is red):
 *
 *   (a) EXECUTE is revoked from BOTH `anon` and `authenticated` for that
 *       function — `REVOKE EXECUTE ON FUNCTION <fn>(...) FROM ... anon ...
 *       authenticated`; or
 *   (b) its schema is sealed from both roles — `REVOKE EXECUTE ON ALL FUNCTIONS
 *       IN SCHEMA <s> FROM ... anon ... authenticated` or `REVOKE USAGE ON
 *       SCHEMA <s> FROM ... anon ... authenticated` (the entitlements shape); or
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
 * the sequentially-numbered migrations (≤ 148) are grandfathered. A short,
 * explicit list below grandfathers the pre-existing TIMESTAMPED migrations whose
 * SECURITY DEFINER functions revoke `FROM PUBLIC` only (esign_native,
 * post_event_survey) — that residual exposure is tracked by the DB review
 * (DB-N3), not silenced here. Everything newer must satisfy (a), (b) or (c).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const MIGRATIONS_DIR = 'supabase/migrations'

/** Mirrors check-migration-names.mjs: sequential migrations up to here predate
 *  the timestamp convention and this lint, and are frozen history. */
export const LAST_LEGACY = 148

/**
 * Pre-existing TIMESTAMPED migrations whose SECURITY DEFINER functions were
 * revoked `FROM PUBLIC` only — applied before this lint, so they cannot be
 * fixed by editing them (a new migration would be needed). Their residual
 * anon/authenticated EXECUTE is a known, separately-tracked DB-review item
 * (DB-N3), NOT an allowlist of "safe" functions. Do not add to this list to
 * silence a NEW migration — seal it (a/b) or annotate it (c) instead.
 */
export const GRANDFATHERED_PREEXISTING = [
  '20261002180802_esign_native_engine.sql', // esign_* audit/claim fns: FROM PUBLIC only
  '20261002235036_post_event_survey.sql', // survey_* fns: FROM PUBLIC only
  '20261003002925_post_event_survey_member_link.sql', // survey_follow_participant_member: FROM PUBLIC only
]

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

/** Does a REVOKE statement name BOTH anon and authenticated in its FROM clause?
 *  `FROM PUBLIC` alone is deliberately NOT enough (the esign two-step lesson). */
function revokesAnonAndAuthenticated(stmt) {
  const idx = stmt.toLowerCase().lastIndexOf(' from ')
  if (idx === -1) return false
  const roles = stmt.slice(idx + 6).toLowerCase()
  const tokens = roles.split(/[^a-z_]+/).filter(Boolean)
  return tokens.includes('anon') && tokens.includes('authenticated')
}

/**
 * Scan an array of { name, sql } migration files. Returns the offenders plus the
 * sealed sets (exposed for the self-test). Sealing is corpus-wide: a revoke in
 * any file counts, because an atomic follow-up migration is a valid shape.
 */
export function scanMigrations(files) {
  const schemaSealed = new Set()
  const funcSealed = new Set()
  const sdFunctions = []

  for (const { name: file, sql } of files) {
    for (const st of splitStatements(sql)) {
      const s = st.text
      let m
      if ((m = /revoke\s+execute\s+on\s+all\s+functions\s+in\s+schema\s+([a-z0-9_]+)/i.exec(s))) {
        if (revokesAnonAndAuthenticated(s)) schemaSealed.add(m[1].toLowerCase())
      } else if ((m = /revoke\s+usage\s+on\s+schema\s+([a-z0-9_]+)/i.exec(s))) {
        if (revokesAnonAndAuthenticated(s)) schemaSealed.add(m[1].toLowerCase())
      } else if ((m = /revoke\s+execute\s+on\s+function\s+(?:([a-z0-9_]+)\s*\.\s*)?([a-z0-9_]+)\s*\(/i.exec(s))) {
        if (revokesAnonAndAuthenticated(s)) {
          funcSealed.add(`${(m[1] || 'public').toLowerCase()}.${m[2].toLowerCase()}`)
        }
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

  const offenders = []
  for (const fn of sdFunctions) {
    const qualified = `${fn.schema}.${fn.name}`
    const sealed = schemaSealed.has(fn.schema) || funcSealed.has(qualified)
    const allowlisted = ALLOWLIST_MARKER.test(fn.raw)
    if (sealed || allowlisted || isGrandfathered(fn.file)) continue
    offenders.push({ file: fn.file, fn: qualified })
  }

  return { offenders, sdFunctions, schemaSealed, funcSealed }
}

export function readMigrationFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(`${dir}/${name}`, 'utf8') }))
}

function main() {
  const { offenders, sdFunctions } = scanMigrations(readMigrationFiles(MIGRATIONS_DIR))
  if (offenders.length) {
    console.error('\n✗ migration security: SECURITY DEFINER function(s) reachable by anon/authenticated\n')
    for (const o of offenders) console.error(`  ${o.file}\n    ${o.fn}`)
    console.error(
      '\n  A SECURITY DEFINER function bypasses RLS and is EXECUTE-able by anon +\n' +
        '  authenticated by default — an unauthenticated RPC on a public repo.\n' +
        '  In the SAME migration, add one of:\n\n' +
        '      REVOKE EXECUTE ON FUNCTION <schema>.<fn>(<args>) FROM anon, authenticated;\n' +
        '      REVOKE USAGE ON SCHEMA <schema> FROM anon, authenticated;        -- whole schema\n\n' +
        '  REVOKE ... FROM PUBLIC is NOT enough (Supabase grants anon/authenticated\n' +
        '  directly). If the function MUST keep a public role EXECUTE (an RLS helper),\n' +
        '  annotate it:  -- rls-helper: keep authenticated EXECUTE\n',
    )
    process.exit(1)
  }
  console.log(
    `✓ migration security: ${sdFunctions.length} SECURITY DEFINER function(s), all revoked from anon+authenticated, schema-sealed, or allowlisted`,
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
