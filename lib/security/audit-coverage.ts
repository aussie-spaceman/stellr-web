// Audit coverage of route handlers (docs/TENANCY-S5.md, C7): the enforcing gate.
//
// Test-only, like route-ast.ts: imported by scripts/s5-inventory.mjs and the
// ratchet tests, never by app code.
//
// A MUTATION is an exported POST, PUT, PATCH or DELETE handler of an App Router
// route file. A cron route (app/api/cron/**) mutates on GET, so its GET and POST
// count too, as kind 'cron'. A GET that writes is kind 'get_mutation': one whose
// own code, same-file helpers, or helpers in other modules of the repo reach
// insert, update, upsert, delete, a storage write or an rpc that is not listed in
// READ_ONLY_RPCS. An exported GET that cannot be followed (re-exported,
// destructured) is reported the same way.
//
// COVERAGE is one of:
//   - 'mandatory': the only value that counts as audited. Either the exported
//     handler is withAudit, alone or as the only argument of another wrapper, which
//     covers every path by construction (a cron route may use withCronAudit), or all of
//     these hold:
//       * an audit write sits in the handler's top-level statements or in a finally
//         block, directly or through a same-file helper;
//       * no path answers success after something that may have written, before
//         an audit write has certainly run (see "Paths" below);
//       * the write is awaited or returned, or deferred with afterResponse: a bare
//         audit() can be lost when the instance is frozen. One kept in a variable has
//         to be awaited or returned later in the same function.
//     A writer or withAudit given an `enabled` option, or options the gate cannot read
//     (a variable, a spread), does not count: those can turn the write off. Nor does
//     withAudit given a spec that may answer with no event (specAlwaysAnswers).
//   - 'conditional': the handler reaches an audit write, but not on every such path.
//   - 'exempt': listed in AUDIT_EXEMPTIONS with its reason. Leaves the baseline.
//   - 'none'.
//
// An audit write is a call of one of AUDIT_WRITERS, imported from that writer's own
// module. The name alone is never enough: a same-file `audit()` or an `audit` from
// another module does not count, the same origin rule route-guards.ts applies to
// guards. An audit write inside a helper in another module does not count either:
// use withAudit, or call a writer from the handler.
//
// PATHS. A return with a literal status of 400 or more, or a throw, is treated as
// the write having failed: that is what `if (error) return json(…, { status: 500 })`
// means, and a guard refusal has written nothing. Any other return is treated as
// success, so an error helper with no literal status and an unknown `return res`
// fail closed. In a try block, the last statement is treated as the one that threw.
//
// LIMITS, which a clean report does not rule out:
//   - a 4xx or 5xx returned after an earlier write that did succeed is not seen as
//     a mutation. withAudit records a 5xx, so prefer it where that can happen;
//   - a write in a class method, a shorthand member of an exported object, a
//     default-exported helper, or a function another module only returns is not
//     followed. The only default export in lib/ today is lib/tokens.ts;
//   - a write in a helper OPERATIONAL_WRITERS names is not counted. That list awaits the
//     owner's decision, below.
//
// A handler re-exported from another module (`export { POST } from './x'`) and any
// `export *` cannot be followed, so they are reported as unaudited.
import ts from 'typescript'
import {
  analyzeNamedExport,
  analyzeNodeFacts,
  analyzeRoute,
  bindingOf,
  DB_WRITE_CALLS,
  exportedNames,
  exportedObjectsWith,
  fileModule,
  parseSource,
  reExportsOf,
  resolveModule,
  type HandlerFacts,
} from './route-ast'

export { DB_WRITE_CALLS }

/** Calls that write a platform audit event, each with the module it must come from. */
export const AUDIT_WRITERS: Record<string, readonly string[]> = {
  audit: ['lib/audit/platform'],
  auditMutation: ['lib/audit/route'],
}

/** Wrappers that audit every path of the handler they are given. */
export const AUDIT_WRAPPERS: Record<string, readonly string[]> = {
  withAudit: ['lib/audit/route'],
  withCronAudit: ['lib/cron-audit'],
}

/**
 * Handlers that need no audit event, by `<file>#<METHOD>`, each with its reason. A
 * test fails on an entry with no real reason, one for a handler that no longer exists,
 * and one for a handler that audits anyway.
 *
 * Empty on purpose. Exempting a write is the owner's decision (docs/TENANCY-S5.md,
 * Owner gates: "audit exemptions for anonymous writes"). Proposed, not granted:
 * `contact`, `subscribe`, `lp-lead`, `white-paper`, `join-network`, `host-event`,
 * `asset-request` and `csp-report`.
 */
