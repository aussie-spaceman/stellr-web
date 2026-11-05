// S5 data-access inventory and shrink-only ratchets (multi-tenant plan S5, C2).
//
// Re-measures, from the source tree:
//   1. SERVICE ROLE: non-test files that reach supabaseServer() or
//      supabaseServerTyped() (lib/supabase.ts) or read the secret key, with the
//      registry tables their direct `.from('…')` calls touch.
//   2. EVENTS FACADE: non-test files that import one of the 8 Sanity event
//      getters straight from lib/sanity instead of lib/events/repo, and files
//      with their own raw `_type == "event"` GROQ.
//   3. AUDIT: every mutating route handler (POST/PUT/PATCH/DELETE, a cron's
//      GET/POST, a GET that writes) and whether an audit write is certain to
//      run (lib/security/audit-coverage.ts).
//   4. OPTIONAL-EVENT WRITERS: inserts and upserts into the 7 tables whose
//      event key is optional, and whether each writes a tenant_id from a tenant
//      context (docs/TENANCY-S3.md, "How tenant_id is derived").
//
// A SERVICE-ROLE CLASS STARTING "auto:" IS PROVISIONAL. The seeded classes are a
// heuristic over direct `.from()` calls, not a human decision. A later slice must
// not read a non-convert class as "needs no conversion" until a human has
// replaced that reason (isProvisionalClass). An "auto:" reason is accepted only
// for the files in the frozen seed list (test/baselines/service-role-seed.json).
//
// The baselines in test/baselines/ are written by this script, never by hand.
// The ratchet tests (test/service-role-ratchet.test.ts,
// test/events-facade-ratchet.test.ts) fail when a count GROWS, and also when
// it shrinks without the baseline being shrunk with it, so the ratchet only
// tightens. Audit coverage (test/audit-coverage.test.ts) and the
// optional-event writers (test/optional-event-tenant-id.test.ts) are
// report-only for now.
//
// Usage (tsx, because it imports the TypeScript registry and route AST):
//   npx tsx scripts/s5-inventory.mjs            summary and ratchet diffs
//   npx tsx scripts/s5-inventory.mjs --json     the full measurement as JSON
//   npx tsx scripts/s5-inventory.mjs --check    exit 1 when a ratchet grew or is stale
//   npx tsx scripts/s5-inventory.mjs --write    shrink the baselines to what is measured
//                                               (and regenerate the audit report)
//   npx tsx scripts/s5-inventory.mjs --write --allow-grow
//       also ADD new entries. A new service-role file gets class from the
//       heuristic and a reason starting "TODO:", which the ratchet test
//       rejects: replace it with a real reason before committing.
//   npx tsx scripts/s5-inventory.mjs --seed     write all baselines from scratch
//                                               (refuses when one already exists)
//   --root <dir>  measure another checkout (default: the current directory)
//
// Read-only unless --write or --seed. Never prints file contents.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { TABLE_REGISTRY } from '../lib/tenancy/registry'
import { resolveModule } from '../lib/security/route-ast'
import { auditHandlers } from '../lib/security/audit-coverage'

// ── What is scanned ──────────────────────────────────────────────────────────

/** Directories never scanned, by name at any depth. Any other directory is, so a new top-level one is seen. */
const SKIP_DIRS = new Set(['node_modules', 'public', 'storybook-static', 'dist', 'coverage', 'docs'])
const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/

/**
 * Test files by name, and the top-level test trees. A route segment named `test`
 * (app/api/…/test/route.ts) is app code, so only the repo-root test/ and e2e/
 * count, and a file with `.test.` in the middle of its name is not a test.
 */
export function isTestFile(file) {
  return /\.(test|spec)\.[cm]?[jt]sx?$|^test\/|^e2e\/|(^|\/)__tests__\//.test(file)
}

/** Repo-relative path → source, for every non-test source file under the root. Dot-directories are skipped. */
export function collectSources(root) {
  /** @type {Map<string, string>} */
  const out = new Map()
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name) || (e.isDirectory() && e.name.startsWith('.'))) continue
      const rel = dir ? `${dir}/${e.name}` : e.name
      if (e.isDirectory()) walk(rel)
      else if (SOURCE_EXT.test(e.name) && !e.name.endsWith('.d.ts') && !isTestFile(rel)) {
        out.set(rel, fs.readFileSync(path.join(root, rel), 'utf8'))
      }
    }
  }
  walk('')
  return new Map([...out.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

function parse(file, src) {
  const kind = /\.tsx$|\.jsx$/.test(file) ? ts.ScriptKind.TSX : /\.(m|c)?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  return ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind)
}

function walkNodes(node, visit) {
  visit(node)
  ts.forEachChild(node, (c) => walkNodes(c, visit))
}

function stringArg(call, i = 0) {
  const a = call.arguments[i]
  return a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) ? a.text : null
}

