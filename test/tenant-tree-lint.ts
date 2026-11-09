import ts from 'typescript'

// The static half of the tenant tree's rule (S5, B5b): a page in app/%5Ft takes its
// tenant from its URL param and checks its record is that tenant's, and nothing it
// imports decides the tenant from the request. test/tenant-tree-pages.test.ts runs
// these over the real tree.

const REQUEST_TENANT = '@/lib/tenancy/request-tenant'
const TENANT_RECORDS = '@/lib/tenancy/tenant-records'

const parse = (file: string, src: string) => ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node)
  ts.forEachChild(node, (child) => walk(child, visit))
}

/** Local name to module, for every name a file imports. */
function importedNames(sf: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>()
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
    const clause = stmt.importClause
    if (!clause || clause.isTypeOnly) continue
    const from = stmt.moduleSpecifier.text
    if (clause.name) out.set(clause.name.text, from)
    const named = clause.namedBindings
    if (named && ts.isNamespaceImport(named)) out.set(named.name.text, from)
    if (named && ts.isNamedImports(named)) for (const el of named.elements) if (!el.isTypeOnly) out.set(el.name.text, from)
  }
  return out
}

function defaultExport(sf: ts.SourceFile): ts.FunctionDeclaration | { problem: string } {
  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier) return { problem: 'a bare re-export: it never reads params.tenant' }
  }
  const named = new Map<string, ts.FunctionDeclaration>()
  for (const stmt of sf.statements) if (ts.isFunctionDeclaration(stmt) && stmt.name) named.set(stmt.name.text, stmt)
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) return stmt
    if (ts.isExportAssignment(stmt)) {
      const local = ts.isIdentifier(stmt.expression) ? named.get(stmt.expression.text) : undefined
      return local ?? { problem: 'a bare re-export: its default export is not a function of its own' }
    }
  }
  return { problem: 'no default export' }
}

const isAwaited = (node: ts.Node) => ts.isAwaitExpression(node.parent)

/**
 * Whether an awaited check always runs and always answers: part of a plain statement of
 * the page function. notFound() works by throwing, so inside a try it can be swallowed,
 * and inside an if or a nested function it might never run.
 */
function runsUnconditionally(call: ts.Node, fn: ts.FunctionDeclaration): boolean {
  for (let at = call.parent; at; at = at.parent) {
    if ((ts.isExpressionStatement(at) || ts.isVariableStatement(at)) && at.parent === fn.body) return true
    const plain =
      ts.isAwaitExpression(at) ||
      ts.isCallExpression(at) ||
      ts.isParenthesizedExpression(at) ||
      ts.isVariableDeclaration(at) ||
      ts.isVariableDeclarationList(at)
    if (!plain) return false
  }
  return false
}

/** Each route param the page destructures from `await params`, by its local name. */
function paramLocals(fn: ts.FunctionDeclaration): Map<string, string> {
  const out = new Map<string, string>()
  for (const stmt of fn.body?.statements ?? []) {
    if (!ts.isVariableStatement(stmt)) continue
    for (const decl of stmt.declarationList.declarations) {
      const init = decl.initializer
      if (!ts.isObjectBindingPattern(decl.name) || !init || !ts.isAwaitExpression(init) || !ts.isIdentifier(init.expression) || init.expression.text !== 'params') continue
      for (const el of decl.name.elements) {
        const param = (el.propertyName ?? el.name) as ts.Identifier
        if (ts.isIdentifier(el.name)) out.set(param.text, el.name.text)
      }
    }
  }
  return out
}

/** The route's own params, from the page's path. The tenant has its own check. */
const routeParams = (file: string) => [...file.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]).filter((p) => p !== 'tenant')

/**
 * What is wrong with a tenant-tree page, if anything. `recordless` means the page reads
 * no record of its own (the caller holds the list, with reasons), so it needs only the
 * tenant check.
 */