export const AUDIT_EXEMPTIONS: Readonly<Record<string, string>> = {}

/**
 * Helpers whose only write is the application's own bookkeeping, not a change anyone
 * would audit. A GET that reaches one is not a mutation, and a write through one is not
 * a mutation an early return can skip. Keyed by `<module>#<export>`, or `<module>` for
 * a module that does nothing else, with why.
 *
 * This list is an exemption in all but name, so it stands as an owner decision
 * (docs/TENANCY-S5.md, Owner gates). The two lib/pending-consent entries are the ones
 * that need it most: they record through the activity log, and they are here because
 * taking them off makes every member route's GET a mutation on the baseline, not because
 * that write is bookkeeping.
 */
export const OPERATIONAL_WRITERS: Readonly<Record<string, string>> = {
  'lib/app-errors': 'the error log itself: writes a scrubbed row to app_errors, and only when something failed',
  'lib/audit/platform': 'the audit log itself; recordAuditFailure also reaches app_errors',
  'lib/audit/route': 'the audit log itself, through lib/audit/platform',
  'lib/cron-runs': 'the ledger of when each cron ran: cron_runs',
  'lib/after-response': 'schedules a callback; whatever the callback writes is counted where it is written',
  'lib/supabase': 'builds a client; a write on it is counted where it is written',
  'lib/activity-log#logActivity': 'already a record of who did what: member_activity_log',
  'lib/activity-log#logActivityOrThrow': 'already a record of who did what: member_activity_log',
  'lib/activity-log#logActivities': 'already a record of who did what: member_activity_log',
  'lib/survey/audit#writeAudit': 'already a record of who did what: a survey audit log',
  'lib/survey/audit#logSurveyAccess': 'already a record of who read what: a survey access log',
  'lib/esign/archive#logRecordAccess': 'already a record of who read what: esign_access_log',
  'lib/pending-consent#childAwaitingConsent':
    'the sign-in gate every member route passes through. It closes a request whose consent is already signed, at most once per member, and writes guardian_consent_received to the activity log when it does. Awaiting the owner decision above',
  'lib/pending-consent#childAwaitingConsentBlock': 'the same gate, for routes that resolve the member themselves. Awaiting the owner decision above',
}

export const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const
/** Cron handlers mutate on GET (vercel.json schedules call GET). */
export const CRON_METHODS = ['GET', 'POST'] as const
/** Rpcs a GET may call without counting as a write. Checked against the migration that defines each. */
export const READ_ONLY_RPCS = ['event_slug_row_counts'] as const