function calleeName(call) {
  const e = call.expression
  if (ts.isIdentifier(e)) return e.text
  if (ts.isPropertyAccessExpression(e)) return e.name.text
  return null
}

const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

// ── 1. Service role ──────────────────────────────────────────────────────────

export const SERVICE_ROLE_FNS = ['supabaseServer', 'supabaseServerTyped']
export const SERVICE_ROLE_CLASSES = ['convert', 'stellr_only', 'identity', 'platform', 'system', 'script']
/** The modules that define the service-role clients and read the secret key for them. */
export const SERVICE_ROLE_EXEMPT = ['lib/supabase.ts', 'lib/supabase-keys.ts']
const SECRET_KEY_FN = 'supabaseSecretKey'
const SECRET_KEY_ENV = ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
const SERVICE_ROLE_MODULES = ['lib/supabase', 'lib/supabase-keys']
const SERVICE_ROLE_NAMES = [...SERVICE_ROLE_FNS, SECRET_KEY_FN]

/** The registry key for a bare `.from('name')` table, or `?name` when unregistered. */
export function registryTable(name) {
  if (name.includes('.') && TABLE_REGISTRY[name]) return name
  if (TABLE_REGISTRY[`public.${name}`]) return `public.${name}`
  const other = Object.keys(TABLE_REGISTRY).find((k) => k.endsWith(`.${name}`))
  return other ?? `?${name}`
}

/**
 * Uses the service role, the tables its direct `.from()` calls name, and whether
 * it `reachesUnnamedTables` (see below). A file uses it when it:
 *   - calls, imports, destructures, reads as a property or re-exports
 *     supabaseServer()/supabaseServerTyped() (an alias or a passed reference is
 *     still a use), or `export *`s the module that defines them;
 *   - reads the secret key anywhere outside SERVICE_ROLE_EXEMPT, whichever client
 *     it then builds (createClient, createServerClient, new SupabaseClient, or a
 *     raw REST call): the env var, or an import of supabaseSecretKey;
 *   - names the env var in a string and makes a client (`process.env[name]`).
 *
 * reachesUnnamedTables is true for `.from(variable)`, any `.rpc()`, and a service
 * client passed as an argument: those touch tables `tables` does not list.
 */