export function pageProblems(file: string, src: string, opts: { recordless?: boolean } = {}): string[] {
  const sf = parse(file, src)
  const imports = importedNames(sf)
  const fn = defaultExport(sf)
  if ('problem' in fn) return [fn.problem]

  const out: string[] = []
  if (!/export const dynamic = 'force-dynamic'/.test(src) && !opts.recordless) out.push("missing dynamic = 'force-dynamic': a record check may not be cached")

  let tenantCall: ts.CallExpression | null = null
  let recordCall: ts.CallExpression | null = null
  let firstRender = Infinity
  let tenantVar: string | null = null

  walk(fn, (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const from = imports.get(node.expression.text)
      if (from === REQUEST_TENANT && node.expression.text === 'tenantFromParams' && !tenantCall) tenantCall = node
      if (from === TENANT_RECORDS && !recordCall) recordCall = node
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) firstRender = Math.min(firstRender, node.getStart())
    if (ts.isIdentifier(node) && imports.get(node.text)?.startsWith('@/app/(stellr)/(flow)/')) firstRender = Math.min(firstRender, node.getStart())
  })

  if (!tenantCall) return [...out, 'never calls tenantFromParams(params)']
  const tenant = tenantCall as ts.CallExpression
  const arg = tenant.arguments[0]
  if (!arg || !ts.isIdentifier(arg) || arg.text !== 'params') out.push('tenantFromParams must take the page params, nothing else')
  if (!isAwaited(tenant)) out.push('tenantFromParams is not awaited, so its 404 never fires')
  else if (!runsUnconditionally(tenant, fn)) out.push('tenantFromParams must be a plain statement of the page function, or its 404 can be skipped or swallowed')
  if (tenant.getStart() > firstRender) out.push('renders before tenantFromParams')
  const holder = tenant.parent.parent
  if (ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name)) tenantVar = holder.name.text

  if (opts.recordless) return out

  if (!recordCall) return [...out, `never calls a loader from ${TENANT_RECORDS}, so another tenant's record would render`]
  const record = recordCall as ts.CallExpression
  const first = record.arguments[0]
  if (!tenantVar || !first || !ts.isIdentifier(first) || first.text !== tenantVar) out.push('the record loader must take the tenant from tenantFromParams as its first argument')
  if (!isAwaited(record)) out.push('the record loader is not awaited, so its 404 never fires')
  else if (!runsUnconditionally(record, fn)) out.push('the record loader must be a plain statement of the page function, or its 404 can be skipped or swallowed')
  if (record.getStart() > firstRender) out.push('renders before its record check')

  // The check must be about the record this URL names: the route's own params, all of
  // them, and nothing else. A check on some other record would always pass.
  const locals = paramLocals(fn)
  const passed = record.arguments.slice(1).map((a) => (ts.isIdentifier(a) ? a.text : null))
  for (const param of routeParams(file)) {
    const local = locals.get(param)
    if (!local) out.push(`the page must destructure ${param} from await params`)
    else if (!passed.includes(local)) out.push(`the record loader must take ${param} from the page params`)
  }
  if (passed.some((name) => !name || ![...locals.values()].includes(name))) out.push('the record loader may take only the page params after the tenant')
  return out
}

function enclosingName(node: ts.Node): string {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if ((ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at)) && at.name && ts.isIdentifier(at.name)) return at.name.text
    if ((ts.isArrowFunction(at) || ts.isFunctionExpression(at)) && ts.isVariableDeclaration(at.parent) && ts.isIdentifier(at.parent.name)) return at.parent.name.text
    if (ts.isFunctionDeclaration(at)) return 'default'
  }
  return 'module'
}

const HOST_HEADERS = /^(host|x-forwarded-host|:authority|x-stellr-tenant-id|x-stellr-tenant-slug)$/i
const TENANT_HEADER_NAMES = new Set(['TENANT_ID_HEADER', 'TENANT_SLUG_HEADER'])
/** Where the two constants live, and the requestTenant() that reads them for app/api. */
const TENANT_HEADER_HOMES = new Set(['lib/tenancy/host.ts', 'lib/tenancy/request-tenant.ts'])

export interface RequestReads {
  /** `file#function:headers` or `file#function:cookies`, one per function. */
  calls: string[]
  /** Reads that can only be deciding the tenant. None of these may exist. */
  banned: string[]
}

/** Where a file reads the request, by name. A comment or a type-only import isn't a read. */
export function requestReads(file: string, src: string): RequestReads {
  const sf = parse(file, src)
  const local = new Map<string, 'headers' | 'cookies' | 'namespace'>()
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier) || stmt.moduleSpecifier.text !== 'next/headers') continue
    const clause = stmt.importClause
    if (!clause || clause.isTypeOnly) continue
    const named = clause.namedBindings
    if (named && ts.isNamespaceImport(named)) local.set(named.name.text, 'namespace')
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        const name = (el.propertyName ?? el.name).text
        if (!el.isTypeOnly && (name === 'headers' || name === 'cookies')) local.set(el.name.text, name)
      }
    }
  }

  const calls = new Set<string>()
  const banned = new Set<string>()
  const isImportBinding = (node: ts.Node) => ts.isImportSpecifier(node.parent) || ts.isNamespaceImport(node.parent) || ts.isImportClause(node.parent)
  walk(sf, (node) => {
    if (ts.isIdentifier(node) && !isImportBinding(node)) {
      const kind = local.get(node.text)
      if (kind === 'headers' || kind === 'cookies') calls.add(`${file}#${enclosingName(node)}:${kind}`)
      if (kind === 'namespace' && ts.isPropertyAccessExpression(node.parent)) {
        const prop = node.parent.name.text
        if (prop === 'headers' || prop === 'cookies') calls.add(`${file}#${enclosingName(node)}:${prop}`)
      }
      if (TENANT_HEADER_NAMES.has(node.text) && !TENANT_HEADER_HOMES.has(file)) banned.add(`${file}: names ${node.text}`)
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const firstArg = node.arguments[0]
      if ((callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require')) && firstArg && ts.isStringLiteralLike(firstArg) && firstArg.text === 'next/headers') {
        banned.add(`${file}: loads next/headers dynamically, which this check can't follow`)
      }
      if (ts.isIdentifier(callee) && callee.text === 'requestTenant') banned.add(`${file}: calls requestTenant(), which is for app/api only`)
      if (ts.isPropertyAccessExpression(callee) && ['get', 'has'].includes(callee.name.text) && firstArg && ts.isStringLiteralLike(firstArg) && HOST_HEADERS.test(firstArg.text)) {
        banned.add(`${file}: reads the ${firstArg.text} header`)
      }
    }
  })
  return { calls: [...calls].sort(), banned: [...banned].sort() }
}