/** Third-party calls that change something, by the module the client comes from. */
const EXTERNAL_WRITES: readonly { origin: RegExp; name: RegExp }[] = [
  { origin: /^(stripe|lib\/stripe)$/, name: /^(create|update|del|cancel|capture|expire|pay|finalizeInvoice|voidInvoice|sendInvoice|markUncollectible)$/ },
  { origin: /^@clerk\//, name: /^(create|update|delete|revoke|ban|unban|lock|unlock)/ },
  { origin: /^lib\/email\/transport$/, name: /^send$/ },
  { origin: /^(lib\/sanity|@sanity\/client|next-sanity)$/, name: /^(create|createOrReplace|createIfNotExists|delete|patch|commit)$/ },
]

export type MutationKind = 'mutation' | 'cron' | 'get_mutation'
export type AuditCoverage = 'mandatory' | 'conditional' | 'exempt' | 'none'

export interface HandlerAudit {
  /** `<file>#<METHOD>`, the baseline key. `<file>#*` is an `export *` that cannot be followed. */
  key: string
  file: string
  method: string
  kind: MutationKind
  /** True only for 'mandatory' coverage. */
  audited: boolean
  coverage: AuditCoverage
}

/**
 * An App Router route handler file. next.config.mjs sets no pageExtensions, so
 * these are Next's defaults: a route.mjs or route.mts is not served.
 */
export function isRouteFile(file: string): boolean {
  return /^app\/(?:.*\/)?route\.(?:ts|tsx|js|jsx)$/.test(file.replace(/\\/g, '/'))
}

export function isCronRoute(file: string): boolean {
  return file.replace(/\\/g, '/').startsWith('app/api/cron/')
}

/** The facts reach one of AUDIT_WRITERS, imported from its own module. */
export function reachesAudit(f: Pick<HandlerFacts, 'calls' | 'origins'>): boolean {
  return Object.entries(AUDIT_WRITERS).some(([name, from]) => {
    if (!f.calls.has(name)) return false
    const got = f.origins.get(name)
    return !!got && from.some((m) => got.has(fileModule(m)))
  })
}

type WriteFacts = Pick<HandlerFacts, 'origins' | 'dbWrite' | 'rpcs' | 'outboundWrite'>

/**
 * These facts themselves write to the database: a `.from(…)` chain ending in a write,
 * or an rpc that is not known to be read-only. It reads the chain, not the name, so a
 * client handed in as a parameter counts and `map.delete()` or `searchParams.delete()`
 * does not.
 */
export function reachesDbWrite(f: WriteFacts): boolean {
  if (f.dbWrite) return true
  return [...f.rpcs].some((n) => n === null || !(READ_ONLY_RPCS as readonly string[]).includes(n))
}

/** These facts change something: a database write, or a call out that is not a read. */
function reachesEffect(f: WriteFacts): boolean {
  if (reachesDbWrite(f) || f.outboundWrite) return true
  return EXTERNAL_WRITES.some(({ origin, name }) => [...f.origins].some(([n, from]) => name.test(n) && [...from].some((o) => origin.test(o))))
}

function isOperational(module: string, name: string): boolean {
  return module in OPERATIONAL_WRITERS || `${module}#${name}` in OPERATIONAL_WRITERS
}

// ── Following a call into another module ─────────────────────────────────────

/** Repo-relative path → source: what lets the gate follow a helper into another file. */
export type Project = ReadonlyMap<string, string>

const MODULE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js']

/** What the repo's exported helpers reach, once each, however many handlers ask. */
class HelperGraph {
  private facts = new Map<string, HandlerFacts[]>()
  private answers = new Map<(f: WriteFacts) => boolean, Map<string, boolean>>()

  constructor(private project: Project) {}

  private fileOf(module: string): string | null {
    for (const ext of MODULE_EXTENSIONS) if (this.project.has(module + ext)) return module + ext
    return null
  }

  /** The function(s) behind `<module>.<name>`: an export, a re-export, or a member of an exported object. */
  private factsOf(module: string, name: string, trail = new Set<string>()): HandlerFacts[] {
    const key = `${module}#${name}`
    const known = this.facts.get(key)
    if (known) return known
    if (trail.has(key)) return []
    trail.add(key)
    const file = this.fileOf(module)
    if (!file) return []
    const src = this.project.get(file) as string
    const direct = analyzeNamedExport(file, src, name)
    let found: HandlerFacts[]
    if (direct) {
      found = [direct]
    } else {
      const { named, stars } = reExportsOf(file, src)
      const again = named.get(name)
      if (again) found = again.module ? this.factsOf(again.module, again.name, trail) : []
      else {
        const objects = exportedObjectsWith(file, src, name).flatMap((o) => analyzeNamedExport(file, src, `${o}.${name}`) ?? [])
        found = objects.length ? objects : stars.flatMap((m) => this.factsOf(m, name, trail))
      }
    }
    this.facts.set(key, found)
    return found
  }

  /**
   * Do these facts, or anything in the repo they call, satisfy `test`? A search that
   * finds nothing has explored everything it saw, so all of that is known false; one
   * that finds something only says so for where it started.
   */
  reaches(f: WriteFacts, test: (f: WriteFacts) => boolean): boolean {
    if (test(f)) return true
    let known = this.answers.get(test)
    if (!known) this.answers.set(test, (known = new Map()))
    const seen = new Set<string>()
    const search = (x: WriteFacts): boolean => {
      if (test(x)) return true
      for (const [name, origins] of x.origins) {
        for (const module of origins) {
          if (!this.fileOf(module) || isOperational(module, name)) continue
          const key = `${module}#${name}`
          const answer = known.get(key)
          if (answer) return true
          if (answer === false || seen.has(key)) continue
          seen.add(key)
          if (this.factsOf(module, name).some(search)) {
            known.set(key, true)
            return true
          }
        }
      }
      return false
    }
    if (search(f)) return true
    for (const key of seen) known.set(key, false)
    return false
  }

  /** One chain of `<module>#<export>` from these facts to something that satisfies `test`, or null. */
  chain(f: WriteFacts, test: (f: WriteFacts) => boolean, seen = new Set<string>()): string[] | null {
    if (test(f)) return []
    for (const [name, origins] of f.origins) {
      for (const module of origins) {
        const key = `${module}#${name}`
        if (!this.fileOf(module) || isOperational(module, name) || seen.has(key)) continue
        seen.add(key)
        for (const next of this.factsOf(module, name)) {
          const rest = this.chain(next, test, seen)
          if (rest) return [key, ...rest]
        }
      }
    }
    return null
  }
}

/** Why a GET counts as writing: the helpers it goes through. Empty when the handler writes itself. For reviewing the baseline. */
export function whyGetWrites(file: string, src: string, project: Project): string[] | null {
  const get = analyzeRoute(file, src).handlers.find((h) => h.name === 'GET')
  return get ? graphFor(project).chain(get, reachesDbWrite) : null
}

const graphs = new WeakMap<object, HelperGraph>()
const NO_PROJECT: Project = new Map()

function graphFor(project: Project): HelperGraph {
  let g = graphs.get(project)
  if (!g) graphs.set(project, (g = new HelperGraph(project)))
  return g
}

/** Which methods of this route file count as mutations, and of which kind. */
function mutatingMethods(file: string): Map<string, MutationKind> {
  const out = new Map<string, MutationKind>()
  for (const m of MUTATING_METHODS) out.set(m, isCronRoute(file) ? 'cron' : 'mutation')
  if (isCronRoute(file)) for (const m of CRON_METHODS) out.set(m, 'cron')
  return out
}

// ── Is the audit write mandatory? ────────────────────────────────────────────

type Fn = ts.SignatureDeclaration & { body?: ts.Node }

interface Ctx {
  file: string
  sf: ts.SourceFile
  graph: HelperGraph
  imports: Map<string, { imported: string; module: string }>
  locals: Map<string, Fn>
  seen: Set<ts.Node>
  /** Same-file helpers an audit write was found through: their own paths need reading too. */
  auditingHelpers: Set<Fn>
}

const isFn = (n: ts.Node): n is ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)