export function serviceRoleFacts(file, src) {
  if (SERVICE_ROLE_EXEMPT.includes(file)) return null
  if (![...SERVICE_ROLE_NAMES, ...SECRET_KEY_ENV].some((n) => src.includes(n))) return null
  const sf = parse(file, src)
  let uses = false
  let namesKeyInString = false
  let makesClient = false
  let reachesUnnamedTables = false
  const tables = new Set()
  /** Local names of supabaseServer/supabaseServerTyped, and names bound to a client they returned. */
  const fnNames = new Set(SERVICE_ROLE_FNS)
  const clientNames = new Set()
  const callArgs = []
  const isServiceRoleModule = (spec) => SERVICE_ROLE_MODULES.includes(resolveModule(file, spec))
  walkNodes(sf, (n) => {
    if (ts.isImportSpecifier(n) && !n.isTypeOnly && SERVICE_ROLE_NAMES.includes((n.propertyName ?? n.name).text)) {
      const decl = n.parent.parent.parent
      if (!decl.importClause?.isTypeOnly && ts.isStringLiteral(decl.moduleSpecifier) && isServiceRoleModule(decl.moduleSpecifier.text)) {
        uses = true
        if (SERVICE_ROLE_FNS.includes((n.propertyName ?? n.name).text)) fnNames.add(n.name.text)
      }
    }
    if (ts.isExportDeclaration(n) && !n.isTypeOnly && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && isServiceRoleModule(n.moduleSpecifier.text)) {
      const clause = n.exportClause
      if (!clause || !ts.isNamedExports(clause) || clause.elements.some((el) => !el.isTypeOnly && SERVICE_ROLE_NAMES.includes((el.propertyName ?? el.name).text))) uses = true
    }
    // const { supabaseServer: db } = await import('@/lib/supabase'), and the shorthand.
    if (ts.isBindingElement(n)) {
      const key = n.propertyName ?? n.name
      if (ts.isIdentifier(key) && SERVICE_ROLE_NAMES.includes(key.text)) {
        uses = true
        if (ts.isIdentifier(n.name) && SERVICE_ROLE_FNS.includes(key.text)) fnNames.add(n.name.text)
      }
    }
    // A client function or the env var, read as a property or by a string key.
    if (ts.isPropertyAccessExpression(n) && SERVICE_ROLE_NAMES.includes(n.name.text)) uses = true
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && [...SERVICE_ROLE_NAMES, ...SECRET_KEY_ENV].includes(n.argumentExpression.text)) uses = true
    if (ts.isIdentifier(n) && SECRET_KEY_ENV.includes(n.text)) uses = true
    if (ts.isStringLiteralLike(n) && SECRET_KEY_ENV.includes(n.text)) namesKeyInString = true
    if (ts.isNewExpression(n)) {
      if (ts.isIdentifier(n.expression) && n.expression.text === 'SupabaseClient') makesClient = true
      callArgs.push(...(n.arguments ?? []))
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      let init = n.initializer
      while (ts.isAwaitExpression(init) || ts.isParenthesizedExpression(init) || ts.isAsExpression(init) || ts.isNonNullExpression(init)) init = init.expression
      if (ts.isCallExpression(init) && fnNames.has(calleeName(init))) clientNames.add(n.name.text)
    }
    if (!ts.isCallExpression(n)) return
    callArgs.push(...n.arguments)
    const name = calleeName(n)
    if (name && SERVICE_ROLE_NAMES.includes(name)) uses = true
    if (name && fnNames.has(name)) uses = true
    if (name === 'createClient' || name === 'createServerClient') makesClient = true
    if (name === 'rpc' && ts.isPropertyAccessExpression(n.expression)) reachesUnnamedTables = true
    if (name === 'from' && ts.isPropertyAccessExpression(n.expression)) {
      const recv = n.expression.expression
      // supabase.storage.from('bucket') names a bucket, not a table.
      if (ts.isPropertyAccessExpression(recv) && recv.name.text === 'storage') return
      // Array.from(x), Buffer.from(x), Readable.from(x) are not queries.
      if (ts.isIdentifier(recv) && /^[A-Z]/.test(recv.text)) return
      const t = stringArg(n)
      if (t) tables.add(registryTable(t))
      else reachesUnnamedTables = true
    }
  })
  const passesClient = (a) => {
    if (ts.isIdentifier(a)) return clientNames.has(a.text) || fnNames.has(a.text)
    if (ts.isCallExpression(a) && fnNames.has(calleeName(a))) return true
    if (ts.isShorthandPropertyAssignment(a)) return clientNames.has(a.name.text) || fnNames.has(a.name.text)
    if (ts.isPropertyAssignment(a)) return passesClient(a.initializer)
    if (ts.isObjectLiteralExpression(a)) return a.properties.some(passesClient)
    if (ts.isArrayLiteralExpression(a)) return a.elements.some(passesClient)
    if (ts.isAwaitExpression(a) || ts.isParenthesizedExpression(a) || ts.isAsExpression(a) || ts.isNonNullExpression(a)) return passesClient(a.expression)
    return false
  }
  if (callArgs.some(passesClient)) reachesUnnamedTables = true
  return uses || (makesClient && namesKeyInString) ? { tables: [...tables].sort(), reachesUnnamedTables } : null
}

const TENANT_CLASSES = new Set(['event_scoped', 'tenant_scoped'])
/** Classes that say a file has nothing to convert. Heuristic until a human confirms: see isProvisionalClass. */
const NON_CONVERT_CLASSES = ['stellr_only', 'identity', 'platform', 'system']

/** The registry tables in this list that hold tenant or event data. */
const tenantTablesIn = (tables) => tables.filter((t) => TENANT_CLASSES.has(TABLE_REGISTRY[t]?.class))

/**
 * True for an entry whose class is still the seed heuristic's guess. A later
 * slice must not treat such a class as a conversion exemption.
 */
export function isProvisionalClass(entry) {
  return typeof entry?.reason === 'string' && /^\s*auto\s*:/i.test(entry.reason)
}

/**
 * A first class and reason for a service-role file, from its path and the
 * registry classes of the tables it touches. A heuristic over direct `.from()`
 * calls: a file that reaches tables it does not name is always `convert`, and an
 * "auto:" entry is provisional (isProvisionalClass). --write re-derives an
 * "auto:" entry and keeps a human class and reason.
 */
export function classifyServiceRole(file, tables, reachesUnnamedTables = false) {
  const short = (t) => t.replace(/^public\./, '')
  const list = tables.length
    ? `; tables: ${tables.slice(0, 6).map(short).join(', ')}${tables.length > 6 ? ` (+${tables.length - 6})` : ''}`
    : ''
  if (file.startsWith('scripts/')) return { class: 'script', reason: `auto: operator script, run by hand${list}` }
  if (tenantTablesIn(tables).length === 0 && reachesUnnamedTables) {
    return { class: 'convert', reason: `auto: reaches tables it does not name (dynamic .from, rpc, or a client passed to a helper); review before converting${list}` }
  }
  const classes = new Set(tables.map((t) => TABLE_REGISTRY[t]?.class).filter(Boolean))
  if ([...classes].some((c) => TENANT_CLASSES.has(c))) {
    return { class: 'convert', reason: `auto: touches tenant or event-scoped tables${list}` }
  }
  for (const c of NON_CONVERT_CLASSES) {
    if (classes.has(c)) return { class: c, reason: `auto: no tenant or event-scoped table, classed by its ${c} tables${list}` }
  }
  return { class: 'convert', reason: `auto: no registry table in a direct .from() (helpers, rpc or storage); review before converting${list}` }
}

