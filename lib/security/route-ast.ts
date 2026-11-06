// Static analysis of route handlers and pages with the TypeScript compiler API
// (S2, multi-tenant plan "Route manifest" + "AST guard check").
//
// Test-only: imported by test/route-manifest.test.ts, never by app code, so the
// compiler is not bundled. It parses, it does not type-check: each file is read
// on its own, which keeps the sweep fast (about 470 files) and independent of
// tsconfig paths.
//
// What it answers, per exported handler (GET, POST, …) or per page component:
//   - which functions it calls, including through helpers declared in the same
//     file (a handler that calls `loadForAdmin()` which calls `requireAdmin()`
//     counts as calling requireAdmin), and WHERE each callee comes from;
//   - which calls its FIRST statement makes (crons must start with guardCron);
//   - whether it compares a role read from the Clerk session claims to 'admin';
//   - for a lib/authz call, whether its answer is awaited and used, and where its
//     first argument comes from (CallUse).
//
// Calls are recorded by their final name (`auth()` → auth,
// `stripe.webhooks.constructEvent()` → constructEvent), with an ORIGIN:
//   - a bare call of an import: the module it was imported from, resolved to a
//     repo path (`@/lib/community` and `./community` → `lib/community`) or kept
//     as the package name (`@clerk/nextjs/server`);
//   - a method call: the origin of the receiver's root. `wh.verify()` where
//     `const wh = new Webhook(s)` and Webhook comes from 'svix' has origin svix;
//     a method on an object literal has origin 'unknown';
//   - a library's own export called inside that library: the library itself;
//   - an identifier bound to nothing in the file: 'global'.
// route-guards.ts accepts a guard only from the origins it lists, so a guard's
// NAME is never enough: a look-alike from another module, a same-file function
// (top-level or nested) that borrows the name, or a method of the same name on
// some other object is not trusted.
//
// What counts as reached:
//   - code in the handler, up to an unconditional `return` or `throw` in each
//     block (statements after it never run);
//   - a nested function only when it runs: called on the spot, passed as an
//     argument (a callback), or bound to a name that is referenced. A closure
//     that is declared and never used does not count;
//   - a same-file function or JSX component, when referenced.
import path from 'node:path'
import ts from 'typescript'

export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const

/** Origin of a call whose receiver could not be traced to an import. */
export const UNKNOWN_ORIGIN = 'unknown'
/** Origin of a bare call of an identifier the file never binds (a global). */
export const GLOBAL_ORIGIN = 'global'

export interface HandlerFacts {
  /** The export name: an HTTP method for a route, 'default' for a page. */
  name: string
  /** Every call reachable from the handler, through same-file helpers. */
  calls: Set<string>
  /** For each name in `calls`, where the callee came from (see the header). */
  origins: Map<string, Set<string>>
  /** Calls made directly by the handler's first statement (not through helpers). */
  firstStatementCalls: Set<string>
  /** The handler reaches a comparison of a session-claims role to 'admin'. */
  comparesRoleToAdmin: boolean
  /** Every reached `x.prop === 'literal'` comparison, as `prop=literal`. */
  compares: Set<string>
  /** How each reached lib/authz call is used, by the name it is recorded under. */
  uses: Map<string, CallUse[]>
  /** The handler reaches a `.from(…)` chain that ends in a write: DB_WRITE_CALLS or a storage write. */
  dbWrite: boolean
  /** The function each reached `.rpc(…)` calls, or null when the name is not a literal. */
  rpcs: Set<string | null>
  /** The handler reaches a `fetch` whose method is not a literal GET. */
  outboundWrite: boolean
}

/** Supabase query-builder calls that write. */
export const DB_WRITE_CALLS = ['insert', 'update', 'upsert', 'delete'] as const
const STORAGE_WRITE_CALLS = ['upload', 'remove', 'move'] as const
const FROM_WRITE_CALLS: ReadonlySet<string> = new Set([...DB_WRITE_CALLS, ...STORAGE_WRITE_CALLS])

/**
 * The module whose calls carry a CallUse. Its checks return their answer rather than
 * throw, so calling one proves nothing by itself. A legacy guard has no use recorded:
 * those call sites are being replaced, and their guard-check results must not change.
 */
export const CHECKED_USE_ORIGIN = 'lib/authz'

/** How the code around one lib/authz call treats it. */
export interface CallUse {
  /** The promise is awaited, or returned for the caller to await. */
  awaited: boolean
  /** The answer reaches a condition, a later read, a return or another call. */
  consumed: boolean
  /** What the method is called on, by its imported name: `page` in page.x() and authz.page.x(). */
  receiver: string | null
  /** The first argument: absent, literally undefined, read from the request, or anything else. */
  firstArg: 'none' | 'undefined' | 'request' | 'value'
}

export interface ModuleFacts {
  handlers: HandlerFacts[]
}

const EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/

/** A repo file's module id: `lib/community.ts` → `lib/community`. */
export function fileModule(file: string): string {
  return file.replace(/\\/g, '/').replace(EXT, '').replace(/\/index$/, '')
}

/** An import specifier as a module id, resolved against the importing file. */
export function resolveModule(fromFile: string, spec: string): string {
  if (spec.startsWith('@/')) return fileModule(spec.slice(2))
  if (spec.startsWith('.')) {
    return fileModule(path.posix.normalize(path.posix.join(path.posix.dirname(fromFile.replace(/\\/g, '/')), spec)))
  }
  return spec
}

type Imported = { imported: string; module: string }

function importsOf(sf: ts.SourceFile, fileName: string): Map<string, Imported> {
  const map = new Map<string, Imported>()
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
    const module = resolveModule(fileName, stmt.moduleSpecifier.text)
    const clause = stmt.importClause
    if (!clause) continue
    if (clause.name) map.set(clause.name.text, { imported: clause.name.text, module })
    const named = clause.namedBindings
    if (named && ts.isNamespaceImport(named)) map.set(named.name.text, { imported: named.name.text, module })
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) map.set(el.name.text, { imported: (el.propertyName ?? el.name).text, module })
    }
  }
  return map
}

function strip(expr: ts.Expression): ts.Expression {
  let e = expr
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isNonNullExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isSatisfiesExpression(e) ||
    ts.isTypeAssertionExpression(e) ||
    ts.isAwaitExpression(e)
  ) {
    e = e.expression
  }
  return e
}