function unwrap(e: ts.Expression): ts.Expression {
  let x = e
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isSatisfiesExpression(x) || ts.isNonNullExpression(x) || ts.isAwaitExpression(x)) x = x.expression
  return x
}

function moduleContext(sf: ts.SourceFile, file: string, graph: HelperGraph): Ctx {
  const imports: Ctx['imports'] = new Map()
  const locals: Ctx['locals'] = new Map()
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier) && stmt.importClause) {
      const module = resolveModule(file, stmt.moduleSpecifier.text)
      const nb = stmt.importClause.namedBindings
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) imports.set(el.name.text, { imported: (el.propertyName ?? el.name).text, module })
      if (nb && ts.isNamespaceImport(nb)) imports.set(nb.name.text, { imported: '*', module })
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name) locals.set(stmt.name.text, stmt)
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue
        const init = unwrap(d.initializer)
        if (isFn(init)) locals.set(d.name.text, init)
      }
    }
  }
  return { file, sf, graph, imports, locals, seen: new Set(), auditingHelpers: new Set() }
}

/** The imported name of a call's callee and the module it comes from, through an alias or a namespace. */
function importedCallee(call: ts.CallExpression, ctx: Ctx): { name: string; module: string } | null {
  const callee = unwrap(call.expression)
  if (ts.isIdentifier(callee)) {
    const imp = ctx.imports.get(callee.text)
    return imp ? { name: imp.imported, module: imp.module } : null
  }
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
    const imp = ctx.imports.get(callee.expression.text)
    return imp?.imported === '*' ? { name: callee.name.text, module: imp.module } : null
  }
  return null
}

const fromListed = (list: Record<string, readonly string[]>, c: { name: string; module: string } | null) =>
  !!c && Object.prototype.hasOwnProperty.call(list, c.name) && list[c.name].some((m) => fileModule(m) === c.module)

/** `await name` or `return name` in this function, not in a function nested inside it. */
function waitsFor(root: ts.Node, name: string): boolean {
  const isName = (e: ts.Expression | undefined) => {
    const x = e && unwrap(e)
    return !!x && ts.isIdentifier(x) && x.text === name
  }
  const visit = (n: ts.Node): boolean => {
    if (n !== root && (isFn(n) || ts.isMethodDeclaration(n))) return false
    if ((ts.isAwaitExpression(n) || ts.isReturnStatement(n)) && isName(n.expression)) return true
    return !!ts.forEachChild(n, (c) => visit(c) || undefined)
  }
  return visit(root)
}