// ── 2. Events facade ─────────────────────────────────────────────────────────

/** The Sanity event getters in lib/sanity.ts that lib/events/repo.ts fronts. */
export const SANITY_EVENT_GETTERS = [
  'getAllEvents',
  'getEventBySlug',
  'getEventsByIds',
  'getEventsBySlugs',
  'getEventsForHubspotSync',
  'getEventsForSchema',
  'getEventsForSurveySchedule',
  'getFeaturedEvents',
]
/** The module that defines the getters and the facade allowed to import them. */
export const EVENTS_FACADE_EXEMPT = ['lib/sanity.ts', 'lib/events/repo.ts']

/** The Sanity event getters this file takes straight from lib/sanity. */
export function sanityGetterImports(file, src) {
  if (EVENTS_FACADE_EXEMPT.includes(file) || !src.includes('sanity')) return []
  const sf = parse(file, src)
  const isSanity = (spec) => resolveModule(file, spec) === 'lib/sanity'
  const got = new Set()
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier) && isSanity(stmt.moduleSpecifier.text)) {
      const nb = stmt.importClause?.namedBindings
      if (nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) {
          const name = (el.propertyName ?? el.name).text
          if (SANITY_EVENT_GETTERS.includes(name)) got.add(name)
        }
      } else if (nb && ts.isNamespaceImport(nb)) {
        for (const g of SANITY_EVENT_GETTERS) if (new RegExp(`\\b${nb.name.text}\\.${g}\\b`).test(src)) got.add(g)
      }
    }
    if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) && isSanity(stmt.moduleSpecifier.text)) {
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          const name = (el.propertyName ?? el.name).text
          if (SANITY_EVENT_GETTERS.includes(name)) got.add(name)
        }
      } else {
        for (const g of SANITY_EVENT_GETTERS) got.add(g)
      }
    }
  }
  // Dynamic `await import('…/lib/sanity')`: the destructured names, or, when the
  // module object is kept whole, any getter name the file mentions.
  walkNodes(sf, (n) => {
    if (!ts.isCallExpression(n) || n.expression.kind !== ts.SyntaxKind.ImportKeyword) return
    const spec = stringArg(n)
    if (!spec || !isSanity(spec)) return
    let p = n.parent
    while (p && (ts.isAwaitExpression(p) || ts.isParenthesizedExpression(p))) p = p.parent
    if (p && ts.isVariableDeclaration(p) && ts.isObjectBindingPattern(p.name)) {
      for (const el of p.name.elements) {
        const key = el.propertyName ?? el.name
        if (ts.isIdentifier(key) && SANITY_EVENT_GETTERS.includes(key.text)) got.add(key.text)
      }
    } else {
      for (const g of SANITY_EVENT_GETTERS) if (new RegExp(`\\b${g}\\b`).test(src)) got.add(g)
    }
  })
  return [...got].sort()
}

/**
 * Files allowed their own raw event GROQ: the facade, and lib/events/sync.ts, the
 * mirror writer, which reads Sanity directly in order to fill Postgres.
 */
export const RAW_EVENT_GROQ_EXEMPT = [...EVENTS_FACADE_EXEMPT, 'lib/events/sync.ts']
const RAW_EVENT_GROQ = /_type\s*==\s*["']event["']/

/** The file holds its own `_type == "event"` GROQ, so its reads bypass the facade and any tenant filter there. */
export function hasRawEventGroq(file, src) {
  if (RAW_EVENT_GROQ_EXEMPT.includes(file) || !RAW_EVENT_GROQ.test(src)) return false
  let found = false
  walkNodes(parse(file, src), (n) => {
    if ((ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && RAW_EVENT_GROQ.test(n.text)) found = true
  })
  return found
}

// ── 4. Optional-event writers ────────────────────────────────────────────────

/**
 * Tables whose event key is optional, so the S3 trigger cannot derive a
 * tenant: the app must write tenant_id itself before derivation_mode goes to
 * enforce (docs/TENANCY-S3.md).
 */
export const OPTIONAL_EVENT_TABLES = [
  'community_resources',
  'community_spaces',
  'member_groups',
  'mentoring_cohorts',
  'refund_policies',
  'store_orders',
  'training_modules',
]

/** A tenant_id read from one of these came from the request, so the caller chose the tenant. */
const UNTRUSTED_NAMES = new Set(['body', 'json', 'params', 'searchParams', 'nextUrl', 'query', 'form', 'formData', 'payload', 'input', 'req', 'request'])
/** Where a tenant_id may come from: an identifier named this, a property of one of these, or a call named like it. */
const TENANT_IDENTIFIERS = new Set(['tenantId', 'STELLR_TENANT_ID'])
const TENANT_CONTEXT_ROOTS = new Set(['ctx', 'context', 'tenantCtx', 'tenantContext', 'tenant', 'tdb'])

function peel(expr) {
  let e = expr
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e) || ts.isAwaitExpression(e)) e = e.expression
  return e
}