function isFunctionWithBody(n: ts.Node): n is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n) ||
    ts.isConstructorDeclaration(n)
  )
}

/**
 * A nested function runs where it stands when it is called on the spot or
 * passed to a call (directly, or inside an array or object literal argument).
 * A function bound to a name runs only when that name is referenced, which the
 * walker follows separately; anything else (returned, stored, a JSX prop) is
 * not run by this code.
 */
function runsInPlace(fn: ts.Node): boolean {
  let p = fn.parent
  while (
    p &&
    (ts.isParenthesizedExpression(p) ||
      ts.isAsExpression(p) ||
      ts.isSatisfiesExpression(p) ||
      ts.isNonNullExpression(p) ||
      ts.isTypeAssertionExpression(p) ||
      ts.isArrayLiteralExpression(p) ||
      ts.isObjectLiteralExpression(p) ||
      ts.isPropertyAssignment(p) ||
      ts.isSpreadElement(p))
  ) {
    p = p.parent
  }
  return !!p && (ts.isCallExpression(p) || ts.isNewExpression(p))
}

/** True for an identifier that names something being declared or a property key, not a reference. */
function isDeclarationOrKey(id: ts.Identifier): boolean {
  const p = id.parent
  if (!p) return false
  if (ts.isPropertyAccessExpression(p) && p.name === id) return true
  if (
    (ts.isVariableDeclaration(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isFunctionExpression(p) ||
      ts.isClassDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isPropertyAssignment(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isPropertySignature(p) ||
      ts.isJsxAttribute(p)) &&
    (p as { name?: ts.Node }).name === id
  ) {
    return true
  }
  if (ts.isBindingElement(p) && (p.name === id || p.propertyName === id)) return true
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isExportSpecifier(p)) return true
  return false
}

function bindingHasName(name: ts.BindingName, wanted: string): boolean {
  if (ts.isIdentifier(name)) return name.text === wanted
  for (const el of name.elements) {
    if (ts.isBindingElement(el) && bindingHasName(el.name, wanted)) return true
  }
  return false
}

/**
 * The initializer a name is bound to in the nearest enclosing scope that
 * declares it (`const role = …`, `const { role } = …`), or null when it is a
 * parameter, unbound, or not a variable.
 */
function resolveBinding(id: ts.Identifier): ts.Expression | null {
  for (let n: ts.Node | undefined = id.parent; n; n = n.parent) {
    if (isFunctionWithBody(n) && n.parameters.some((p) => bindingHasName(p.name, id.text))) return null
    const statements =
      ts.isBlock(n) || ts.isSourceFile(n) || ts.isModuleBlock(n) || ts.isCaseClause(n) || ts.isDefaultClause(n)
        ? n.statements
        : null
    if (!statements) continue
    for (const s of statements) {
      if (!ts.isVariableStatement(s)) continue
      for (const d of s.declarationList.declarations) {
        if (bindingHasName(d.name, id.text)) return d.initializer ?? null
      }
    }
  }
  return null
}

/**
 * `const { auth } = await import('@clerk/nextjs/server')`: a name destructured
 * from a dynamic import, as the import it is. Null for anything else.
 */
function dynamicImportBinding(id: ts.Identifier, fileName: string): Imported | null {
  for (let n: ts.Node | undefined = id.parent; n; n = n.parent) {
    if (isFunctionWithBody(n) && n.parameters.some((p) => bindingHasName(p.name, id.text))) return null
    const statements = ts.isBlock(n) || ts.isSourceFile(n) ? n.statements : null
    if (!statements) continue
    for (const s of statements) {
      if (!ts.isVariableStatement(s)) continue
      for (const d of s.declarationList.declarations) {
        if (!bindingHasName(d.name, id.text)) continue
        const init = d.initializer && strip(d.initializer)
        if (
          !init ||
          !ts.isCallExpression(init) ||
          init.expression.kind !== ts.SyntaxKind.ImportKeyword ||
          !ts.isObjectBindingPattern(d.name) ||
          !init.arguments[0] ||
          !ts.isStringLiteralLike(init.arguments[0])
        ) {
          return null
        }
        const el = d.name.elements.find((e) => ts.isIdentifier(e.name) && e.name.text === id.text)
        if (!el) return null
        const imported = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : id.text
        return { imported, module: resolveModule(fileName, init.arguments[0].text) }
      }
    }
  }
  return null
}

/** The expression reads the Clerk session claims, directly or through a local binding. */
function readsSessionClaims(expr: ts.Node, depth = 0): boolean {
  if (depth > 4) return false
  let found = false
  const visit = (n: ts.Node) => {
    if (found) return
    if (ts.isIdentifier(n) && !isDeclarationOrKey(n)) {
      if (n.text === 'sessionClaims') {
        found = true
        return
      }
      const init = resolveBinding(n)
      if (init && readsSessionClaims(init, depth + 1)) {
        found = true
        return
      }
    }
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'sessionClaims') {
      found = true
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(expr)
  return found
}

function propNameOf(expr: ts.Expression): string | null {
  const e = strip(expr)
  if (ts.isPropertyAccessExpression(e)) return e.name.text
  if (ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression)) return e.argumentExpression.text
  if (ts.isIdentifier(e)) return e.text
  return null
}

/** `….role === 'admin'` where the role is read from the session claims. */
function isClaimsRoleAdmin(side: ts.Expression, other: ts.Expression): boolean {
  if (!ts.isStringLiteralLike(other) || other.text !== 'admin') return false
  if (propNameOf(side) !== 'role') return false
  const e = strip(side)
  if (ts.isIdentifier(e)) {
    const init = resolveBinding(e)
    return !!init && readsSessionClaims(init)
  }
  return readsSessionClaims(e)
}

const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
])

// ── How a lib/authz call's answer is used (see CallUse) ───────────────────────

type Use = Pick<CallUse, 'awaited' | 'consumed'>

const MAX_USE_DEPTH = 8
const ASSIGNMENTS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
])
const SHORT_CIRCUITS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
])

const enforcing = (u: Use) => u.awaited && u.consumed

/** The strongest of several uses, or nothing read at all. */
function strongest(uses: Use[], awaited: boolean): Use {
  return uses.find(enforcing) ?? uses.find((u) => u.awaited) ?? uses.find((u) => u.consumed) ?? { awaited, consumed: false }
}