/** Nothing waits for this call: its value is dropped, directly, after a `.catch()`, or in a variable nobody awaits. */
function isDetached(call: ts.CallExpression): boolean {
  let n: ts.Node = call
  while (
    n.parent &&
    (ts.isParenthesizedExpression(n.parent) ||
      ts.isAsExpression(n.parent) ||
      ts.isSatisfiesExpression(n.parent) ||
      ts.isNonNullExpression(n.parent) ||
      (ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n) ||
      (ts.isCallExpression(n.parent) && n.parent.expression === n))
  ) {
    n = n.parent
  }
  const parent = n.parent
  if (ts.isExpressionStatement(parent) || ts.isVoidExpression(parent)) return true
  const bound =
    ts.isVariableDeclaration(parent) && parent.initializer === n
      ? parent.name
      : ts.isBinaryExpression(parent) && parent.right === n && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
        ? parent.left
        : null
  if (!bound) return false
  if (!ts.isIdentifier(bound)) return true
  let scope: ts.Node = parent
  while (scope.parent && !isFn(scope) && !ts.isMethodDeclaration(scope)) scope = scope.parent
  return !waitsFor(scope, bound.text)
}

/** These options could turn the write off: they name `enabled`, or the gate cannot read them. */
function mayDisable(options: ts.Expression | undefined): boolean {
  if (!options) return false
  const o = unwrap(options)
  if (!ts.isObjectLiteralExpression(o)) return true
  return o.properties.some((p) => {
    if (ts.isSpreadAssignment(p) || !p.name || ts.isComputedPropertyName(p.name)) return true
    return (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) && p.name.text === 'enabled'
  })
}

