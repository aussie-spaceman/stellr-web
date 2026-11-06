// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// limit() and rateLimit() are async, so a missing `await` hands back a Promise:
// always truthy, never a decision. `if (rateLimit(...))` refuses everyone, while a
// bare `rateLimit(...)` limits no one. Nothing about that fails at compile time,
// so this does (S5 B4).
//
// Awaiting is not enough either. limit() resolves to an object, which is always
// truthy, so its decision has to be read through `.ok`. rateLimit() resolves to
// the 429 itself, so that value has to reach a `return`. A file whose own variable
// or parameter shares one of these names has to alias the import.

const API = new Set(['limit', 'rateLimit'])
const isAsyncModule = (spec: string) => /(^|\/)rate-limit-async$/.test(spec)

/** The expression with any parentheses taken off. */
function unwrap(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node
}

/** Whether a value in this position is what the expression evaluates to, as in `a ?? b` or `c ? a : b`. */
function passesValueUp(parent: ts.Node, child: ts.Node): boolean {
  if (ts.isParenthesizedExpression(parent)) return true
  if (ts.isBinaryExpression(parent)) return parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || parent.operatorToken.kind === ts.SyntaxKind.BarBarToken
  return ts.isConditionalExpression(parent) && parent.condition !== child
}

/** Whether this expression evaluates to the named variable, on some branch. */
function evaluatesTo(node: ts.Expression, name: string): boolean {
  const expr = unwrap(node)
  if (ts.isIdentifier(expr)) return expr.text === name
  if (ts.isBinaryExpression(expr) && passesValueUp(expr, expr.left)) return evaluatesTo(expr.left, name) || evaluatesTo(expr.right, name)
  return ts.isConditionalExpression(expr) && (evaluatesTo(expr.whenTrue, name) || evaluatesTo(expr.whenFalse, name))
}

/** Whether any node under `root` satisfies the test. */
function some(root: ts.Node, test: (node: ts.Node) => boolean): boolean {
  return test(root) || ts.forEachChild(root, (child) => some(child, test) || undefined) === true
}

/** The nearest function around a node, or the file. */
function scopeOf(node: ts.Node): ts.Node {
  let at = node.parent
  while (at && !ts.isFunctionLike(at) && !ts.isSourceFile(at)) at = at.parent
  return at
}

/** Whether limit()'s awaited decision is read through `.ok`. */
function readsOk(awaited: ts.Node): boolean {
  let at = awaited
  while (ts.isParenthesizedExpression(at.parent)) at = at.parent
  const parent = at.parent
  if (ts.isPropertyAccessExpression(parent) && parent.expression === at) return parent.name.text === 'ok'
  if (!ts.isVariableDeclaration(parent)) return false
  if (ts.isObjectBindingPattern(parent.name)) {
    return parent.name.elements.some((el) => (el.propertyName ?? el.name).getText() === 'ok')
  }
  const variable = parent.name.getText()
  return some(scopeOf(parent), (node) => ts.isPropertyAccessExpression(node) && node.name.text === 'ok' && ts.isIdentifier(unwrap(node.expression)) && unwrap(node.expression).getText() === variable)
}

/** Whether rateLimit()'s awaited response is returned, directly or through a variable. */
function reachesReturn(awaited: ts.Node): boolean {
  let at = awaited
  while (passesValueUp(at.parent, at)) at = at.parent
  const parent = at.parent
  if (ts.isReturnStatement(parent)) return true
  if (ts.isArrowFunction(parent) && parent.body === at) return true
  if (!ts.isVariableDeclaration(parent) || !ts.isIdentifier(parent.name)) return false
  const variable = parent.name.text
  return some(scopeOf(parent), (node) => {
    if (ts.isReturnStatement(node)) return !!node.expression && evaluatesTo(node.expression, variable)
    return ts.isArrowFunction(node) && !ts.isBlock(node.body) && evaluatesTo(node.body, variable)
  })
}