function enclosingFunctionOrFile(n: ts.Node): ts.Node {
  let p = n.parent
  while (p && !isFunctionWithBody(p) && !ts.isSourceFile(p)) p = p.parent
  return p ?? n
}

/** References that read `name` under `scope`: not its declaration, not an assignment to it. */
function readsOf(name: string, scope: ts.Node): ts.Identifier[] {
  const out: ts.Identifier[] = []
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n) && n.text === name && !isDeclarationOrKey(n)) {
      const p = n.parent
      if (!(ts.isBinaryExpression(p) && p.left === n && ASSIGNMENTS.has(p.operatorToken.kind))) out.push(n)
    }
    ts.forEachChild(n, visit)
  }
  visit(scope)
  return out
}

function boundNames(name: ts.BindingName, into: string[] = []): string[] {
  if (ts.isIdentifier(name)) into.push(name.text)
  else for (const el of name.elements) if (ts.isBindingElement(el)) boundNames(el.name, into)
  return into
}

/** A value bound to these names: how the code goes on to read them. */
function useOfNames(names: string[], at: ts.Node, awaited: boolean, depth: number): Use {
  const scope = enclosingFunctionOrFile(at)
  const uses = names.flatMap((n) => readsOf(n, scope)).map((r) => useOf(r, awaited, depth + 1))
  return strongest(uses, awaited)
}

/**
 * A value returned from a function. From a same-file helper, it is whatever the
 * helper's callers do with it. From an export or an anonymous callback, the caller
 * is out of sight, so it counts.
 */
function useOfReturned(from: ts.Node, depth: number): Use {
  const counted = { awaited: true, consumed: true }
  const fn = enclosingFunctionOrFile(from)
  let name: string | null = null
  let stmt: ts.Node = fn
  if (ts.isFunctionDeclaration(fn) && fn.name) {
    name = fn.name.text
  } else {
    let holder: ts.Node = fn.parent
    while (holder && (ts.isParenthesizedExpression(holder) || ts.isAsExpression(holder))) holder = holder.parent
    if (holder && ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name)) {
      name = holder.name.text
      stmt = holder.parent.parent
    }
  }
  if (!name || hasExportModifier(stmt)) return counted
  const refs = readsOf(name, fn.getSourceFile())
  if (refs.length === 0) return counted
  return strongest(
    refs.map((r) => {
      const p = r.parent
      return ts.isCallExpression(p) && p.expression === r ? useOf(p, false, depth + 1) : counted
    }),
    true,
  )
}

/** How the code around this expression treats its value, walking outward. */
function useOf(node: ts.Expression, awaited: boolean, depth = 0): Use {
  if (depth > MAX_USE_DEPTH) return { awaited, consumed: false }
  const p = node.parent
  const up = (next: ts.Expression, isAwaited = awaited) => useOf(next, isAwaited, depth + 1)

  if (ts.isAwaitExpression(p)) return up(p, true)
  if (
    ts.isParenthesizedExpression(p) ||
    ts.isAsExpression(p) ||
    ts.isNonNullExpression(p) ||
    ts.isSatisfiesExpression(p) ||
    ts.isTypeAssertionExpression(p) ||
    ts.isPrefixUnaryExpression(p)
  ) {
    return up(p)
  }
  if (ts.isVoidExpression(p) || ts.isExpressionStatement(p)) return { awaited, consumed: false }
  if (ts.isReturnStatement(p)) return useOfReturned(p, depth)
  if (ts.isArrowFunction(p) && p.body === node) return useOfReturned(node, depth)

  // `.ok` keeps the answer alive; `.then(fn)` hands it on; `.catch()` keeps it pending.
  if ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === node) {
    const outer = p.parent
    if (ts.isPropertyAccessExpression(p) && ts.isCallExpression(outer) && outer.expression === p) {
      if (p.name.text === 'then') return { awaited: up(outer).awaited, consumed: true }
    }
    return ts.isCallExpression(outer) && outer.expression === p ? up(outer) : up(p)
  }

  if (ts.isConditionalExpression(p)) return p.condition === node ? { awaited, consumed: true } : up(p)
  if (ts.isBinaryExpression(p)) {
    const op = p.operatorToken.kind
    if (op === ts.SyntaxKind.CommaToken) return p.left === node ? { awaited, consumed: false } : up(p)
    if (SHORT_CIRCUITS.has(op)) return p.left === node ? { awaited, consumed: true } : up(p)
    if (ASSIGNMENTS.has(op) && p.right === node) {
      const target = strip(p.left)
      return ts.isIdentifier(target) ? useOfNames([target.text], p, awaited, depth) : { awaited, consumed: true }
    }
    return up(p)
  }
  if (ts.isVariableDeclaration(p) && p.initializer === node) return useOfNames(boundNames(p.name), p, awaited, depth)

  if (ts.isArrayLiteralExpression(p)) {
    const call = p.parent
    if (
      ts.isCallExpression(call) &&
      ts.isPropertyAccessExpression(call.expression) &&
      ts.isIdentifier(call.expression.expression) &&
      call.expression.expression.text === 'Promise'
    ) {
      return up(call)
    }
    return up(p)
  }
  // A condition, a throw, an argument, a property or a JSX value: the answer is used.
  return { awaited, consumed: true }
}

/**
 * Names that hold what the caller sent. The same list as UNTRUSTED_NAMES in
 * scripts/s5-inventory.mjs, plus the header and cookie readers.
 */
const REQUEST_NAMES = new Set([
  'body', 'json', 'params', 'searchParams', 'nextUrl', 'query', 'form', 'formData', 'payload', 'input', 'req', 'request',
  'headers', 'cookies',
])
/** A call that answers from the server, even when the request picks which row. */
const SERVER_LOOKUP = /^(load|fetch|get|find|resolve|current|request)[A-Z]/

function rootOf(expr: ts.Expression): ts.Expression {
  let e = strip(expr)
  while (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e) || ts.isCallExpression(e)) e = strip(e.expression)
  return e
}

