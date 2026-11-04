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
//     counts as calling requireAdmin);
//   - which calls its FIRST statement makes (crons must start with guardCron);
//   - whether it compares a `.role` to the literal 'admin' (the inline guard).
//
// Calls are recorded by their final name: `auth()` → auth,
// `stripe.webhooks.constructEvent()` → constructEvent, `new Webhook(s).verify()`
// → verify, and `new Webhook()` → `new Webhook`. JSX tags naming a component
// declared in the same file are followed like calls, so a page that renders a
// local `<Loader />` which reads the session counts.
import ts from 'typescript'

export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const

export interface HandlerFacts {
  /** The export name: an HTTP method for a route, 'default' for a page. */
  name: string
  /** Every call reachable from the handler, through same-file helpers. */
  calls: Set<string>
  /** Calls made directly by the handler's first statement (not through helpers). */
  firstStatementCalls: Set<string>
  /** The handler (or a same-file helper it reaches) compares `.role` to 'admin'. */
  comparesRoleToAdmin: boolean
}

export interface ModuleFacts {
  handlers: HandlerFacts[]
}

type FnLike = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression

function calleeName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text
  if (ts.isElementAccessExpression(expr) && ts.isStringLiteralLike(expr.argumentExpression)) {
    return expr.argumentExpression.text
  }
  if (ts.isParenthesizedExpression(expr)) return calleeName(expr.expression)
  if (ts.isNonNullExpression(expr)) return calleeName(expr.expression)
  return null
}

function isRoleAccess(expr: ts.Expression): boolean {
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text === 'role'
  if (ts.isElementAccessExpression(expr)) {
    return ts.isStringLiteralLike(expr.argumentExpression) && expr.argumentExpression.text === 'role'
  }
  if (ts.isIdentifier(expr)) return expr.text === 'role'
  if (ts.isParenthesizedExpression(expr) || ts.isNonNullExpression(expr)) return isRoleAccess(expr.expression)
  return false
}

function isAdminLiteral(expr: ts.Expression): boolean {
  return ts.isStringLiteralLike(expr) && expr.text === 'admin'
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

/** Collects the file's top-level functions (declarations and `const x = () => …`). */
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

function bodyOf(node: ts.Node): ts.Node {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    return (node as FnLike).body ?? node
  }
  return node
}

function firstStatementOf(node: ts.Node): ts.Statement | null {
  const body = bodyOf(node)
  if (ts.isBlock(body)) return body.statements[0] ?? null
  return null
}

/** Calls made inside `node`, without descending into nested function bodies. */
function directCalls(node: ts.Node, aliases: Map<string, string>): Set<string> {
  const out = new Set<string>()
  const visit = (n: ts.Node) => {
    if (ts.isFunctionLike(n) && n !== node) return
    if (ts.isCallExpression(n)) {
      const name = calleeName(n.expression)
      if (name) out.add(aliases.get(name) ?? name)
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return out
}

/** `import { auth as clerkAuth }` → clerkAuth ↦ auth, so an alias is still recognised. */
function importAliases(sf: ts.SourceFile): Map<string, string> {
  const map = new Map<string, string>()
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue
    const named = stmt.importClause?.namedBindings
    if (!named || !ts.isNamedImports(named)) continue
    for (const el of named.elements) {
      if (el.propertyName) map.set(el.name.text, el.propertyName.text)
    }
  }
  return map
}

interface Scope {
  locals: Map<string, ts.Node>
  aliases: Map<string, string>
  /** Same-file functions whose NAME is still recorded (a library's own exports). */
  trusted?: Set<string>
}

function walkReachable(start: ts.Node, scope: Scope): { calls: Set<string>; role: boolean } {
  const { locals, aliases } = scope
  const trusted = scope.trusted ?? new Set<string>()
  const calls = new Set<string>()
  let role = false
  const seen = new Set<ts.Node>()
  // A bare identifier names either a same-file function (followed, and NOT
  // recorded: a local `function getCurrentMember() {}` must not pass for the
  // shared guard) or an import (recorded under its imported name). A library
  // module's own exports are trusted by name: isAdminClaims called inside
  // lib/admin-auth.ts IS the shared guard.
  const record = (expr: ts.Expression, prefix = '') => {
    if (ts.isIdentifier(expr)) {
      if (locals.has(expr.text) && !trusted.has(expr.text)) return
      calls.add(prefix + (aliases.get(expr.text) ?? expr.text))
      return
    }
    const name = calleeName(expr)
    if (name) calls.add(prefix + name)
  }
  const follow = (name: string) => {
    const target = locals.get(name)
    if (target && !seen.has(target)) {
      seen.add(target)
      visit(target)
    }
  }
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      record(n.expression)
    } else if (ts.isNewExpression(n)) {
      record(n.expression, 'new ')
    } else if (ts.isBinaryExpression(n) && EQUALITY.has(n.operatorToken.kind)) {
      if ((isRoleAccess(n.left) && isAdminLiteral(n.right)) || (isRoleAccess(n.right) && isAdminLiteral(n.left))) {
        role = true
      }
    } else if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      if (ts.isIdentifier(n.tagName)) follow(n.tagName.text)
    }
    // Any reference to a same-file function — a call, a callback, a wrapper's
    // argument — pulls that function's body in.
    if (ts.isIdentifier(n)) follow(n.text)
    ts.forEachChild(n, visit)
  }
  seen.add(start)
  visit(start)
  return { calls, role }
}

function facts(name: string, node: ts.Node, scope: Scope): HandlerFacts {
  const { calls, role } = walkReachable(node, scope)
  const first = firstStatementOf(node)
  return {
    name,
    calls,
    firstStatementCalls: first ? directCalls(first, scope.aliases) : new Set(),
    comparesRoleToAdmin: role,
  }
}

function parse(fileName: string, src: string): ts.SourceFile {
  const kind = fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, kind)
}

/** Facts for each exported HTTP method handler of an App Router route file. */
export function analyzeRoute(fileName: string, src: string): ModuleFacts {
  const sf = parse(fileName, src)
  const scope: Scope = { locals: localFunctions(sf), aliases: importAliases(sf) }
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

/** Facts for a page's (or layout's) default-exported component. */
export function analyzeDefaultExport(fileName: string, src: string): HandlerFacts | null {
  const sf = parse(fileName, src)
  const scope: Scope = { locals: localFunctions(sf), aliases: importAliases(sf) }
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
  const scope: Scope = {
    locals: localFunctions(sf),
    aliases: importAliases(sf),
    trusted: new Set(exportedNames(fileName, src)),
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
  }
  return null
}