/** `auditMutation(m, { afterResponse: true })`: scheduled with after(), so nothing need wait for it. */
function isDeferredWrite(call: ts.CallExpression): boolean {
  const opts = call.arguments[1] && unwrap(call.arguments[1])
  return (
    !!opts &&
    ts.isObjectLiteralExpression(opts) &&
    opts.properties.some((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'afterResponse' && p.initializer.kind === ts.SyntaxKind.TrueKeyword)
  )
}

/** An audit write certainly runs when this expression does: not behind `?:`, `&&`, `||`, `??` or a closure. */
function exprAudits(n: ts.Node, ctx: Ctx): boolean {
  if (isFn(n) || ts.isMethodDeclaration(n)) return false
  if (ts.isConditionalExpression(n)) return exprAudits(n.condition, ctx)
  if (ts.isBinaryExpression(n) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(n.operatorToken.kind)) {
    return exprAudits(n.left, ctx)
  }
  if (ts.isCallExpression(n)) {
    if (fromListed(AUDIT_WRITERS, importedCallee(n, ctx))) {
      if (!mayDisable(n.arguments[1]) && (!isDetached(n) || isDeferredWrite(n))) return true
    } else {
      const callee = unwrap(n.expression)
      if (ts.isIdentifier(callee) && !isDetached(n)) {
        const helper = ctx.locals.get(callee.text)
        if (helper && !ctx.imports.has(callee.text) && fnAudits(helper, ctx)) {
          ctx.auditingHelpers.add(helper)
          return true
        }
      }
    }
  }
  return !!ts.forEachChild(n, (c) => exprAudits(c, ctx) || undefined)
}

function statementsAudit(statements: readonly ts.Statement[], ctx: Ctx): boolean {
  for (const s of statements) {
    if (statementAudits(s, ctx)) return true
    if (ts.isReturnStatement(s) || ts.isThrowStatement(s)) break
  }
  return false
}

function statementAudits(s: ts.Statement, ctx: Ctx): boolean {
  if (ts.isBlock(s)) return statementsAudit(s.statements, ctx)
  if (ts.isTryStatement(s)) return !!s.finallyBlock && statementsAudit(s.finallyBlock.statements, ctx)
  if (ts.isIfStatement(s) || ts.isWhileStatement(s) || ts.isDoStatement(s) || ts.isSwitchStatement(s)) return exprAudits(s.expression, ctx)
  if (ts.isForStatement(s) || ts.isForOfStatement(s) || ts.isForInStatement(s) || ts.isLabeledStatement(s)) return false
  if (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) return false
  return exprAudits(s, ctx)
}

function fnAudits(fn: Fn, ctx: Ctx): boolean {
  if (ctx.seen.has(fn)) return false
  ctx.seen.add(fn)
  if (!fn.body) return false
  return ts.isBlock(fn.body) ? statementsAudit(fn.body.statements, ctx) : exprAudits(fn.body, ctx)
}

// ── Can a path answer success after a write, without the audit? ──────────────

interface Flow {
  /** Something on some path here may have written. */
  wrote: boolean
  /** An audit write has certainly run on every path here. */
  audited: boolean
}

const merge = (a: Flow | null, b: Flow | null): Flow | null => {
  if (!a) return b
  if (!b) return a
  return { wrote: a.wrote || b.wrote, audited: a.audited && b.audited }
}

const isErrorStatus = (e: ts.Expression): boolean => {
  const x = unwrap(e)
  if (ts.isNumericLiteral(x)) return Number(x.text) >= 400 && Number(x.text) <= 599
  return ts.isConditionalExpression(x) && isErrorStatus(x.whenTrue) && isErrorStatus(x.whenFalse)
}

/** A response this expression builds has a literal status of 400 or more. Anything unreadable is not one. */
function isErrorResponse(expr: ts.Expression | undefined, depth = 0): boolean {
  if (!expr || depth > 4) return false
  const e = unwrap(expr)
  if (ts.isConditionalExpression(e)) return isErrorResponse(e.whenTrue, depth + 1) && isErrorResponse(e.whenFalse, depth + 1)
  if (ts.isIdentifier(e)) {
    const init = bindingOf(e)
    return !!init && isErrorResponse(init, depth + 1)
  }
  if (!ts.isCallExpression(e) && !ts.isNewExpression(e)) return false
  return (e.arguments ?? []).some((raw) => {
    const a = unwrap(raw)
    if (ts.isNumericLiteral(a)) return isErrorStatus(a)
    if (!ts.isObjectLiteralExpression(a)) return false
    return a.properties.some((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'status' && isErrorStatus(p.initializer))
  })
}

/** True when some path through this function can answer success after a write, with no audit yet. */
function pathSkipsAudit(fn: Fn, ctx: Ctx): boolean {
  const body = fn.body
  if (!body || !ts.isBlock(body)) return false
  let skips = false
  const memo = new Map<ts.Node, boolean>()
  const writes = (n: ts.Node): boolean => {
    let w = memo.get(n)
    if (w === undefined) memo.set(n, (w = ctx.graph.reaches(analyzeNodeFacts(ctx.file, ctx.sf, n, fn), reachesEffect)))
    return w
  }
  const audits = (n: ts.Node): boolean => {
    ctx.seen = new Set([fn])
    return exprAudits(n, ctx)
  }
  const run = (n: ts.Node, s: Flow): Flow => ({ wrote: s.wrote || writes(n), audited: s.audited || audits(n) })

  const walk = (statements: readonly ts.Statement[], start: Flow): Flow | null => {
    let s: Flow | null = start
    for (const st of statements) {
      if (!s) return null
      s = step(st, s)
    }
    return s
  }

  const step = (st: ts.Statement, s: Flow): Flow | null => {
    if (ts.isBlock(st)) return walk(st.statements, s)
    if (ts.isReturnStatement(st)) {
      const end = st.expression ? run(st.expression, s) : s
      if (end.wrote && !end.audited && !isErrorResponse(st.expression)) skips = true
      return null
    }
    if (ts.isThrowStatement(st)) {
      run(st.expression, s)
      return null
    }
    if (ts.isIfStatement(st)) {
      const after = run(st.expression, s)
      return merge(step(st.thenStatement, after), st.elseStatement ? step(st.elseStatement, after) : after)
    }
    if (ts.isTryStatement(st)) {
      ctx.seen = new Set([fn])
      const covered = !!st.finallyBlock && statementsAudit(st.finallyBlock.statements, ctx)
      const entry = covered ? { ...s, audited: true } : s
      const done = walk(st.tryBlock.statements, entry)
      // Whatever threw did not finish, so the catch sees every statement but the last.
      const failed: Flow = { wrote: entry.wrote || st.tryBlock.statements.slice(0, -1).some(writes), audited: entry.audited }
      const caught = st.catchClause ? walk(st.catchClause.block.statements, failed) : null
      const joined = merge(done, caught)
      if (!st.finallyBlock) return joined
      const finished = walk(st.finallyBlock.statements, joined ?? failed)
      return joined ? finished : null
    }
    if (ts.isSwitchStatement(st)) {
      const after = run(st.expression, s)
      const bodyWrites = writes(st.caseBlock)
      let out: Flow | null = st.caseBlock.clauses.some(ts.isDefaultClause) ? null : after
      for (const c of st.caseBlock.clauses) out = merge(out, walk(c.statements, { wrote: after.wrote || bodyWrites, audited: after.audited }))
      return out
    }
    if (ts.isForStatement(st) || ts.isForOfStatement(st) || ts.isForInStatement(st) || ts.isWhileStatement(st) || ts.isDoStatement(st)) {
      // A loop may run no times, and a return in it may be on a later pass.
      const after: Flow = { wrote: s.wrote || writes(st), audited: s.audited }
      step(st.statement, after)
      return after
    }
    if (ts.isLabeledStatement(st)) return step(st.statement, s)
    if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) return s
    return run(st, s)
  }

  walk(body.statements, { wrote: false, audited: false })
  return skips
}

// ── Finding the handler ──────────────────────────────────────────────────────

/** The function an exported value runs: itself, or the function a wrapper call is given. */
function handlerFnOf(value: ts.Expression): Fn | null {
  const e = unwrap(value)
  if (isFn(e)) return e
  if (ts.isCallExpression(e)) {
    for (const a of e.arguments) {
      const fn = handlerFnOf(a)
      if (fn) return fn
    }
  }
  return null
}

function findHandlerFn(sf: ts.SourceFile, ctx: Ctx, method: string): Fn | null {
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === method) return stmt
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === method && d.initializer) return handlerFnOf(d.initializer)
      }
    }
    if (ts.isExportDeclaration(stmt) && !stmt.moduleSpecifier && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) {
        if (el.name.text === method) return ctx.locals.get((el.propertyName ?? el.name).text) ?? null
      }
    }
  }
  return null
}