function isServerLookup(call: ts.CallExpression): boolean {
  const callee = strip(call.expression)
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : ''
  if (SERVER_LOOKUP.test(name)) return true
  // db.from('t').select().eq('id', body.id): a row, whatever picked it.
  for (let e: ts.Expression = call; ts.isCallExpression(e); ) {
    const c = strip(e.expression)
    if (!ts.isPropertyAccessExpression(c)) return false
    if (c.name.text === 'from') return true
    e = strip(c.expression)
  }
  return false
}

/** The expression's value comes from the request, directly or through local bindings. */
function readsRequest(expr: ts.Node, depth = 0): boolean {
  if (depth > 4) return false
  let found = false
  const visit = (n: ts.Node): void => {
    if (found) return
    if (ts.isCallExpression(n)) {
      const root = rootOf(n)
      if (!(ts.isIdentifier(root) && REQUEST_NAMES.has(root.text)) && isServerLookup(n)) return
    }
    if (ts.isPropertyAccessExpression(n)) {
      if (REQUEST_NAMES.has(n.name.text)) found = true
      else visit(n.expression)
      return
    }
    if (ts.isIdentifier(n) && !isDeclarationOrKey(n)) {
      if (REQUEST_NAMES.has(n.text)) {
        found = true
        return
      }
      const init = resolveBinding(n)
      if (init && readsRequest(init, depth + 1)) found = true
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(expr)
  return found
}

function firstArgOf(call: ts.CallExpression): CallUse['firstArg'] {
  const arg = call.arguments[0]
  if (!arg) return 'none'
  const e = strip(arg)
  if (ts.isIdentifier(e) && e.text === 'undefined') return 'undefined'
  return readsRequest(e) ? 'request' : 'value'
}

function hasExportModifier(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
}

function hasDefaultModifier(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
}

/** Collects the file's top-level bindings (function declarations and `const x = …`). */
function localFunctions(sf: ts.SourceFile): Map<string, ts.Node> {
  const map = new Map<string, ts.Node>()
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) map.set(stmt.name.text, stmt)
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) map.set(d.name.text, d.initializer)
      }
    }
  }
  return map
}

/** Named functions declared INSIDE `root` (`function f(){}`, `const f = () => …`). */
function nestedFunctions(root: ts.Node, into: Map<string, ts.Node>) {
  const visit = (n: ts.Node) => {
    if (n !== root) {
      if (ts.isFunctionDeclaration(n) && n.name) into.set(n.name.text, n)
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && isFunctionWithBody(strip(n.initializer))) {
        into.set(n.name.text, strip(n.initializer))
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(root)
}

function firstStatementOf(node: ts.Node): ts.Statement | null {
  if (isFunctionWithBody(node) && node.body && ts.isBlock(node.body)) return node.body.statements[0] ?? null
  return null
}

interface Scope {
  fileName: string
  locals: Map<string, ts.Node>
  imports: Map<string, Imported>
  /** Same-file exports trusted by name, with the library as their origin (analyzeNamedExport). */
  trusted?: Set<string>
}

/**
 * The handler inside `withAudit(spec, handler)`, imported from lib/audit/route, or
 * `withCronAudit(job, handler)`, imported from lib/cron-audit: each calls the handler
 * first and audits after, so the handler's first statement is the route's. No other
 * wrapper is read through, because nothing says when it calls what it is given.
 */
function wrappedHandlerOf(node: ts.Node, scope: Scope): ts.Node | null {
  if (!ts.isCallExpression(node)) return null
  const callee = strip(node.expression)
  const imp = ts.isIdentifier(callee) ? scope.imports.get(callee.text) : null
  const reads = (imp?.imported === 'withAudit' && imp.module === 'lib/audit/route') || (imp?.imported === 'withCronAudit' && imp.module === 'lib/cron-audit')
  if (!reads) return null
  const handler = node.arguments[1] && strip(node.arguments[1])
  if (!handler) return null
  return ts.isIdentifier(handler) ? (scope.locals.get(handler.text) ?? null) : handler
}

/**
 * The receiver of a call is a `.from(…)` query builder: `db.from('t').eq(…)`, or a
 * name bound to one (`const q = db.from('t')`). `Array.from` and the like are not.
 */
function isFromChain(expr: ts.Expression, depth = 0): boolean {
  let e = strip(expr)
  for (;;) {
    if (ts.isCallExpression(e)) {
      const callee = strip(e.expression)
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'from') {
        const r = strip(callee.expression)
        return !(ts.isIdentifier(r) && /^(Array|Buffer|Object|Set|Map|Uint8Array)$/.test(r.text))
      }
      e = callee
    } else if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) {
      e = strip(e.expression)
    } else if (ts.isIdentifier(e) && depth < 4) {
      const init = resolveBinding(e)
      return !!init && isFromChain(init, depth + 1)
    } else {
      return false
    }
  }
}

/** `fetch(url, { method })` with any method that is not a literal GET. */
function isOutboundWrite(call: ts.CallExpression): boolean {
  const options = call.arguments[1] && strip(call.arguments[1])
  if (!options || !ts.isObjectLiteralExpression(options)) return false
  const method = options.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === 'method')
  if (!method) return false
  if (!ts.isPropertyAssignment(method) || !ts.isStringLiteralLike(method.initializer)) return true
  return !/^(get|head)$/i.test(method.initializer.text)
}