function readsRequest(expr) {
  let found = false
  walkNodes(expr, (n) => {
    if (ts.isIdentifier(n) && UNTRUSTED_NAMES.has(n.text)) found = true
  })
  return found
}

/** The initializer that binds this name in an enclosing scope, or null. */
function initializerOf(id) {
  const binds = (name) => (ts.isIdentifier(name) ? name.text === id.text : name.elements.some((el) => ts.isBindingElement(el) && binds(el.name)))
  for (let n = id.parent; n; n = n.parent) {
    const statements = ts.isBlock(n) || ts.isSourceFile(n) ? n.statements : null
    if (!statements) continue
    for (const s of statements) {
      if (!ts.isVariableStatement(s)) continue
      for (const d of s.declarationList.declarations) if (binds(d.name)) return d.initializer ?? null
    }
  }
  return null
}

/** How safe a tenant_id value is. 'indirect' means the scan cannot tell. */
function tenantValue(expr) {
  const v = peel(expr)
  if (v.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(v) && v.text === 'undefined')) return 'missing'
  if (readsRequest(v)) return 'untrusted'
  if (ts.isIdentifier(v)) {
    const init = initializerOf(v)
    if (init && readsRequest(init)) return 'untrusted'
    return TENANT_IDENTIFIERS.has(v.text) ? 'explicit' : 'indirect'
  }
  if (ts.isCallExpression(v)) return /tenantId$/i.test(calleeName(v) ?? '') ? 'explicit' : 'indirect'
  if (ts.isPropertyAccessExpression(v)) {
    let root = v
    while (ts.isPropertyAccessExpression(root)) root = root.expression
    return ts.isIdentifier(root) && TENANT_CONTEXT_ROOTS.has(root.text) ? 'explicit' : 'indirect'
  }
  return 'indirect'
}

function tenantIdInRow(obj) {
  const key = (p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null)
  const props = [...obj.properties]
  const at = props.findLastIndex((p) => key(p) === 'tenant_id')
  if (at < 0) return props.some((p) => ts.isSpreadAssignment(p)) ? 'indirect' : 'missing'
  // A later spread can overwrite it, so the row may carry the caller's tenant.
  if (props.slice(at + 1).some((p) => ts.isSpreadAssignment(p))) return 'indirect'
  const p = props[at]
  if (ts.isShorthandPropertyAssignment(p)) return tenantValue(p.name)
  return ts.isPropertyAssignment(p) ? tenantValue(p.initializer) : 'indirect'
}

/**
 * 'explicit': tenant_id comes from a tenant context (ctx.tenantId, tenantId).
 * 'untrusted': it comes from the request. 'missing': absent, null or undefined.
 * 'indirect': the row is built elsewhere, or the value cannot be judged.
 */
function tenantIdIn(arg) {
  if (!arg) return 'missing'
  let a = arg
  while (ts.isParenthesizedExpression(a) || ts.isAsExpression(a) || ts.isSatisfiesExpression(a)) a = a.expression
  if (ts.isObjectLiteralExpression(a)) return tenantIdInRow(a)
  if (ts.isArrayLiteralExpression(a)) {
    const rows = a.elements.map((e) => tenantIdIn(e))
    if (rows.includes('untrusted')) return 'untrusted'
    if (rows.length && rows.every((r) => r === 'explicit')) return 'explicit'
    return rows.includes('missing') ? 'missing' : 'indirect'
  }
  return 'indirect'
}