/** What a top-level `const` in this file is set to. */
function topLevelValue(sf: ts.SourceFile, name: string): ts.Expression | null {
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === name) return d.initializer ?? null
  }
  return null
}

/** The value a method is exported as, when it is a `const`: `export const POST = …`, or `export { x as POST }`. */
function exportedValue(sf: ts.SourceFile, method: string): ts.Expression | null {
  const binding = (name: string) => topLevelValue(sf, name)
  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt) && !stmt.moduleSpecifier && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) if (el.name.text === method) return binding((el.propertyName ?? el.name).text)
    }
  }
  return binding(method)
}

/** An object literal, or a `?:` between two: an event whichever way it goes. */
function isEventLiteral(e: ts.Expression | undefined): boolean {
  const x = e && unwrap(e)
  if (!x) return false
  return ts.isObjectLiteralExpression(x) || (ts.isConditionalExpression(x) && isEventLiteral(x.whenTrue) && isEventLiteral(x.whenFalse))
}

/** Every way out of this function answers with an event literal. */
function fnAlwaysAnswers(fn: Fn): boolean {
  const body = fn.body
  if (!body) return false
  if (!ts.isBlock(body)) return isEventLiteral(body as ts.Expression)
  if (!body.statements.length || !ts.isReturnStatement(body.statements[body.statements.length - 1])) return false
  const allAnswer = (n: ts.Node): boolean => {
    if (isFn(n) || ts.isMethodDeclaration(n)) return true
    if (ts.isReturnStatement(n)) return isEventLiteral(n.expression)
    return !ts.forEachChild(n, (c) => !allAnswer(c) || undefined)
  }
  return allAnswer(body)
}

/**
 * withAudit's spec answers with an event every time. A spec that can answer with nothing
 * would be a second off switch beside `enabled`, so this fails closed: a literal, a
 * function that returns one on every path, or a name for either. A call is refused, since
 * its answer cannot be read here. An imported name is left to withAudit's types.
 */
function specAlwaysAnswers(spec: ts.Expression | undefined, ctx: Ctx, depth = 0): boolean {
  const e = spec && unwrap(spec)
  if (!e || depth > 4) return false
  if (ts.isObjectLiteralExpression(e)) return true
  if (isFn(e)) return fnAlwaysAnswers(e)
  if (!ts.isIdentifier(e) || e.text === 'undefined') return false
  const local = ctx.locals.get(e.text)
  if (local) return fnAlwaysAnswers(local)
  const value = topLevelValue(ctx.sf, e.text)
  return value ? specAlwaysAnswers(value, ctx, depth + 1) : true
}