function walkReachable(start: ts.Node, scope: Scope, enclosing?: ts.Node) {
  const { locals, imports, fileName } = scope
  const self = fileModule(fileName)
  const trusted = scope.trusted ?? new Set<string>()
  const nested = new Map<string, ts.Node>()
  const calls = new Set<string>()
  const origins = new Map<string, Set<string>>()
  const compares = new Set<string>()
  const uses = new Map<string, CallUse[]>()
  const rpcs = new Set<string | null>()
  let dbWrite = false
  let outboundWrite = false
  let role = false
  const seen = new Set<ts.Node>()

  const noteWrite = (call: ts.CallExpression) => {
    const callee = strip(call.expression)
    if (ts.isIdentifier(callee)) {
      if (callee.text === 'fetch' && !imports.has('fetch') && isOutboundWrite(call)) outboundWrite = true
      return
    }
    if (!ts.isPropertyAccessExpression(callee)) return
    const name = callee.name.text
    if (FROM_WRITE_CALLS.has(name) && isFromChain(callee.expression)) dbWrite = true
    if (name === 'rpc') {
      const first = call.arguments[0]
      rpcs.add(first && ts.isStringLiteralLike(first) ? first.text : null)
    }
  }

  const isLocal = (name: string) => nested.has(name) || locals.has(name)

  // Where an expression's value comes from: the module of the import (or the
  // `new`/call of an import) its root is bound to.
  const originOf = (expr: ts.Expression, depth = 0): string => {
    if (depth > 6) return UNKNOWN_ORIGIN
    const e = strip(expr)
    if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) return originOf(e.expression, depth + 1)
    if (ts.isCallExpression(e) && e.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const spec = e.arguments[0]
      return spec && ts.isStringLiteralLike(spec) ? resolveModule(fileName, spec.text) : UNKNOWN_ORIGIN
    }
    if (ts.isNewExpression(e) || ts.isCallExpression(e)) return originOf(e.expression, depth + 1)
    if (ts.isIdentifier(e)) {
      const imp = imports.get(e.text)
      if (imp) return imp.module
      if (trusted.has(e.text)) return self
      const init = resolveBinding(e)
      if (init) return originOf(init, depth + 1)
      return isLocal(e.text) ? UNKNOWN_ORIGIN : GLOBAL_ORIGIN
    }
    return UNKNOWN_ORIGIN
  }

  const receiverOf = (e: ts.Expression): string | null => {
    if (!ts.isPropertyAccessExpression(e) && !ts.isElementAccessExpression(e)) return null
    const r = strip(e.expression)
    if (ts.isIdentifier(r)) return imports.get(r.text)?.imported ?? r.text
    return ts.isPropertyAccessExpression(r) ? r.name.text : null
  }

  const add = (into: Set<string>, name: string, origin: string, site?: { call: ts.CallExpression; callee: ts.Expression }) => {
    into.add(name)
    calls.add(name)
    let set = origins.get(name)
    if (!set) origins.set(name, (set = new Set()))
    set.add(origin)
    if (site && origin === CHECKED_USE_ORIGIN) {
      let list = uses.get(name)
      if (!list) uses.set(name, (list = []))
      list.push({ ...useOf(site.call, false), receiver: receiverOf(site.callee), firstArg: firstArgOf(site.call) })
    }
  }

  // A bare identifier names either a same-file function (followed, and NOT
  // recorded: a local `function getCurrentMember() {}` must not pass for the
  // shared guard), an import (recorded under its imported name, with its
  // module), or a global. A method call is recorded with its receiver's origin.
  const record = (expr: ts.Expression, into: Set<string>, prefix = '', call?: ts.CallExpression) => {
    const e = ts.isParenthesizedExpression(expr) || ts.isNonNullExpression(expr) ? strip(expr) : expr
    const site = call && { call, callee: e }
    if (ts.isIdentifier(e)) {
      const imp = imports.get(e.text)
      if (imp) return add(into, prefix + imp.imported, imp.module, site)
      if (trusted.has(e.text) && !nested.has(e.text)) return add(into, prefix + e.text, self, site)
      if (isLocal(e.text)) return
      const dyn = dynamicImportBinding(e, fileName)
      if (dyn) return add(into, prefix + dyn.imported, dyn.module, site)
      if (resolveBinding(e)) return
      return add(into, prefix + e.text, GLOBAL_ORIGIN, site)
    }
    if (ts.isPropertyAccessExpression(e)) return add(into, prefix + e.name.text, originOf(e.expression), site)
    if (ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression)) {
      return add(into, prefix + e.argumentExpression.text, originOf(e.expression), site)
    }
  }

  const follow = (name: string) => {
    const target = nested.get(name) ?? locals.get(name)
    if (target && !seen.has(target)) {
      seen.add(target)
      nestedFunctions(target, nested)
      visit(target, true)
    }
  }

  const visitStatements = (statements: ts.NodeArray<ts.Statement>) => {
    for (const s of statements) {
      visit(s)
      // Nothing after an unconditional return or throw in this block runs.
      if (ts.isReturnStatement(s) || ts.isThrowStatement(s)) break
    }
  }

  const visit = (n: ts.Node, isRoot = false): void => {
    if (!isRoot && isFunctionWithBody(n) && !runsInPlace(n)) return
    if (ts.isCallExpression(n)) {
      record(n.expression, calls, '', n)
      noteWrite(n)
    } else if (ts.isNewExpression(n)) {
      record(n.expression, calls, 'new ')
    } else if (ts.isBinaryExpression(n) && EQUALITY.has(n.operatorToken.kind)) {
      if (isClaimsRoleAdmin(n.left, n.right) || isClaimsRoleAdmin(n.right, n.left)) role = true
      for (const [a, b] of [[n.left, n.right], [n.right, n.left]] as const) {
        const prop = propNameOf(a)
        if (prop && ts.isStringLiteralLike(b)) compares.add(`${prop}=${b.text}`)
      }
    } else if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      if (ts.isIdentifier(n.tagName)) follow(n.tagName.text)
    }
    // Any reference to a same-file function (a call, a callback, a wrapper's
    // argument) pulls that function's body in.
    if (ts.isIdentifier(n) && !isDeclarationOrKey(n)) follow(n.text)
    if (ts.isBlock(n) || ts.isCaseClause(n) || ts.isDefaultClause(n) || ts.isModuleBlock(n)) {
      visitStatements(n.statements)
      return
    }
    ts.forEachChild(n, (c) => visit(c))
  }

  seen.add(start)
  if (enclosing) nestedFunctions(enclosing, nested)
  nestedFunctions(start, nested)
  visit(start, true)

  // The first statement's own calls (not through helpers or nested functions).
  const firstStatementCalls = new Set<string>()
  const first = firstStatementOf(wrappedHandlerOf(start, scope) ?? start)
  if (first) {
    const direct = (n: ts.Node) => {
      if (isFunctionWithBody(n)) return
      if (ts.isCallExpression(n)) record(n.expression, firstStatementCalls)
      ts.forEachChild(n, direct)
    }
    direct(first)
  }

  return { calls, origins, compares, role, firstStatementCalls, uses, dbWrite, rpcs, outboundWrite }
}

function facts(name: string, node: ts.Node, scope: Scope, enclosing?: ts.Node): HandlerFacts {
  const { calls, origins, compares, role, firstStatementCalls, uses, dbWrite, rpcs, outboundWrite } = walkReachable(node, scope, enclosing)
  return { name, calls, origins, firstStatementCalls, comparesRoleToAdmin: role, compares, uses, dbWrite, rpcs, outboundWrite }
}

