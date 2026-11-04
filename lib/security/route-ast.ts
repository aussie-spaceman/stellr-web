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
//   - whether it compares a role read from the Clerk session claims to 'admin'.
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

function walkReachable(start: ts.Node, scope: Scope) {
  const { locals, imports, fileName } = scope
  const self = fileModule(fileName)
  const trusted = scope.trusted ?? new Set<string>()
  const nested = new Map<string, ts.Node>()
  const calls = new Set<string>()
  const origins = new Map<string, Set<string>>()
  const compares = new Set<string>()
  let role = false
  const seen = new Set<ts.Node>()

  const isLocal = (name: string) => nested.has(name) || locals.has(name)

  // Where an expression's value comes from: the module of the import (or the
  // `new`/call of an import) its root is bound to.
  const originOf = (expr: ts.Expression, depth = 0): string => {
    if (depth > 6) return UNKNOWN_ORIGIN
    const e = strip(expr)
    if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) return originOf(e.expression, depth + 1)
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

  const add = (into: Set<string>, name: string, origin: string) => {
    into.add(name)
    calls.add(name)
    let set = origins.get(name)
    if (!set) origins.set(name, (set = new Set()))
    set.add(origin)
  }

  // A bare identifier names either a same-file function (followed, and NOT
  // recorded: a local `function getCurrentMember() {}` must not pass for the
  // shared guard), an import (recorded under its imported name, with its
  // module), or a global. A method call is recorded with its receiver's origin.
  const record = (expr: ts.Expression, into: Set<string>, prefix = '') => {
    const e = ts.isParenthesizedExpression(expr) || ts.isNonNullExpression(expr) ? strip(expr) : expr
    if (ts.isIdentifier(e)) {
      const imp = imports.get(e.text)
      if (imp) return add(into, prefix + imp.imported, imp.module)
      if (trusted.has(e.text) && !nested.has(e.text)) return add(into, prefix + e.text, self)
      if (isLocal(e.text)) return
      const dyn = dynamicImportBinding(e, fileName)
      if (dyn) return add(into, prefix + dyn.imported, dyn.module)
      if (resolveBinding(e)) return
      return add(into, prefix + e.text, GLOBAL_ORIGIN)
    }
    if (ts.isPropertyAccessExpression(e)) return add(into, prefix + e.name.text, originOf(e.expression))
    if (ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression)) {
      return add(into, prefix + e.argumentExpression.text, originOf(e.expression))
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
      record(n.expression, calls)
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
  nestedFunctions(start, nested)
  visit(start, true)

  // The first statement's own calls (not through helpers or nested functions).
  const firstStatementCalls = new Set<string>()
  const first = firstStatementOf(start)
  if (first) {
    const direct = (n: ts.Node) => {
      if (isFunctionWithBody(n)) return
      if (ts.isCallExpression(n)) record(n.expression, firstStatementCalls)
      ts.forEachChild(n, direct)
    }
    direct(first)
  }

  return { calls, origins, compares, role, firstStatementCalls }
}

function facts(name: string, node: ts.Node, scope: Scope): HandlerFacts {
  const { calls, origins, compares, role, firstStatementCalls } = walkReachable(node, scope)
  return { name, calls, origins, firstStatementCalls, comparesRoleToAdmin: role, compares }
}

function parse(fileName: string, src: string): ts.SourceFile {
  const kind = fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, kind)
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
 */
export function analyzeNamedExport(fileName: string, src: string, name: string): HandlerFacts | null {
  const sf = parse(fileName, src)
  const scope = scopeOf(sf, fileName, new Set(exportedNames(fileName, src)))
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name && hasExportModifier(stmt)) {
      return facts(name, stmt, scope)
    }
    if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) return facts(name, d.initializer, scope)
      }
    }
  }
  return null
}