/**
 * The exported value is one of AUDIT_WRAPPERS, or a one-argument wrapper around one. With
 * more arguments, nothing says the audited one is what the export runs. withCronAudit
 * counts only in a cron route, with the job named in the file.
 */
function isWrappedInAudit(value: ts.Expression, ctx: Ctx): boolean {
  const e = unwrap(value)
  if (!ts.isCallExpression(e)) return false
  const callee = importedCallee(e, ctx)
  if (fromListed(AUDIT_WRAPPERS, callee)) {
    if (callee?.name === 'withCronAudit') return isCronRoute(ctx.file) && e.arguments.length === 2 && ts.isStringLiteralLike(e.arguments[0])
    return !mayDisable(e.arguments[2]) && specAlwaysAnswers(e.arguments[0], ctx)
  }
  return e.arguments.length === 1 && isWrappedInAudit(e.arguments[0], ctx)
}

function bindingNames(name: ts.BindingName, into: string[]) {
  if (ts.isIdentifier(name)) {
    into.push(name.text)
    return
  }
  for (const el of name.elements) if (ts.isBindingElement(el)) bindingNames(el.name, into)
}

/** `export const { POST } = h`: route-ast's exportedNames reads identifiers only. */
function destructuredExports(sf: ts.SourceFile): string[] {
  const out: string[] = []
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt) || !stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue
    for (const d of stmt.declarationList.declarations) if (!ts.isIdentifier(d.name)) bindingNames(d.name, out)
  }
  return out
}

// ── Report ───────────────────────────────────────────────────────────────────

function coverageOf(method: string, sf: ts.SourceFile, ctx: Ctx, facts: HandlerFacts): AuditCoverage {
  const value = exportedValue(sf, method)
  if (value && isWrappedInAudit(value, ctx)) return 'mandatory'
  if (!reachesAudit(facts)) return 'none'
  const fn = findHandlerFn(sf, ctx, method)
  if (!fn || !fnAudits(fn, ctx)) return 'conditional'
  const skips = (f: Fn): boolean => pathSkipsAudit(f, ctx)
  if (skips(fn)) return 'conditional'
  // A helper the audit lives in has early returns of its own.
  return [...ctx.auditingHelpers].some(skips) ? 'conditional' : 'mandatory'
}

/**
 * Every mutating handler of one route file, with whether an audit write is certain
 * to run. `project` lets a GET's writes and an early return's effects be followed
 * into other modules; without it, only this file is read.
 */
export function auditHandlers(file: string, src: string, project: Project = NO_PROJECT): HandlerAudit[] {
  const f = file.replace(/\\/g, '/')
  if (!isRouteFile(f)) return []
  const wanted = mutatingMethods(f)
  const out = new Map<string, HandlerAudit>()
  const sf = parseSource(f, src)
  const graph = graphFor(project)
  const put = (method: string, kind: MutationKind, found: AuditCoverage) => {
    const key = `${f}#${method}`
    const coverage = found !== 'mandatory' && key in AUDIT_EXEMPTIONS ? 'exempt' : found
    out.set(method, { key, file: f, method, kind, audited: coverage === 'mandatory', coverage })
  }
  const followed = new Set<string>()
  for (const h of analyzeRoute(f, src).handlers) {
    followed.add(h.name)
    const kind = wanted.get(h.name) ?? (h.name === 'GET' && graph.reaches(h, reachesDbWrite) ? 'get_mutation' : null)
    if (!kind) continue
    const ctx = moduleContext(sf, f, graph)
    put(h.name, kind, coverageOf(h.name, sf, ctx, h))
  }
  // A method exported some other way (re-exported, destructured, `export *`)
  // cannot be followed: report it, unaudited, so it is never silently missed.
  for (const name of [...exportedNames(f, src), ...destructuredExports(sf)]) {
    if (followed.has(name) || out.has(name)) continue
    if (name === '*') put('*', isCronRoute(f) ? 'cron' : 'mutation', 'none')
    else if (wanted.has(name)) put(name, wanted.get(name) as MutationKind, 'none')
    else if (name === 'GET') put(name, 'get_mutation', 'none')
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key))
}