// A sweep asks about the same source many times, so keep the last parse of each file.
const parsed = new Map<string, { src: string; sf: ts.SourceFile }>()

function parse(fileName: string, src: string): ts.SourceFile {
  const hit = parsed.get(fileName)
  if (hit?.src === src) return hit.sf
  const kind = fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, kind)
  parsed.set(fileName, { src, sf })
  return sf
}

/** The parsed file analyzeNodeFacts walks: its nodes are what the caller passes back. */
export function parseSource(fileName: string, src: string): ts.SourceFile {
  return parse(fileName, src)
}

/**
 * Facts for one node of a parsed file: what running just that statement reaches. A
 * function the enclosing handler declares is followed when the node refers to it.
 */
export function analyzeNodeFacts(fileName: string, sf: ts.SourceFile, node: ts.Node, enclosing: ts.Node): HandlerFacts {
  return facts('node', node, scopeOf(sf, fileName), enclosing)
}

/** The initializer a name is bound to where it is read (a variable, not a parameter), or null. */
export function bindingOf(id: ts.Identifier): ts.Expression | null {
  return resolveBinding(id)
}

/** Every export of a module that is really another name: its module, or null for one of the file's own functions. */
export function reExportsOf(fileName: string, src: string): { named: Map<string, { module: string | null; name: string }>; stars: string[] } {
  const sf = parse(fileName, src)
  const imports = importsOf(sf, fileName)
  const named = new Map<string, { module: string | null; name: string }>()
  const stars: string[] = []
  for (const stmt of sf.statements) {
    if (!ts.isExportDeclaration(stmt)) continue
    const from = stmt.moduleSpecifier && ts.isStringLiteralLike(stmt.moduleSpecifier) ? resolveModule(fileName, stmt.moduleSpecifier.text) : null
    if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) {
        const local = (el.propertyName ?? el.name).text
        const imp = from ? null : imports.get(local)
        named.set(el.name.text, imp ? { module: imp.module, name: imp.imported } : { module: from, name: local })
      }
    } else if (from && !stmt.exportClause) {
      stars.push(from)
    }
  }
  return { named, stars }
}

/** The exported objects of a module that have a member of this name (`export const repo = { save() {} }`). */
export function exportedObjectsWith(fileName: string, src: string, member: string): string[] {
  const out: string[] = []
  for (const stmt of parse(fileName, src).statements) {
    if (!ts.isVariableStatement(stmt) || !hasExportModifier(stmt)) continue
    for (const d of stmt.declarationList.declarations) {
      const init = d.initializer && strip(d.initializer)
      if (!ts.isIdentifier(d.name) || !init || !ts.isObjectLiteralExpression(init)) continue
      if (init.properties.some((p) => p.name && ts.isIdentifier(p.name) && p.name.text === member)) out.push(d.name.text)
    }
  }
  return out
}

function scopeOf(sf: ts.SourceFile, fileName: string, trusted?: Set<string>): Scope {
  return { fileName, locals: localFunctions(sf), imports: importsOf(sf, fileName), trusted }
}

/** Facts for each exported HTTP method handler of an App Router route file. */
export function analyzeRoute(fileName: string, src: string): ModuleFacts {
  const sf = parse(fileName, src)
  const scope = scopeOf(sf, fileName)
  const locals = scope.locals
  const methods = new Set<string>(HTTP_METHODS)
  const handlers: HandlerFacts[] = []
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && hasExportModifier(stmt) && methods.has(stmt.name.text)) {
      handlers.push(facts(stmt.name.text, stmt, scope))
    } else if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && methods.has(d.name.text) && d.initializer) {
          handlers.push(facts(d.name.text, d.initializer, scope))
        }
      }
    } else if (ts.isExportDeclaration(stmt) && !stmt.moduleSpecifier && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) {
        const exported = el.name.text
        const local = (el.propertyName ?? el.name).text
        const target = locals.get(local)
        if (methods.has(exported) && target) handlers.push(facts(exported, target, scope))
      }
    }
  }
  return { handlers }
}

/** A table this file queries directly: `schema.table`, or null when the name is not a literal. */
export function directTableReads(fileName: string, src: string): (string | null)[] {
  const sf = parse(fileName, src)
  // A name resolves only when it is one `const` of a string and nothing else in the file
  // binds it. A `let`, a parameter or a shadowing name could hold anything, so it counts
  // as named at run time, which the rule refuses.
  const bindings = new Map<string, number>()
  const constants = new Map<string, string>()
  const collect = (n: ts.Node) => {
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n)) && ts.isIdentifier(n.name)) {
      bindings.set(n.name.text, (bindings.get(n.name.text) ?? 0) + 1)
    }
    if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && n.name) bindings.set(n.name.text, (bindings.get(n.name.text) ?? 0) + 1)
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isStringLiteralLike(n.initializer)) {
      if (ts.isVariableDeclarationList(n.parent) && n.parent.flags & ts.NodeFlags.Const) constants.set(n.name.text, n.initializer.text)
    }
    ts.forEachChild(n, collect)
  }
  collect(sf)
  for (const name of [...constants.keys()]) if (bindings.get(name) !== 1) constants.delete(name)
  const out: (string | null)[] = []
  const literal = (e: ts.Expression | undefined) =>
    !e ? null : ts.isStringLiteralLike(e) ? e.text : ts.isIdentifier(e) ? (constants.get(e.text) ?? null) : null
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'from') {
      const receiver = n.expression.expression
      // storage.from(bucket) is not a table; `Array.from` and the like are not a query.
      const isStorage = ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'storage'
      const isGlobal = ts.isIdentifier(receiver) && /^(Array|Buffer|Object|Set|Map|Uint8Array)$/.test(receiver.text)
      if (!isStorage && !isGlobal) {
        const table = literal(n.arguments[0])
        let schema = 'public'
        if (ts.isCallExpression(receiver) && ts.isPropertyAccessExpression(receiver.expression) && receiver.expression.name.text === 'schema') {
          schema = literal(receiver.arguments[0]) ?? 'unknown'
        }
        out.push(table === null ? null : `${schema}.${table}`)
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** The function each `.rpc(...)` in this file calls, or null when the name is not a literal. */
export function directRpcCalls(fileName: string, src: string): (string | null)[] {
  const out: (string | null)[] = []
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'rpc') {
      const first = n.arguments[0]
      out.push(first && ts.isStringLiteralLike(first) ? first.text : null)
    }
    ts.forEachChild(n, visit)
  }
  visit(parse(fileName, src))
  return out
}

