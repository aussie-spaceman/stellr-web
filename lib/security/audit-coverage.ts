// Audit coverage of route handlers (S5 data access, C2: report-only for now).
//
// Test-only, like route-ast.ts: imported by scripts/s5-inventory.mjs and the
// ratchet tests, never by app code.
//
// A MUTATION is an exported POST, PUT, PATCH or DELETE handler of an App Router
// route file. A cron route (app/api/cron/**) mutates on GET, so its GET and POST
// count too, as kind 'cron'. A GET that writes is kind 'get_mutation': one whose
// own code or same-file helpers reach insert, update, upsert, delete or an rpc
// that is not listed in READ_ONLY_RPCS on a Supabase client. An exported GET
// that cannot be followed (re-exported, destructured) is reported the same way.
//
// COVERAGE is one of:
//   - 'mandatory': an audit write sits in the handler's top-level statements or
//     in a finally block, directly or through a same-file helper. Only this
//     counts as audited;
//   - 'conditional': the handler reaches an audit write, but only down a branch,
//     a loop, a try block or a closure;
//   - 'none'.
//
// An audit write is a call of one of AUDIT_WRITERS, imported from that writer's
// own module. The name alone is never enough: a same-file `audit()` or an `audit`
// from another module does not count, the same origin rule route-guards.ts
// applies to guards. When S5-DA-5 adds a wrapper (lib/audit/route.ts), list it in
// AUDIT_WRITERS in the same PR.
//
// LIMITS, which S5-DA-5 must close before a clean report can mean "100% audited":
//   - a write reached through a helper in ANOTHER module is not seen, so a GET
//     doing that is missing from the report;
//   - 'mandatory' does not prove the audit is on the path that writes: an early
//     return before it (a guard refusal, but also a write-and-return) is not
//     examined. The enforcing gate should accept the wrapper, not this shape.
//
// A handler re-exported from another module (`export { POST } from './x'`) and
// any `export *` cannot be followed, so they are reported as unaudited.
import ts from 'typescript'
import { analyzeRoute, exportedNames, fileModule, GLOBAL_ORIGIN, resolveModule, UNKNOWN_ORIGIN, type HandlerFacts } from './route-ast'

/** Calls that write a platform audit event, each with the module it must come from. */
export const AUDIT_WRITERS: Record<string, readonly string[]> = {
  audit: ['lib/audit/platform'],
}

export const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const
/** Cron handlers mutate on GET (vercel.json schedules call GET). */
export const CRON_METHODS = ['GET', 'POST'] as const
/** Supabase query-builder calls that write. */
export const DB_WRITE_CALLS = ['insert', 'update', 'upsert', 'delete'] as const
/** Rpcs a GET may call without counting as a write. Checked against the migration that defines each. */
export const READ_ONLY_RPCS = ['event_slug_row_counts'] as const

export type MutationKind = 'mutation' | 'cron' | 'get_mutation'
export type AuditCoverage = 'mandatory' | 'conditional' | 'none'

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

const isSupabaseOrigin = (origin: string) => origin === 'lib/supabase' || origin.startsWith('@supabase/')

/**
 * The facts reach a database write on a Supabase client. A client handed in as
 * a parameter has no traceable origin, so it counts when the handler also calls
 * `.from()`, which keeps `map.delete()` and `searchParams.delete()` out.
 */