/** Whether this identifier names something other than the imported function. */
function isOtherName(node: ts.Identifier): boolean {
  const parent = node.parent
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isNamespaceImport(parent)) return true
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true
  if (ts.isQualifiedName(parent) && parent.right === node) return true
  if (ts.isBindingElement(parent) && parent.propertyName === node) return true
  return (
    (ts.isPropertyAssignment(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent)) &&
    parent.name === node
  )
}

/** Each use of the async API that does not turn into a real limit. */
function findUnawaitedCalls(fileName: string, src: string): string[] {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names = new Map<string, string>()
  const namespaces = new Set<string>()
  const problems: string[] = []
  const report = (node: ts.Node, what: string) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
    problems.push(`${fileName}:${line} ${what}`)
  }

  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) && isAsyncModule(st.moduleSpecifier.text)) {
      report(st, 're-exports the async limiter, which hides its callers')
    }
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !isAsyncModule(st.moduleSpecifier.text)) continue
    const bindings = st.importClause?.namedBindings
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        const imported = (el.propertyName ?? el.name).text
        if (API.has(imported)) names.set(el.name.text, imported)
      }
    }
  }

  /** The API function this expression refers to, if any. */
  const apiNameOf = (expr: ts.Expression): string | undefined => {
    if (ts.isIdentifier(expr)) return names.get(expr.text)
    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && namespaces.has(expr.expression.text) && API.has(expr.name.text)) return expr.name.text
    return undefined
  }
  const outerOf = (node: ts.Node) => {
    let parent = node.parent
    while (ts.isParenthesizedExpression(parent)) parent = parent.parent
    return parent
  }
  const isCallee = (node: ts.Node) => ts.isCallExpression(node.parent) && node.parent.expression === node

  const checkCall = (node: ts.CallExpression, api: string) => {
    const shown = node.expression.getText(sf)
    const parent = outerOf(node)
    if (!ts.isAwaitExpression(parent)) report(node, `${shown}() is not awaited`)
    else if (ts.isExpressionStatement(outerOf(parent))) report(node, `the result of ${shown}() is discarded`)
    else if (api === 'limit' && !readsOk(parent)) report(node, `the decision from ${shown}() is not read through .ok`)
    else if (api === 'rateLimit' && !reachesReturn(parent)) report(node, `the response from ${shown}() never reaches a return`)
  }

  /** Whether this identifier declares a local that hides an imported name. */
  const shadowsImport = (node: ts.Identifier) => {
    const parent = node.parent
    const declares = (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent) || ts.isFunctionDeclaration(parent)) && parent.name === node
    return declares && (names.has(node.text) || namespaces.has(node.text))
  }

  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && shadowsImport(node)) report(node, `${node.text} hides the imported limiter, so alias the import`)
    if (ts.isCallExpression(node)) {
      const api = apiNameOf(node.expression)
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && isAsyncModule(node.arguments[0].text)) {
        report(node, 'imports the async limiter dynamically, which this check cannot follow')
      } else if (api) {
        checkCall(node, api)
      }
    } else if (ts.isPropertyAccessExpression(node) && apiNameOf(node) && !isCallee(node)) {
      report(node, `${node.getText(sf)} is used without being called`)
    } else if (ts.isIdentifier(node) && !isOtherName(node) && !isCallee(node)) {
      const isNamespaceRead = namespaces.has(node.text) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node)
      if (names.has(node.text) || isNamespaceRead) report(node, `${node.text} is used without being called`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return problems
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full)
    return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) ? [full] : []
  })
}

describe('async rate limiter calls', () => {
  it('are all awaited, across the app', () => {
    const root = process.cwd()
    const files = ['app', 'components', 'lib', 'packages'].flatMap((d) => sourceFiles(path.join(root, d)))
    files.push(path.join(root, 'proxy.ts'))
    expect(files.length).toBeGreaterThan(500)
    const problems = files.flatMap((f) => findUnawaitedCalls(path.relative(root, f), readFileSync(f, 'utf8')))
    expect(problems).toEqual([])
  }, 120_000)
})