/** Every exported name of a module, so a re-exported handler is never missed. */
export function exportedNames(fileName: string, src: string): string[] {
  const sf = parse(fileName, src)
  const names: string[] = []
  for (const stmt of sf.statements) {
    if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) && hasExportModifier(stmt)) {
      names.push(hasDefaultModifier(stmt) ? 'default' : stmt.name?.text ?? 'default')
    } else if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name)) names.push(d.name.text)
    } else if (ts.isExportDeclaration(stmt)) {
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) names.push(el.name.text)
      } else {
        names.push('*')
      }
    } else if (ts.isExportAssignment(stmt)) {
      names.push('default')
    }
  }
  return names
}

/** Facts for a page's (or metadata route's) default-exported function. */
export function analyzeDefaultExport(fileName: string, src: string): HandlerFacts | null {
  const sf = parse(fileName, src)
  const scope = scopeOf(sf, fileName)
  const locals = scope.locals
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && hasExportModifier(stmt) && hasDefaultModifier(stmt)) {
      return facts('default', stmt, scope)
    }
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      const e = stmt.expression
      const target = ts.isIdentifier(e) ? locals.get(e.text) ?? e : e
      return facts('default', target, scope)
    }
  }
  return null
}

/**
 * Facts for one named export of a library module (a shared guard helper such
 * as getOnboardedMember), so the test can prove the helper really reaches the
 * session, admin or rate-limit check it is trusted for. Null when not found.
 * A dotted name reads a method of an exported object (`page.requireAdmin`).
 */
export function analyzeNamedExport(fileName: string, src: string, name: string): HandlerFacts | null {
  const sf = parse(fileName, src)
  const scope = scopeOf(sf, fileName, new Set(exportedNames(fileName, src)))
  const [objectName, methodName] = name.split('.')
  if (methodName) {
    for (const stmt of sf.statements) {
      if (!ts.isVariableStatement(stmt) || !hasExportModifier(stmt)) continue
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || d.name.text !== objectName || !d.initializer) continue
        const obj = strip(d.initializer)
        if (!ts.isObjectLiteralExpression(obj)) return null
        for (const p of obj.properties) {
          if (!p.name || !ts.isIdentifier(p.name) || p.name.text !== methodName) continue
          if (ts.isMethodDeclaration(p)) return facts(name, p, scope)
          if (ts.isPropertyAssignment(p)) return facts(name, strip(p.initializer), scope)
        }
        return null
      }
    }
    return null
  }
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name && hasExportModifier(stmt)) {
      return facts(name, stmt, scope)
    }
    if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) return facts(name, d.initializer, scope)
      }
    }
    // `function save() {}` then `export { save }` or `export { save as store }`.
    if (ts.isExportDeclaration(stmt) && !stmt.moduleSpecifier && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) {
        const target = el.name.text === name ? scope.locals.get((el.propertyName ?? el.name).text) : undefined
        if (target) return facts(name, target, scope)
      }
    }
  }
  return null
}

// ── Request id inputs (S2/S4 cross-tenant and IDOR generator) ─────────────────
//
// Which ids a route handler takes from the query string or the request body,
// so lib/security/idor-targets.ts can tell an id-bearing route that has no
// dynamic path segment. Static, per file, and deliberately generous: a false
// positive only adds a test case, a false negative drops one.
//
// Found:
//   - query: `<x>.searchParams.get('name')` / `.getAll('name')`, on
//     `searchParams`, on any `….searchParams`, or on a name bound to one of
//     those or to `new URLSearchParams(…)`;
//   - body: a name bound to `await <x>.json()` / `.formData()` (through
//     `await`, `as`, parentheses and `.catch(…)`), or to a repo body reader
//     (`readJson`, `readCapped`, `readParams`), then the fields destructured
//     from it, read as `body.name` / `body['name']`, or `form.get('name')`;
//     plus the keys of any `z.object({ … })` in a file that reads a body;
//   - nested body: fields of the elements of a body array, iterated with
//     `for … of` or an array method (`items[].variantId`).
// Kept: names that look like an id (`isIdLikeName`). The rest of the body
// fields are returned as `fill`.

/**
 * True for a field name that names a record: an id, slug, token or number, a
 * storage path (`storagePath`: the object key IS the record), a reference
 * string (`ref=tr:<id>`), or an email (a person is looked up by it). For a
 * nested field (`items[].variantId`) the last part decides.
 */
export function isIdLikeName(name: string): boolean {
  const n = name.split('.').pop() ?? name
  return (
    /^(id|ids|uuid|slug|token|number|key|path|paths|ref|refs|email|emails)$/i.test(n) ||
    /(Id|Ids|_id|_ids|Slug|_slug|Token|_token|Number|_number|Uuid|Path|_path|Ref|_ref|Email|_email)$/.test(n) ||
    /^(event|participant|participation|registration|member|team|cohort|invitation)$/.test(n)
  )
}

const BODY_READERS = new Set(['readJson', 'readCapped', 'readParams'])

export interface RequestIdInputs {
  query: string[]
  /** Id-like body fields; `items[].variantId` is a field of each `items` element. */
  body: string[]
  /** The other top-level body fields: the harness fills them so validation lets the id through. */
  fill: string[]
}