/** Every `.from('<optional-event table>').insert|upsert(…)` in the file. */
export function optionalEventWrites(file, src) {
  if (!OPTIONAL_EVENT_TABLES.some((t) => src.includes(t)) || !/\b(insert|upsert)\s*\(/.test(src)) return []
  const sf = parse(file, src)
  const out = []
  walkNodes(sf, (n) => {
    if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return
    const op = n.expression.name.text
    if (op !== 'insert' && op !== 'upsert') return
    // Walk down the receiver chain to the .from('table') call.
    let r = n.expression.expression
    while (r) {
      if (ts.isCallExpression(r)) {
        if (calleeName(r) === 'from') {
          const t = stringArg(r)
          if (t && OPTIONAL_EVENT_TABLES.includes(t)) {
            const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
            out.push({ file, line, table: t, op, tenantId: tenantIdIn(n.arguments[0]) })
          }
          return
        }
        r = r.expression
      } else if (ts.isPropertyAccessExpression(r) || ts.isParenthesizedExpression(r) || ts.isNonNullExpression(r) || ts.isAwaitExpression(r)) {
        r = r.expression
      } else {
        return
      }
    }
  })
  return out
}

// ── Measurement ──────────────────────────────────────────────────────────────

/** Measure a set of sources (repo-relative path → source). */
export function measure(sources) {
  /** @type {Record<string, {tables: string[]}>} */
  const serviceRole = {}
  /** @type {Record<string, string[]>} */
  const getters = {}
  const rawEventQueries = []
  const mutations = []
  const optionalWriters = []
  for (const [file, src] of sources) {
    if (isTestFile(file)) continue
    const sr = serviceRoleFacts(file, src)
    if (sr) serviceRole[file] = sr
    const g = sanityGetterImports(file, src)
    if (g.length) getters[file] = g
    if (hasRawEventGroq(file, src)) rawEventQueries.push(file)
    mutations.push(...auditHandlers(file, src))
    optionalWriters.push(...optionalEventWrites(file, src))
  }
  mutations.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return { serviceRole: sortObj(serviceRole), getters: sortObj(getters), rawEventQueries: rawEventQueries.sort(), mutations, optionalWriters }
}

export function summarize(m) {
  const muts = m.mutations.filter((h) => h.kind === 'mutation')
  const crons = m.mutations.filter((h) => h.kind === 'cron')
  const gets = m.mutations.filter((h) => h.kind === 'get_mutation')
  return {
    serviceRoleFiles: Object.keys(m.serviceRole).length,
    sanityGetterImporters: Object.keys(m.getters).length,
    rawEventQueryFiles: m.rawEventQueries.length,
    mutatingHandlers: muts.length,
    mutatingHandlersAudited: muts.filter((h) => h.audited).length,
    mutatingHandlersConditional: muts.filter((h) => h.coverage === 'conditional').length,
    mutatingRouteFiles: new Set(muts.map((h) => h.file)).size,
    cronHandlers: crons.length,
    cronHandlersAudited: crons.filter((h) => h.audited).length,
    getMutationHandlers: gets.length,
    getMutationHandlersAudited: gets.filter((h) => h.audited).length,
    optionalEventWrites: m.optionalWriters.length,
    optionalEventWritesExplicit: m.optionalWriters.filter((w) => w.tenantId === 'explicit').length,
    optionalEventWritesUntrusted: m.optionalWriters.filter((w) => w.tenantId === 'untrusted').length,
  }
}

// ── Baselines and ratchet diffs ──────────────────────────────────────────────

export const BASELINE_DIR = 'test/baselines'
export const BASELINE_FILES = {
  serviceRole: 'service-role-files.json',
  serviceRoleSeed: 'service-role-seed.json',
  getters: 'sanity-event-getters.json',
  audit: 'unaudited-mutations.json',
}

const GENERATED = 'Generated by `npx tsx scripts/s5-inventory.mjs`; never edit counts by hand. Shrink-only:'

export function serviceRoleBaseline(files) {
  return {
    $comment: `${GENERATED} a new service-role file needs a class (${SERVICE_ROLE_CLASSES.join(' | ')}) and a reason written by a person. A reason starting "auto:" marks a PROVISIONAL class, a heuristic over direct .from() calls: do not read a non-convert class as "needs no conversion" until a person has replaced that reason. See test/service-role-ratchet.test.ts.`,
    files: sortObj(files),
  }
}

export function serviceRoleSeedBaseline(files) {
  return {
    $comment: `${GENERATED} the only files allowed an "auto:" reason in service-role-files.json. It never gains a file; a file leaves when a person replaces its reason.`,
    files: [...files].sort(),
  }
}

export function gettersBaseline(files, rawEventQueries = []) {
  return {
    $comment: `${GENERATED} import event getters from @/lib/events/repo, not @/lib/sanity, and add no raw event GROQ. See test/events-facade-ratchet.test.ts.`,
    files: sortObj(files),
    rawEventQueries: [...rawEventQueries].sort(),
  }
}

export function auditBaseline(m) {
  const s = summarize(m)
  const unaudited = (kind) => m.mutations.filter((h) => h.kind === kind && !h.audited).map((h) => h.key)
  return {
    $comment: `${GENERATED} report-only until S5-DA-5 makes it enforcing. Handlers where an audit() write (lib/audit/platform) is not certain to run, including a conditional one. See test/audit-coverage.test.ts.`,
    totals: {
      mutatingHandlers: s.mutatingHandlers,
      unauditedMutations: s.mutatingHandlers - s.mutatingHandlersAudited,
      cronHandlers: s.cronHandlers,
      unauditedCrons: s.cronHandlers - s.cronHandlersAudited,
      getMutations: s.getMutationHandlers,
      unauditedGetMutations: s.getMutationHandlers - s.getMutationHandlersAudited,
    },
    mutations: unaudited('mutation'),
    crons: unaudited('cron'),
    getMutations: unaudited('get_mutation'),
  }
}

/**
 * Problems with one service-role baseline entry (empty when valid). `seed` is the
 * frozen list of files allowed an "auto:" reason; a file outside it needs a
 * person's reason, so a copied generated string does not pass.
 */
export function serviceRoleEntryProblems(file, entry, seed = []) {
  const out = []
  if (!entry || typeof entry !== 'object') return [`${file}: entry must be { class, reason }`]
  if (!SERVICE_ROLE_CLASSES.includes(entry.class)) out.push(`${file}: class must be one of ${SERVICE_ROLE_CLASSES.join(', ')}`)
  if (typeof entry.reason !== 'string' || entry.reason.trim().length < 8) out.push(`${file}: needs a reason`)
  else if (/^\s*TODO/i.test(entry.reason)) out.push(`${file}: replace the TODO reason with a real one`)
  else if (isProvisionalClass(entry) && !seed.includes(file)) out.push(`${file}: an "auto:" reason is only for the seeded files; say why this file needs the service role`)
  return out
}

/** The class says there is nothing to convert, but the file's live facts disagree. */
function classProblems(file, entry, facts) {
  if (!entry || !facts || !NON_CONVERT_CLASSES.includes(entry.class)) return []
  const tenant = tenantTablesIn(facts.tables)
  if (tenant.length) return [`${file}: class ${entry.class}, but it touches ${tenant.join(', ')}; the class must be convert`]
  if (isProvisionalClass(entry) && facts.reachesUnnamedTables) {
    return [`${file}: provisional class ${entry.class}, but it reaches tables it does not name; run --write, or have a person confirm the class`]
  }
  return []
}

/** New service-role files (growth), stale baseline entries (shrink not recorded), invalid entries. */
export function serviceRoleDiff(baseline, measured, seed = []) {
  const base = baseline?.files ?? {}
  return {
    added: Object.keys(measured).filter((f) => !(f in base)),
    stale: Object.keys(base).filter((f) => !(f in measured)),
    invalid: Object.entries(base).flatMap(([f, e]) => [...serviceRoleEntryProblems(f, e, seed), ...classProblems(f, e, measured[f])]),
  }
}

/** New files with raw event GROQ (growth) and stale baseline entries. */
export function rawEventQueriesDiff(baseline, measured) {
  const base = baseline?.rawEventQueries ?? []
  return { added: measured.filter((f) => !base.includes(f)), stale: base.filter((f) => !measured.includes(f)) }
}

/** Per file and getter: new direct imports (growth) and stale baseline entries. */
export function gettersDiff(baseline, measured) {
  const base = baseline?.files ?? {}
  const pairs = (o) => new Set(Object.entries(o).flatMap(([f, gs]) => gs.map((g) => `${f}: ${g}`)))
  const b = pairs(base)
  const m = pairs(measured)
  return { added: [...m].filter((p) => !b.has(p)), stale: [...b].filter((p) => !m.has(p)) }
}

/** Newly unaudited handlers and handlers the baseline lists that are now audited (or gone). */
export function auditDiff(baseline, m) {
  const want = auditBaseline(m)
  const base = new Set([...(baseline?.mutations ?? []), ...(baseline?.crons ?? []), ...(baseline?.getMutations ?? [])])
  const now = new Set([...want.mutations, ...want.crons, ...want.getMutations])
  return { added: [...now].filter((k) => !base.has(k)), stale: [...base].filter((k) => !now.has(k)) }
}

export function readBaseline(root, which) {
  const p = path.join(root, BASELINE_DIR, BASELINE_FILES[which])
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null
}

function writeBaseline(root, which, data) {
  const dir = path.join(root, BASELINE_DIR)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, BASELINE_FILES[which]), `${JSON.stringify(data, null, 2)}\n`)
}