export function reachesDbWrite(f: Pick<HandlerFacts, 'calls' | 'origins'>, src: string): boolean {
  const write = DB_WRITE_CALLS.some((name) => {
    const got = f.origins.get(name)
    if (!f.calls.has(name) || !got) return false
    return [...got].some((o) => isSupabaseOrigin(o) || ((o === GLOBAL_ORIGIN || o === UNKNOWN_ORIGIN) && f.calls.has('from')))
  })
  if (write) return true
  if (!f.calls.has('rpc')) return false
  const all = src.match(/\.rpc\s*\(/g)?.length ?? 0
  const named = [...src.matchAll(/\.rpc\s*\(\s*['"`](\w+)['"`]/g)].map((m) => m[1])
  return named.length < all || named.some((n) => !(READ_ONLY_RPCS as readonly string[]).includes(n))
}

/** Which methods of this route file count as mutations, and of which kind. */
function mutatingMethods(file: string): Map<string, MutationKind> {
  const out = new Map<string, MutationKind>()
  for (const m of MUTATING_METHODS) out.set(m, isCronRoute(file) ? 'cron' : 'mutation')
  if (isCronRoute(file)) for (const m of CRON_METHODS) out.set(m, 'cron')
  return out
}

// ── Is the audit write mandatory? ────────────────────────────────────────────

interface Ctx {
  imports: Map<string, { imported: string; module: string }>
  locals: Map<string, ts.SignatureDeclaration & { body?: ts.Node }>
  seen: Set<ts.Node>
}

type Fn = ts.SignatureDeclaration & { body?: ts.Node }

const isFn = (n: ts.Node): n is ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)

function unwrap(e: ts.Expression): ts.Expression {
  let x = e
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isSatisfiesExpression(x) || ts.isNonNullExpression(x) || ts.isAwaitExpression(x)) x = x.expression
  return x
}

function moduleContext(sf: ts.SourceFile, file: string): Ctx {
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
  return { imports, locals, seen: new Set() }
}

function isAuditWriterCall(call: ts.CallExpression, ctx: Ctx): boolean {
  const callee = unwrap(call.expression)
  const fromWriter = (name: string, module: string) => AUDIT_WRITERS[name]?.some((m) => fileModule(m) === module) ?? false
  if (ts.isIdentifier(callee)) {
    const imp = ctx.imports.get(callee.text)
    return !!imp && fromWriter(imp.imported, imp.module)
  }
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
    const imp = ctx.imports.get(callee.expression.text)
    return imp?.imported === '*' && fromWriter(callee.name.text, imp.module)
  }
  return false
}

/** An audit write certainly runs when this expression does: not behind `?:`, `&&`, `||`, `??` or a closure. */
function exprAudits(n: ts.Node, ctx: Ctx): boolean {
  if (isFn(n) || ts.isMethodDeclaration(n)) return false
  if (ts.isConditionalExpression(n)) return exprAudits(n.condition, ctx)
  if (ts.isBinaryExpression(n) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(n.operatorToken.kind)) {
    return exprAudits(n.left, ctx)
  }
  if (ts.isCallExpression(n)) {
    if (isAuditWriterCall(n, ctx)) return true
    const callee = unwrap(n.expression)
    if (ts.isIdentifier(callee)) {
      const helper = ctx.locals.get(callee.text)
      if (helper && !ctx.imports.has(callee.text) && fnAudits(helper, ctx)) return true
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

/** Every mutating handler of one route file, with whether an audit write is certain to run. */
export function auditHandlers(file: string, src: string): HandlerAudit[] {
  const f = file.replace(/\\/g, '/')
  if (!isRouteFile(f)) return []
  const wanted = mutatingMethods(f)
  const out = new Map<string, HandlerAudit>()
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const put = (method: string, kind: MutationKind, coverage: AuditCoverage) =>
    out.set(method, { key: `${f}#${method}`, file: f, method, kind, audited: coverage === 'mandatory', coverage })
  const followed = new Set<string>()
  for (const h of analyzeRoute(f, src).handlers) {
    followed.add(h.name)
    const kind = wanted.get(h.name) ?? (h.name === 'GET' && reachesDbWrite(h, src) ? 'get_mutation' : null)
    if (!kind) continue
    if (!reachesAudit(h)) {
      put(h.name, kind, 'none')
      continue
    }
    const ctx = moduleContext(sf, f)
    const fn = findHandlerFn(sf, ctx, h.name)
    put(h.name, kind, fn && fnAudits(fn, ctx) ? 'mandatory' : 'conditional')
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