export function requestIdInputs(fileName: string, src: string): RequestIdInputs {
  const sf = parse(fileName, src)
  const query = new Set<string>()
  const body = new Set<string>()
  const paramsNames = new Set<string>(['searchParams'])
  const bodyNames = new Set<string>()
  const zodKeys = new Set<string>()
  let readsBody = false

  const peel = (e: ts.Expression): ts.Expression => {
    let cur = strip(e)
    // `req.json().catch(() => null)` → `req.json()`
    while (
      ts.isCallExpression(cur) &&
      ts.isPropertyAccessExpression(cur.expression) &&
      ['catch', 'then', 'finally'].includes(cur.expression.name.text)
    ) {
      cur = strip(cur.expression.expression)
    }
    return cur
  }
  const isBodyRead = (e: ts.Expression): boolean => {
    const cur = peel(e)
    if (!ts.isCallExpression(cur)) return false
    if (ts.isPropertyAccessExpression(cur.expression)) {
      return ['json', 'formData'].includes(cur.expression.name.text) && cur.arguments.length === 0
    }
    return ts.isIdentifier(cur.expression) && BODY_READERS.has(cur.expression.text)
  }
  const isParamsSource = (e: ts.Expression): boolean => {
    const cur = strip(e)
    if (ts.isPropertyAccessExpression(cur)) return cur.name.text === 'searchParams'
    if (ts.isNewExpression(cur)) return ts.isIdentifier(cur.expression) && cur.expression.text === 'URLSearchParams'
    if (ts.isIdentifier(cur)) return paramsNames.has(cur.text)
    return false
  }
  const bodyIdent = (e: ts.Expression): boolean => {
    const cur = strip(e)
    return ts.isIdentifier(cur) && bodyNames.has(cur.text)
  }
  const addPattern = (p: ts.BindingName, into: Set<string>) => {
    if (!ts.isObjectBindingPattern(p)) return
    for (const el of p.elements) {
      const key = el.propertyName ?? el.name
      if (ts.isIdentifier(key) || ts.isStringLiteral(key)) into.add(key.text)
    }
  }

  // Pass 1: bindings (a name bound to the body or to search params).
  const bind = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && n.initializer) {
      if (isBodyRead(n.initializer)) {
        readsBody = true
        if (ts.isIdentifier(n.name)) bodyNames.add(n.name.text)
        else addPattern(n.name, body)
      } else if (isParamsSource(n.initializer)) {
        if (ts.isIdentifier(n.name)) paramsNames.add(n.name.text)
      } else if (ts.isObjectBindingPattern(n.name)) {
        // `const { searchParams } = new URL(req.url)` / `req.nextUrl`
        for (const el of n.name.elements) {
          const key = el.propertyName ?? el.name
          if (ts.isIdentifier(key) && key.text === 'searchParams' && ts.isIdentifier(el.name)) paramsNames.add(el.name.text)
        }
      }
    }
    if (ts.isCallExpression(n) && isBodyRead(n)) readsBody = true
    ts.forEachChild(n, bind)
  }
  bind(sf)

  // Pass 2: reads.
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const method = n.expression.name.text
      const recv = strip(n.expression.expression)
      const arg = n.arguments[0]
      if ((method === 'get' || method === 'getAll') && arg && ts.isStringLiteralLike(arg)) {
        if (isParamsSource(recv)) query.add(arg.text)
        else if (bodyIdent(recv)) body.add(arg.text)
      }
      // z.object({ … })
      if (method === 'object' && ts.isIdentifier(recv) && recv.text === 'z' && arg && ts.isObjectLiteralExpression(arg)) {
        for (const p of arg.properties) {
          if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
            zodKeys.add(p.name.text)
          }
        }
      }
    }
    // `body.teamId`, but not a method call on the body (`form.get(…)`).
    const isCallee = n.parent && ts.isCallExpression(n.parent) && n.parent.expression === n
    if (ts.isPropertyAccessExpression(n) && bodyIdent(n.expression) && !isCallee) body.add(n.name.text)
    if (ts.isElementAccessExpression(n) && bodyIdent(n.expression) && ts.isStringLiteralLike(n.argumentExpression)) {
      body.add(n.argumentExpression.text)
    }
    if (ts.isVariableDeclaration(n) && n.initializer && bodyIdent(n.initializer)) addPattern(n.name, body)

    // Nested: `const raw = Array.isArray(body.items) ? body.items : []`, then
    // `for (const it of raw) it.variantId` or `raw.map((it) => it.variantId)`.
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.name)) {
      const field = bodyFieldIn(n.initializer)
      if (field) arrayNames.set(n.name.text, field)
    }
    if (ts.isForOfStatement(n) && ts.isVariableDeclarationList(n.initializer)) {
      const field = arrayField(n.expression)
      const decl = n.initializer.declarations[0]
      if (field && decl && ts.isIdentifier(decl.name)) elemNames.set(decl.name.text, field)
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ARRAY_METHODS.has(n.expression.name.text)) {
      const field = arrayField(n.expression.expression)
      const fn = n.arguments[0]
      if (field && fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
        const param = fn.parameters[n.expression.name.text === 'reduce' ? 1 : 0]
        if (param && ts.isIdentifier(param.name)) elemNames.set(param.name.text, field)
      }
    }
    if (ts.isPropertyAccessExpression(n)) {
      const recv = strip(n.expression)
      if (ts.isIdentifier(recv) && elemNames.has(recv.text)) nested.add(`${elemNames.get(recv.text)}[].${n.name.text}`)
    }
    ts.forEachChild(n, visit)
  }
  const arrayNames = new Map<string, string>()
  const elemNames = new Map<string, string>()
  const nested = new Set<string>()
  /** The body field an expression reads (`body.items`, `body?.items ?? []`), if exactly one. */
  const bodyFieldIn = (e: ts.Expression): string | null => {
    const found = new Set<string>()
    const walk = (x: ts.Node): void => {
      if (ts.isPropertyAccessExpression(x) && bodyIdent(x.expression)) found.add(x.name.text)
      ts.forEachChild(x, walk)
    }
    walk(e)
    return found.size === 1 ? [...found][0] : null
  }
  const arrayField = (e: ts.Expression): string | null => {
    const cur = strip(e)
    if (ts.isIdentifier(cur) && arrayNames.has(cur.text)) return arrayNames.get(cur.text) ?? null
    if (ts.isPropertyAccessExpression(cur) && bodyIdent(cur.expression)) return cur.name.text
    return null
  }
  visit(sf)

  if (readsBody) for (const k of zodKeys) body.add(k)
  const keep = (s: Set<string>) => [...s].filter(isIdLikeName).sort()
  return {
    query: keep(query),
    body: [...keep(body), ...keep(nested)].sort(),
    fill: [...body].filter((b) => !isIdLikeName(b)).sort(),
  }
}

const ARRAY_METHODS = new Set(['map', 'forEach', 'filter', 'some', 'every', 'find', 'flatMap', 'reduce'])