/**
 * The next service-role baseline: drop stale entries, keep a person's class and
 * reason, re-derive an "auto:" entry from the live facts, and (only with
 * allowGrow) add new files with a TODO reason.
 */
export function nextServiceRoleFiles(baseline, measured, { allowGrow = false, seed = false } = {}) {
  const base = baseline?.files ?? {}
  const out = {}
  for (const [f, facts] of Object.entries(measured)) {
    const c = classifyServiceRole(f, facts.tables, facts.reachesUnnamedTables)
    if (base[f]) out[f] = isProvisionalClass(base[f]) ? c : base[f]
    else if (seed) out[f] = c
    else if (allowGrow) out[f] = { class: c.class, reason: `TODO: say why this file needs the service role (${c.reason.replace(/^auto:\s*/, '')})` }
  }
  return out
}

/** The next seed list: only ever a subset of the last one, and only files still on "auto:". */
export function nextServiceRoleSeed(seed, files) {
  return (seed?.files ?? []).filter((f) => isProvisionalClass(files[f]))
}

/** The next raw-GROQ list: drop stale files and (only with allowGrow) add new ones. */
export function nextRawEventQueries(baseline, measured, { allowGrow = false, seed = false } = {}) {
  return seed || allowGrow ? [...measured] : measured.filter((f) => (baseline?.rawEventQueries ?? []).includes(f))
}