describe('findUnawaitedCalls', () => {
  const IMPORT = "import { limit, rateLimit } from '@/lib/rate-limit-async'\n"

  it('fails on a planted un-awaited rateLimit(', () => {
    const src = `${IMPORT}export async function POST(req: Request) {\n  const blocked = rateLimit(req, 'x', { limit: 1, windowMs: 1 })\n  if (blocked) return blocked\n}\n`
    expect(findUnawaitedCalls('app/api/x/route.ts', src)).toEqual(['app/api/x/route.ts:3 rateLimit() is not awaited'])
  })

  it('accepts an awaited call, with or without parentheses', () => {
    const src = `${IMPORT}export async function f(req: Request) {\n  const a = await rateLimit(req, 'x', { limit: 1, windowMs: 1 })\n  const b = await (limit('k', { limit: 1, windowMs: 1 }))\n  if (!b.ok) return null\n  return a ?? other()\n}\n`
    expect(findUnawaitedCalls('a.ts', src)).toEqual([])
  })

  describe('limit() must be read through .ok', () => {
    const call = "limit('k', { limit: 1, windowMs: 1, tenantId: null })"
    const body = (code: string) => `${IMPORT}export async function f() {\n${code}\n}\n`

    it.each([
      [`if (!(await ${call}).ok) return 1`],
      [`const d = await ${call}\n  if (!d.ok) return d.retryAfterSeconds`],
      [`const { ok, retryAfterSeconds } = await ${call}\n  return ok ? 0 : retryAfterSeconds`],
      [`const { ok: allowed } = await ${call}\n  return allowed`],
    ])('accepts %s', (code) => {
      expect(findUnawaitedCalls('a.ts', body(code))).toEqual([])
    })

    it.each([
      [`if (!(await ${call})) return 1`],
      [`if (await ${call}) return 1`],
      [`const d = await ${call}\n  if (!d) return 1`],
      [`return await ${call}`],
      [`return (await ${call}).retryAfterSeconds`],
      [`const { retryAfterSeconds } = await ${call}\n  return retryAfterSeconds`],
    ])('fails on %s', (code) => {
      expect(findUnawaitedCalls('a.ts', body(code))).toEqual([expect.stringContaining('is not read through .ok')])
    })
  })

  describe('rateLimit() must reach a return', () => {
    const call = "rateLimit(req, 'x', { limit: 1, windowMs: 1, tenantId: null })"
    const body = (code: string) => `${IMPORT}export async function POST(req: Request) {\n${code}\n}\n`

    it.each([
      [`const blocked = await ${call}\n  if (blocked) return blocked`],
      [`return await ${call}`],
      [`return (await ${call}) ?? handle()`],
      [`const blocked = await ${call}\n  return blocked ?? handle()`],
      [`const blocked = await ${call}\n  return blocked ? blocked : handle()`],
    ])('accepts %s', (code) => {
      expect(findUnawaitedCalls('a.ts', body(code))).toEqual([])
    })

    it('accepts an arrow function that evaluates to it', () => {
      expect(findUnawaitedCalls('a.ts', `${IMPORT}export const g = async (req: Request) => (await ${call})\n`)).toEqual([])
    })

    it.each([
      [`const blocked = await ${call}\n  return handle()`],
      [`const blocked = await ${call}\n  if (blocked) return tooMany()`],
      [`if (await ${call}) return tooMany()`],
      [`return (await ${call}) ? tooMany() : handle()`],
    ])('fails on %s', (code) => {
      expect(findUnawaitedCalls('a.ts', body(code))).toEqual([expect.stringContaining('never reaches a return')])
    })
  })

  describe('the imported name must be called', () => {
    it('fails on a local alias, passing it along, and the namespace itself', () => {
      expect(findUnawaitedCalls('a.ts', `${IMPORT}const g = rateLimit\nexport { g }\n`)).toEqual(['a.ts:2 rateLimit is used without being called'])
      expect(findUnawaitedCalls('a.ts', `${IMPORT}export const a = wrap(limit)\n`)).toEqual(['a.ts:2 limit is used without being called'])
      expect(findUnawaitedCalls('a.ts', "import * as rl from './rate-limit-async'\nexport const a = rl.limit\n")).toEqual(['a.ts:2 rl.limit is used without being called'])
      expect(findUnawaitedCalls('a.ts', "import * as rl from './rate-limit-async'\nexport const a = rl\n")).toEqual(['a.ts:2 rl is used without being called'])
    })

    it('does not mistake an option or a property of the same name for it', () => {
      const src = `${IMPORT}export const opts = { limit: 1, windowMs: 1 }\nexport const n = opts.limit\ninterface X { limit: number }\nexport type Y = X\n`
      expect(findUnawaitedCalls('a.ts', src)).toEqual([])
      expect(findUnawaitedCalls('a.ts', `${IMPORT}export function f(o: { limit: number }) {\n  const { limit: max } = o\n  return max\n}\n`)).toEqual([])
    })

    it('fails on a local that hides the import, even when the call looks right', () => {
      const body = (code: string) => `${IMPORT}export async function f(o: { limit: number }) {\n${code}\n}\n`
      const hidden = 'hides the imported limiter'
      expect(findUnawaitedCalls('a.ts', body("  const limit = async () => ({ ok: true })\n  const d = await limit('k')\n  return d.ok"))).toEqual([`a.ts:3 limit ${hidden}, so alias the import`])
      expect(findUnawaitedCalls('a.ts', body('  const { limit } = o\n  return limit'))).toEqual(expect.arrayContaining([expect.stringContaining(hidden)]))
      expect(findUnawaitedCalls('a.ts', `${IMPORT}export function f(rateLimit: number) {\n  return 1\n}\n`)).toEqual([`a.ts:2 rateLimit ${hidden}, so alias the import`])
      expect(findUnawaitedCalls('a.ts', `${IMPORT}function limit() {\n  return 1\n}\n`)).toEqual([`a.ts:2 limit ${hidden}, so alias the import`])
      expect(findUnawaitedCalls('a.ts', "import { limit as take } from '@/lib/rate-limit-async'\nexport function f(limit: number) {\n  return limit\n}\n")).toEqual([])
    })
  })

  it('catches a returned promise, an alias and a namespace import', () => {
    expect(findUnawaitedCalls('a.ts', `${IMPORT}export const f = (r: Request) => rateLimit(r, 'x', { limit: 1, windowMs: 1 })\n`)).toHaveLength(1)
    expect(findUnawaitedCalls('a.ts', "import { limit as take } from '@/lib/rate-limit-async'\nexport const f = () => take('k', { limit: 1, windowMs: 1 })\n")).toHaveLength(1)
    expect(findUnawaitedCalls('a.ts', "import * as rl from './rate-limit-async'\nexport const f = () => rl.limit('k', { limit: 1, windowMs: 1 })\n")).toHaveLength(1)
  })

  it('catches an awaited call whose result is thrown away', () => {
    const src = `${IMPORT}export async function f(req: Request) {\n  await rateLimit(req, 'x', { limit: 1, windowMs: 1 })\n}\n`
    expect(findUnawaitedCalls('a.ts', src)).toEqual(['a.ts:3 the result of rateLimit() is discarded'])
    expect(findUnawaitedCalls('a.ts', `${IMPORT}export async function f() {\n  await (limit('k', { limit: 1, windowMs: 1 }))\n}\n`)).toEqual(["a.ts:3 the result of limit() is discarded"])
  })

  it('catches a re-export and a dynamic import', () => {
    expect(findUnawaitedCalls('a.ts', "export { rateLimit } from '@/lib/rate-limit-async'\n")).toHaveLength(1)
    expect(findUnawaitedCalls('a.ts', "export const m = () => import('@/lib/rate-limit-async')\n")).toHaveLength(1)
  })

  it('ignores a same-named function from elsewhere, and the sync limiter', () => {
    expect(findUnawaitedCalls('a.ts', "import { limit } from './other'\nexport const a = limit(1)\n")).toEqual([])
    expect(findUnawaitedCalls('a.ts', "import { checkRateLimit } from '@/lib/rate-limit'\nexport const a = checkRateLimit('k', { limit: 1, windowMs: 1 })\n")).toEqual([])
  })
})