/** The next getters baseline: drop stale pairs and (only with allowGrow) add new ones. */
export function nextGetterFiles(baseline, measured, { allowGrow = false, seed = false } = {}) {
  const base = baseline?.files ?? {}
  const out = {}
  for (const [f, gs] of Object.entries(measured)) {
    const keep = seed || allowGrow ? gs : gs.filter((g) => (base[f] ?? []).includes(g))
    if (keep.length) out[f] = keep
  }
  return out
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function main(argv) {
  const flag = (f) => argv.includes(f)
  const ri = argv.indexOf('--root')
  const root = path.resolve(ri >= 0 ? argv[ri + 1] : process.cwd())
  const m = measure(collectSources(root))

  if (flag('--json')) {
    process.stdout.write(`${JSON.stringify({ summary: summarize(m), ...m }, null, 2)}\n`)
    return 0
  }

  if (flag('--seed')) {
    const existing = Object.keys(BASELINE_FILES).filter((w) => readBaseline(root, w))
    if (existing.length) {
      console.error(`--seed refuses: baselines already exist (${existing.join(', ')}). Use --write.`)
      return 1
    }
    const files = nextServiceRoleFiles(null, m.serviceRole, { seed: true })
    writeBaseline(root, 'serviceRole', serviceRoleBaseline(files))
    writeBaseline(root, 'serviceRoleSeed', serviceRoleSeedBaseline(Object.keys(files)))
    writeBaseline(root, 'getters', gettersBaseline(nextGetterFiles(null, m.getters, { seed: true }), nextRawEventQueries(null, m.rawEventQueries, { seed: true })))
    writeBaseline(root, 'audit', auditBaseline(m))
    console.log('Seeded', Object.values(BASELINE_FILES).map((f) => `${BASELINE_DIR}/${f}`).join(', '))
    console.log(summarize(m))
    return 0
  }

  const sr = readBaseline(root, 'serviceRole')
  const seedList = readBaseline(root, 'serviceRoleSeed')
  const gb = readBaseline(root, 'getters')
  const ab = readBaseline(root, 'audit')

  if (flag('--write')) {
    const allowGrow = flag('--allow-grow')
    const files = nextServiceRoleFiles(sr, m.serviceRole, { allowGrow })
    writeBaseline(root, 'serviceRole', serviceRoleBaseline(files))
    writeBaseline(root, 'serviceRoleSeed', serviceRoleSeedBaseline(nextServiceRoleSeed(seedList, files)))
    writeBaseline(root, 'getters', gettersBaseline(nextGetterFiles(gb, m.getters, { allowGrow }), nextRawEventQueries(gb, m.rawEventQueries, { allowGrow })))
    writeBaseline(root, 'audit', auditBaseline(m))
  }

  const reread = (which, before) => (flag('--write') ? readBaseline(root, which) : before)
  const srd = serviceRoleDiff(reread('serviceRole', sr), m.serviceRole, reread('serviceRoleSeed', seedList)?.files ?? [])
  const gd = gettersDiff(reread('getters', gb), m.getters)
  const rd = rawEventQueriesDiff(reread('getters', gb), m.rawEventQueries)
  const ad = auditDiff(reread('audit', ab), m)
  console.log('S5 data-access inventory', summarize(m))
  const show = (label, list) => {
    if (!list.length) return
    console.log(`\n${label} (${list.length}):`)
    for (const x of list) console.log(`  ${x}`)
  }
  show('Service role: NEW files (ratchet fails)', srd.added)
  show('Service role: stale baseline entries (run --write)', srd.stale)
  show('Service role: invalid baseline entries', srd.invalid)
  show('Sanity getters: NEW direct imports (ratchet fails; use @/lib/events/repo)', gd.added)
  show('Sanity getters: stale baseline entries (run --write)', gd.stale)
  show('Raw event GROQ: NEW files (ratchet fails; read through @/lib/events/repo)', rd.added)
  show('Raw event GROQ: stale baseline entries (run --write)', rd.stale)
  show('Audit (report-only): newly unaudited handlers', ad.added)
  show('Audit (report-only): baseline entries now audited or gone (run --write)', ad.stale)
  const failed = srd.added.length + srd.stale.length + srd.invalid.length + gd.added.length + gd.stale.length + rd.added.length + rd.stale.length
  return flag('--check') && failed ? 1 : 0
}

const invoked = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) process.exitCode = main(process.argv.slice(2))
