// Authz codemod (docs/TENANCY-S5.md, C10). The conversion slices (C13 to C23) run it,
// one feature area per PR. It moves the legacy guards in scripts/authz-idioms.mjs onto
// lib/authz by swapping the predicate only: every if-branch and deny response keeps its
// bytes. authz.equivalence.test.ts runs each conversion over the whole role truth table.
//
//   T1  isAdminClaims(claims), hasAdminPortalAccess(claims) and the inline role read
//       compared to 'admin' become `await isStellrAdmin()` or `await hasPortalAccess()`
//   T2  currentUserIsAdmin() and currentUserHasScope(s) become isStellrAdmin(), hasScope(s)
//   T3  a same-file helper that only wraps one of those is inlined and deleted
//   T4  requireAdminPage() becomes authz.page.requireAdmin(). The ratchet keeps counting
//       it: moving a page on to an adapter that confines an event manager is a decision
//       about who may see the page, so a person makes it
//   T5  requireEventAccess moves to lib/authz, when the answer is only read field by field.
//       A section-level call whose isAdmin or assignedSlugs is read stays, and the ratchet
//       keeps counting it: under lib/authz those answers hold for one tenant only, so what
//       it loads by id has to move to accessCoversEvent or loadScoped (docs/AUTHZ.md, item 12)
//   T6  the domain wrappers are T1 and T2 on their own files, so run --file on those.
//       HELD_WRAPPERS names one that waits for a decision
//   T7  test mocks of lib/admin-auth and lib/event-access move to lib/authz, once nothing
//       the test still loads for real reads the legacy module
//
// It rewrites only what it can prove from the file. Anything else is reported as MANUAL
// and left as it was, and --check fails on it. Built on the TypeScript compiler API, as
// scripts/codemods/events-facade.ts is, and edits text at each node's position. A second
// run changes nothing.
//
// Usage:
//   npx tsx scripts/codemods/authz.ts --area 'app/api/admin/community/**'     what would change
//   npx tsx scripts/codemods/authz.ts --area 'app/api/admin/community/**' --write
//   npx tsx scripts/codemods/authz.ts --file lib/store/auth.ts [--write]
//   npx tsx scripts/codemods/authz.ts --all     report on the whole tree; never writes
//   --check   exit 1 when a selected file holds a MANUAL site
//
// After --write, run the conversion's own route tests and regenerate both baselines (AFTER_WRITE).
// Expect one kind of failure there: a route test whose Clerk mock gives admin claims with no
// userId, or has no `auth` export, answers 403 after conversion, because lib/authz refuses
// claims with no user. Real Clerk never sends those. Give the fixture a real userId, and do
// not loosen lib/authz to pass it.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { fileModule, resolveModule } from '../../lib/security/route-ast'
import { LEGACY_IDIOMS, measureIdioms, totalsOf } from '../authz-idioms.mjs'
import { collectSources, isTestFile, parse } from '../s5-inventory.mjs'

const AUTHZ = 'lib/authz'
const ADMIN_AUTH = 'lib/admin-auth'
const EVENT_ACCESS = 'lib/event-access'
const CLERK = '@clerk/nextjs/server'

export type TransformId = 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7'

/**
 * What this tool does with each idiom in LEGACY_IDIOMS. A test keeps the two lists the
 * same. `why` is what a person reads for a site the tool leaves.
 */
export const DISPOSITIONS: Record<string, { transform: TransformId | null; why: string }> = {
  isAdminClaims: { transform: 'T1', why: 'not called on the session claims of an `await auth()` in the same async function' },
  currentUserIsAdmin: { transform: 'T2', why: 'not a plain awaited call' },
  requireAdminPage: { transform: 'T4', why: 'not a plain awaited call' },
  pageRequireAdmin: { transform: null, why: 'the T4 swap target. Choose requireStellrAdmin, requireTenantAdmin or requireEventSection by hand: each confines someone it lets in today' },
  clerkRoleRead: { transform: 'T1', why: 'only a session-claims role compared to admin converts. A publicMetadata read is a different source (live, not the session), and a read about another user or for the event_manager value has no one-for-one call' },
  requireEventAccess: { transform: 'T5', why: 'not `const x = await requireEventAccess(…)` read field by field, or a section-level answer whose isAdmin or assignedSlugs is trusted' },
  requireScholarshipAdmin: { transform: 'T6', why: 'converted in its definition' },
  requireSurveyAdmin: { transform: 'T6', why: 'converted in its definition' },
  canManageStoreCatalog: { transform: 'T6', why: 'converted in its definition, once HELD_WRAPPERS lets it' },
  adminName: { transform: 'T6', why: 'converted in its definition' },
  hasAdminPortalAccess: { transform: 'T1', why: 'not called on the session claims of an `await auth()` in the same async function' },
  isEventManagerClaims: { transform: null, why: 'lib/authz has no claim-only form. requireEventAccess also reads assignments, and can throw' },
  currentUserHasScope: { transform: 'T2', why: 'not a plain awaited call' },
  isStaffRole: { transform: null, why: 'isStaffTarget is async and needs the target\'s ids, which the role alone does not give. A person also picks what a lookup failure refuses' },
  STAFF_CLERK_ROLES: { transform: null, why: 'a role list, with no call to swap it for' },
  portalRoleList: { transform: null, why: 'a role list, with no call to swap it for' },
  roleTableRead: { transform: null, why: 'a database read. Whether it decides access or lists an audience is a person\'s call' },
}

/**
 * Where a conversion is allowed. docs/AUTHZ.md: decide on sampling before a call site that
 * serves ordinary members moves to lib/authz, because shadow reads are not sampled. The
 * rest of the app (proxy.ts must stay database-free, a client component cannot import
 * lib/authz, and lib/ helpers can serve members) is left for a person.
 */
const IDIOMS = LEGACY_IDIOMS as { id: string; kind: string; file?: string }[]
const WRAPPER_FILES = IDIOMS.filter((i) => i.kind === 'wrapper').map((i) => i.file)

/**
 * Wrappers that also serve people who are not staff, so the surface rule above applies to
 * them too. Take an entry off only once the sampling decision is recorded.
 */
export const HELD_WRAPPERS: Readonly<Record<string, string>> = {
  'lib/store/auth.ts': 'app/api/store/returns/route.ts calls this for any signed-in member, and docs/AUTHZ.md asks for a sampling decision before a call site serving members moves (shadow reads)',
}

export function isAdminSurface(file: string): boolean {
  if (file in HELD_WRAPPERS) return false
  return /^app\/api\/admin\//.test(file) || /^app\/\(stellr\)\/\(admin\)\//.test(file) || WRAPPER_FILES.includes(file)
}

/** What to do after --write. A conversion moves both counts. */
export const AFTER_WRITE = 'Now regenerate the baselines: npx tsx scripts/authz-idioms.mjs --write, then npx tsx scripts/s5-inventory.mjs --write'

const OUTSIDE_SURFACE = 'outside the admin surface: this code can serve people who are not staff, so a person moves it (docs/AUTHZ.md, shadow reads)'
const CLIENT_FILE = 'a client component: lib/authz is server-only'

export interface Conversion {
  idiom: string
  transform: TransformId
  line: number
}

export interface Manual {
  idiom: string
  why: string
  line?: number
}

export interface Transform {
  /** The file's new source; the same string when nothing moved. */
  src: string
  converted: Conversion[]
  /** Sites left as they were. Each needs a person. */
  manual: Manual[]
}

/** The route pattern a shadow mismatch names, for a route or page file. Never a concrete path. */
export function routeOf(file: string): string | null {
  const m = /^app\/(.+)\/(route|page)\.[jt]sx?$/.exec(file)
  if (!m) return null
  return `/${m[1].split('/').filter((s) => !/^\(.*\)$/.test(s)).join('/')}`
}

// ── Reading the tree ─────────────────────────────────────────────────────────

function strip(e: ts.Expression): ts.Expression {
  let x = e
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x) || ts.isSatisfiesExpression(x)) x = x.expression
  return x
}

const enclosingFn = (n: ts.Node): ts.SignatureDeclaration | null => {
  for (let p = n.parent; p; p = p.parent) if (ts.isFunctionLike(p)) return p
  return null
}

const isAsyncFn = (fn: ts.SignatureDeclaration | null) =>
  !!fn && ts.canHaveModifiers(fn) && !!ts.getModifiers(fn)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)

/** The element or declaration that binds `name` in this binding name, if any. */
function matchBinding(name: ts.BindingName, text: string): ts.Node | null {
  if (ts.isIdentifier(name)) return name.text === text ? name.parent : null
  for (const el of name.elements) {
    if (ts.isOmittedExpression(el)) continue
    const hit = matchBinding(el.name, text)
    if (hit) return hit
  }
  return null
}

function declaredIn(statements: readonly ts.Statement[], text: string): ts.Node | null {
  for (const s of statements) {
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        const hit = matchBinding(d.name, text)
        if (hit) return hit
      }
    }
    if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.name?.text === text) return s
    if (ts.isImportDeclaration(s) && s.importClause) {
      const c = s.importClause
      if (c.name?.text === text) return c
      const nb = c.namedBindings
      if (nb && ts.isNamespaceImport(nb) && nb.name.text === text) return nb
      if (nb && ts.isNamedImports(nb)) {
        const el = nb.elements.find((e) => e.name.text === text)
        if (el) return el
      }
    }
  }
  return null
}

/** What this name means where it stands: the nearest scope wins, so a shadowing local is not the import. */
function declarationOf(id: ts.Identifier): ts.Node | null {
  for (let n: ts.Node | undefined = id.parent; n; n = n.parent) {
    if (ts.isFunctionLike(n)) {
      for (const p of n.parameters) {
        const hit = matchBinding(p.name, id.text)
        if (hit) return hit
      }
      if (ts.isFunctionExpression(n) && n.name?.text === id.text) return n
    }
    if (ts.isBlock(n) || ts.isSourceFile(n) || ts.isModuleBlock(n)) {
      const hit = declaredIn(n.statements, id.text)
      if (hit) return hit
    }
    if (ts.isCaseBlock(n)) {
      for (const clause of n.clauses) {
        const hit = declaredIn(clause.statements, id.text)
        if (hit) return hit
      }
    }
    if ((ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n)) && n.initializer && ts.isVariableDeclarationList(n.initializer)) {
      for (const d of n.initializer.declarations) {
        const hit = matchBinding(d.name, id.text)
        if (hit) return hit
      }
    }
    if (ts.isCatchClause(n) && n.variableDeclaration) {
      const hit = matchBinding(n.variableDeclaration.name, id.text)
      if (hit) return hit
    }
  }
  return null
}

/** A use of the name, not a key, a member name or the declaration itself. */
function isReference(id: ts.Identifier): boolean {
  const p = id.parent
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false
  if (ts.isQualifiedName(p) && p.right === id) return false
  if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isJsxAttribute(p)) && p.name === id) return false
  if (ts.isBindingElement(p) && (p.name === id || p.propertyName === id)) return false
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p)) && p.name === id) return false
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return false
  if (ts.isExportSpecifier(p) && p.propertyName && p.name === id) return false
  return true
}

function eachNode(n: ts.Node, visit: (x: ts.Node) => void): void {
  visit(n)
  ts.forEachChild(n, (c) => eachNode(c, visit))
}

/** Every use of what `decl` declares under `name`. */
function refsTo(decl: ts.Node, name: string, within: ts.Node): ts.Identifier[] {
  const out: ts.Identifier[] = []
  eachNode(within, (x) => {
    if (ts.isIdentifier(x) && x.text === name && isReference(x) && declarationOf(x) === decl) out.push(x)
  })
  return out
}

function importedName(id: ts.Identifier, file: string, modules: readonly string[]): string | null {
  const decl = declarationOf(id)
  if (!decl || !ts.isImportSpecifier(decl)) return null
  const stmt = decl.parent.parent.parent
  if (!ts.isStringLiteral(stmt.moduleSpecifier) || !modules.includes(resolveModule(file, stmt.moduleSpecifier.text))) return null
  return (decl.propertyName ?? decl.name).text
}

/** Why these claims cannot be replaced by a fresh authz call here; null when they can. */
function claimsProblem(file: string, e: ts.Expression, at: ts.Node): string | null {
  const NOT_AUTH = 'these claims do not come from `const { sessionClaims } = await auth()`, so the answer may be about someone else'
  const id = strip(e)
  if (!ts.isIdentifier(id)) return NOT_AUTH
  const el = declarationOf(id)
  if (!el || !ts.isBindingElement(el) || !ts.isIdentifier(el.name)) return NOT_AUTH
  if ((el.propertyName ?? el.name).getText() !== 'sessionClaims') return NOT_AUTH
  const pattern = el.parent
  if (!ts.isObjectBindingPattern(pattern) || pattern.elements.some((x) => x.dotDotDotToken)) return NOT_AUTH
  const decl = pattern.parent
  if (!ts.isVariableDeclaration(decl) || !(decl.parent.flags & ts.NodeFlags.Const)) return NOT_AUTH
  const init = decl.initializer && strip(decl.initializer)
  if (!init || !ts.isAwaitExpression(init)) return NOT_AUTH
  const call = strip(init.expression)
  if (!ts.isCallExpression(call) || call.arguments.length || !ts.isIdentifier(call.expression)) return NOT_AUTH
  if (importedName(call.expression, file, [CLERK]) !== 'auth') return NOT_AUTH
  if (enclosingFn(decl) !== enclosingFn(at)) return 'read inside a nested function, where an added await changes when the check runs'
  if (!isAsyncFn(enclosingFn(at))) return 'in a function that is not async, so it cannot await lib/authz'
  return null
}

/** `(c?.metadata as …)?.role`: the expression `c`, or null. */
function roleReadRoot(e: ts.Expression): ts.Expression | null {
  const read = strip(e)
  if (!ts.isPropertyAccessExpression(read) || read.name.text !== 'role') return null
  const meta = strip(read.expression)
  if (!ts.isPropertyAccessExpression(meta) || meta.name.text !== 'metadata') return null
  return meta.expression
}

/** `x === 'admin'` or `x !== 'admin'`: the other side and which way round. */
function comparedToAdmin(n: ts.Node): { side: ts.Expression; negated: boolean } | null {
  if (!ts.isBinaryExpression(n)) return null
  const op = n.operatorToken.kind
  if (op !== ts.SyntaxKind.EqualsEqualsEqualsToken && op !== ts.SyntaxKind.ExclamationEqualsEqualsToken) return null
  const negated = op === ts.SyntaxKind.ExclamationEqualsEqualsToken
  if (ts.isStringLiteralLike(n.right) && n.right.text === 'admin') return { side: n.left, negated }
  if (ts.isStringLiteralLike(n.left) && n.left.text === 'admin') return { side: n.right, negated }
  return null
}

/** The declaration of `const role = <claims>.metadata.role`, when `side` is that local. */
function localRoleRead(side: ts.Expression): ts.VariableDeclaration | null {
  const id = strip(side)
  if (!ts.isIdentifier(id)) return null
  const decl = declarationOf(id)
  if (!decl || !ts.isVariableDeclaration(decl) || !ts.isIdentifier(decl.name) || !decl.initializer) return null
  if (!(decl.parent.flags & ts.NodeFlags.Const) || !roleReadRoot(decl.initializer)) return null
  return decl
}

// ── Editing ──────────────────────────────────────────────────────────────────

interface Edit {
  start: number
  end: number
  text: string
}

function applyEdits(src: string, edits: Edit[]): string {
  let out = src
  // At one position the removal goes first, then what is inserted there.
  for (const e of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return out
}

/** The range of a whole statement with its line, when nothing else shares the line. */
function lineRange(src: string, start: number, end: number): { start: number; end: number } {
  let s = start
  while (s > 0 && (src[s - 1] === ' ' || src[s - 1] === '\t')) s -= 1
  if (s > 0 && src[s - 1] !== '\n') s = start
  let e = end
  while (src[e] === ' ' || src[e] === '\t' || src[e] === ';') e += 1
  if (src[e] === '\r') e += 1
  if (src[e] === '\n') e += 1
  else e = end
  return { start: s, end: e }
}

/** A deleted helper takes the comment directly above it and one blank line after. */
function helperRange(src: string, sf: ts.SourceFile, fn: ts.Node): { start: number; end: number } {
  const r = lineRange(src, fn.getStart(sf), fn.getEnd())
  let start = r.start
  const comments = ts.getLeadingCommentRanges(src, fn.getFullStart()) ?? []
  for (const c of [...comments].reverse()) {
    if (src.slice(c.end, start).trim() !== '' || (src.slice(c.end, start).match(/\n/g) ?? []).length > 1) break
    start = lineRange(src, c.pos, c.end).start
  }
  let end = r.end
  if (src[end] === '\n') end += 1
  else if (src.startsWith('\r\n', end)) end += 2
  return { start, end }
}

// ── T1 to T5 on one file ─────────────────────────────────────────────────────

/** The name lib/authz gives each predicate over the session claims. */
const CLAIM_PREDICATES: Record<string, string> = { isAdminClaims: 'isStellrAdmin', hasAdminPortalAccess: 'hasPortalAccess' }

/** The answer's fields both lib/event-access and lib/authz return. lib/authz adds tenantId, so a whole value is not the same value. */
const EVENT_ACCESS_FIELDS = new Set(['ok', 'status', 'userId', 'isAdmin', 'assignedSlugs'])

/** In lib/event-access these mean every event. In lib/authz, every event of one tenant. */
const TENANT_BOUND_FIELDS = new Set(['isAdmin', 'assignedSlugs'])

/**
 * The call may carry no slug: no argument, or one that can come out undefined. Then no
 * event's tenant decided the answer, and the call does not say which rows it covers.
 */
function maybeSectionLevel(call: ts.CallExpression): boolean {
  const arg = call.arguments[0]
  if (!arg) return true
  let unsure = false
  eachNode(arg, (x) => {
    if ((ts.isIdentifier(x) && x.text === 'undefined') || x.kind === ts.SyntaxKind.QuestionDotToken) unsure = true
  })
  const id = strip(arg)
  const decl = ts.isIdentifier(id) ? declarationOf(id) : null
  return unsure || (!!decl && ts.isParameter(decl) && !!decl.questionToken)
}

/** Fields, or the reason it cannot be sure. */
function eventAccessProblem(call: ts.CallExpression): string | null {
  const WHOLE = 'the answer is passed on whole, and lib/authz adds tenantId to it: check where it goes'
  const SECTION = 'a section-level answer: under lib/authz isAdmin and assignedSlugs cover every event of the current tenant, not every event. Move what this loads by id or lists across events to accessCoversEvent or loadScoped by hand (docs/AUTHZ.md, item 12)'
  if (call.arguments.length > 1) return 'called with options already'
  const awaited = call.parent
  if (!ts.isAwaitExpression(awaited)) return 'the promise is not awaited here, and lib/authz counts a check only when it is'
  const decl = awaited.parent
  if (!ts.isVariableDeclaration(decl) || !ts.isIdentifier(decl.name) || !(decl.parent.flags & ts.NodeFlags.Const)) return WHOLE
  const fn = enclosingFn(decl) ?? decl.getSourceFile()
  const refs = refsTo(decl, decl.name.text, fn)
  if (!refs.length) return 'the answer is never read, and lib/authz counts a check only when it is'
  for (const r of refs) {
    if (!ts.isPropertyAccessExpression(r.parent) || r.parent.expression !== r || !EVENT_ACCESS_FIELDS.has(r.parent.name.text)) return WHOLE
  }
  const trusted = refs.some((r) => TENANT_BOUND_FIELDS.has((r.parent as ts.PropertyAccessExpression).name.text))
  return trusted && maybeSectionLevel(call) ? SECTION : null
}

/** Quote and semicolon style, from the file's first import. */
function styleOf(sf: ts.SourceFile): { q: string; semi: string } {
  const first = sf.statements.find(ts.isImportDeclaration)
  if (!first) return { q: "'", semi: '' }
  return { q: first.moduleSpecifier.getText(sf).charAt(0), semi: first.getText(sf).endsWith(';') ? ';' : '' }
}

/** Every name the file declares, except what it already takes from lib/authz. */
function takenNames(file: string, sf: ts.SourceFile): Set<string> {
  const taken = new Set<string>()
  const addBinding = (name: ts.BindingName) => {
    if (ts.isIdentifier(name)) taken.add(name.text)
    else for (const el of name.elements) if (!ts.isOmittedExpression(el)) addBinding(el.name)
  }
  eachNode(sf, (n) => {
    if (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n)) addBinding(n.name)
    if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isFunctionExpression(n)) && n.name) taken.add(n.name.text)
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && resolveModule(file, n.moduleSpecifier.text) !== AUTHZ && n.importClause) {
      const c = n.importClause
      if (c.name) taken.add(c.name.text)
      const nb = c.namedBindings
      if (nb && ts.isNamespaceImport(nb)) taken.add(nb.name.text)
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) taken.add(el.name.text)
    }
  })
  return taken
}

/** The body of a helper that only answers a predicate over its claims: which predicate, or null. */
function helperPredicate(file: string, statements: readonly ts.Statement[], claimsOk: (e: ts.Expression) => boolean): string | null {
  const last = statements[statements.length - 1]
  if (!last || !ts.isReturnStatement(last) || !last.expression) return null
  // Anything else before the return would be lost with the helper.
  const onlyRead = (s: ts.Statement) => {
    if (!ts.isVariableStatement(s) || s.declarationList.declarations.length !== 1) return false
    const init = s.declarationList.declarations[0].initializer
    if (!init) return false
    if (roleReadRoot(init)) return true
    const a = strip(init)
    const c = ts.isAwaitExpression(a) ? strip(a.expression) : null
    return !!c && ts.isCallExpression(c) && ts.isIdentifier(c.expression) && importedName(c.expression, file, [CLERK]) === 'auth'
  }
  if (!statements.slice(0, -1).every(onlyRead)) return null
  const e = strip(last.expression)
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.arguments.length === 1) {
    const name = importedName(e.expression, file, [ADMIN_AUTH])
    if (name && CLAIM_PREDICATES[name] && claimsOk(e.arguments[0])) return CLAIM_PREDICATES[name]
    return null
  }
  const cmp = comparedToAdmin(e)
  if (!cmp || cmp.negated) return null
  const direct = roleReadRoot(cmp.side)
  if (direct) return claimsOk(direct) ? 'isStellrAdmin' : null
  const local = localRoleRead(cmp.side)
  const root = local?.initializer && roleReadRoot(local.initializer)
  return root && claimsOk(root) ? 'isStellrAdmin' : null
}

interface Helper {
  fn: ts.FunctionDeclaration
  name: string
  predicate: string
  kind: 'no_args' | 'claims_arg'
  idiom: string
}

/** Same-file helpers T3 can inline. A helper it cannot is left, and T1 converts what is inside. */
function inlinableHelpers(file: string, sf: ts.SourceFile, taken: Set<string>): Map<ts.Node, Helper> {
  const out = new Map<ts.Node, Helper>()
  for (const s of sf.statements) {
    if (!ts.isFunctionDeclaration(s) || !s.name || !s.body) continue
    if (s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue
    const name = s.name.text
    const refs = refsTo(s, name, sf)
    if (!refs.length) continue
    const idiom = /isAdminClaims|hasAdminPortalAccess/.test(s.body.getText(sf)) ? 'isAdminClaims' : 'clerkRoleRead'
    if (s.parameters.length === 0 && isAsyncFn(s)) {
      const statements = s.body.statements
      const first = statements[0]
      if (!first || !ts.isVariableStatement(first)) continue
      const pattern = first.declarationList.declarations[0]?.name
      if (!pattern || !ts.isObjectBindingPattern(pattern) || pattern.elements.length !== 1) continue
      const predicate = helperPredicate(file, statements, (e) => claimsProblem(file, e, statements[statements.length - 1]) === null)
      if (!predicate || taken.has(predicate)) continue
      const onlyAwaited = refs.every((r) => {
        const call = r.parent
        return ts.isCallExpression(call) && call.expression === r && call.arguments.length === 0 && ts.isAwaitExpression(call.parent)
      })
      if (onlyAwaited) out.set(s, { fn: s, name, predicate, kind: 'no_args', idiom })
    } else if (s.parameters.length === 1 && !isAsyncFn(s) && ts.isIdentifier(s.parameters[0].name)) {
      const param = s.parameters[0].name
      const paramDecl = s.parameters[0]
      const claimsOk = (e: ts.Expression) => {
        const id = strip(e)
        return ts.isIdentifier(id) && id.text === param.text && declarationOf(id) === paramDecl
      }
      const predicate = helperPredicate(file, s.body.statements, claimsOk)
      if (!predicate || taken.has(predicate)) continue
      const callersOk = refs.every((r) => {
        const call = r.parent
        return ts.isCallExpression(call) && call.expression === r && call.arguments.length === 1 && claimsProblem(file, call.arguments[0], call) === null
      })
      if (callersOk) out.set(s, { fn: s, name, predicate, kind: 'claims_arg', idiom })
    }
  }
  return out
}

/** `await x`, in parentheses where the parent needs them. */
function awaited(node: ts.Node, call: string): string {
  const p = node.parent
  const bare =
    ts.isVariableDeclaration(p) ||
    ts.isReturnStatement(p) ||
    ts.isExpressionStatement(p) ||
    ts.isParenthesizedExpression(p) ||
    (ts.isIfStatement(p) && p.expression === node) ||
    (ts.isBinaryExpression(p) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(p.operatorToken.kind))
  return bare ? `await ${call}` : `(await ${call})`
}

function convertSites(file: string, src: string): Omit<Transform, 'manual'> & { manual: Manual[] } {
  const sf = parse(file, src) as ts.SourceFile
  const { q, semi } = styleOf(sf)
  const route = routeOf(file)
  const opts = route ? `{ route: ${q}${route}${q} }` : ''
  const taken = takenNames(file, sf)
  const edits: Edit[] = []
  const converted: Conversion[] = []
  const manual: Manual[] = []
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const need = new Set<string>()
  const replace = (n: ts.Node, text: string) => edits.push({ start: n.getStart(sf), end: n.getEnd(), text })
  const free = (name: string, idiom: string, at: ts.Node) => {
    if (!taken.has(name)) return true
    manual.push({ idiom, line: line(at), why: `this file already declares ${name}` })
    return false
  }

  const helpers = inlinableHelpers(file, sf, taken)
  const helperByDecl = (id: ts.Identifier) => helpers.get(declarationOf(id) as ts.Node)
  for (const h of helpers.values()) {
    const r = helperRange(src, sf, h.fn)
    edits.push({ ...r, text: '' })
  }

  // T5 is all or nothing per file: the import moves, or it does not.
  const eventCalls: ts.CallExpression[] = []
  let eventProblem = false
  eachNode(sf, (n) => {
    if (!ts.isIdentifier(n) || !isReference(n) || importedName(n, file, [EVENT_ACCESS]) !== 'requireEventAccess') return
    const call = n.parent
    const problem = ts.isCallExpression(call) && call.expression === n ? eventAccessProblem(call) : 'not a plain call'
    if (problem) {
      eventProblem = true
      manual.push({ idiom: 'requireEventAccess', line: line(n), why: problem })
    } else {
      eventCalls.push(call as ts.CallExpression)
    }
  })
  if (!eventProblem) {
    for (const call of eventCalls) {
      converted.push({ idiom: 'requireEventAccess', transform: 'T5', line: line(call) })
      if (opts) {
        const arg = call.arguments[0]
        edits.push(arg ? { start: arg.getEnd(), end: arg.getEnd(), text: `, ${opts}` } : { start: call.getEnd() - 1, end: call.getEnd() - 1, text: `undefined, ${opts}` })
      }
    }
  }

  const predicateCall = (name: string) => `${name}(${opts})`

  const visitCall = (n: ts.CallExpression): boolean => {
    if (!ts.isIdentifier(n.expression)) return false
    const h = helperByDecl(n.expression)
    if (h && declarationOf(n.expression) === h.fn) {
      need.add(h.predicate)
      converted.push({ idiom: h.idiom, transform: 'T3', line: line(n) })
      // A no-argument helper was awaited already; a claims helper was not.
      replace(n, h.kind === 'no_args' ? predicateCall(h.predicate) : awaited(n, predicateCall(h.predicate)))
      return true
    }
    const legacy = importedName(n.expression, file, [ADMIN_AUTH])
    if (!legacy) return false
    if (CLAIM_PREDICATES[legacy]) {
      const target = CLAIM_PREDICATES[legacy]
      const problem = n.arguments.length === 1 ? claimsProblem(file, n.arguments[0], n) : 'not called with one argument'
      if (problem) {
        manual.push({ idiom: legacy, line: line(n), why: problem })
        return true
      }
      if (free(target, legacy, n)) {
        need.add(target)
        converted.push({ idiom: legacy, transform: 'T1', line: line(n) })
        replace(n, awaited(n, predicateCall(target)))
      }
      return true
    }
    const isAwaited = ts.isAwaitExpression(n.parent)
    if (legacy === 'currentUserIsAdmin' || legacy === 'currentUserHasScope' || legacy === 'requireAdminPage') {
      if (!isAwaited) {
        manual.push({ idiom: legacy, line: line(n), why: 'not awaited, so the answer here is a promise. Read it first: that is a bug to fix, not to carry over' })
        return true
      }
    }
    if (legacy === 'currentUserIsAdmin' && n.arguments.length === 0 && free('isStellrAdmin', legacy, n)) {
      need.add('isStellrAdmin')
      converted.push({ idiom: legacy, transform: 'T2', line: line(n) })
      replace(n, predicateCall('isStellrAdmin'))
      return true
    }
    if (legacy === 'currentUserHasScope' && n.arguments.length === 1 && free('hasScope', legacy, n)) {
      need.add('hasScope')
      converted.push({ idiom: legacy, transform: 'T2', line: line(n) })
      replace(n, `hasScope(${n.arguments[0].getText(sf)}${opts ? `, ${opts}` : ''})`)
      return true
    }
    if (legacy === 'requireAdminPage' && n.arguments.length === 0 && free('authz', legacy, n)) {
      need.add('authz')
      converted.push({ idiom: legacy, transform: 'T4', line: line(n) })
      replace(n, `authz.page.requireAdmin(${opts})`)
      return true
    }
    return false
  }

  /** `<claims role> === 'admin'`, directly or through a local read only ever compared to 'admin'. */
  const visitCompare = (n: ts.BinaryExpression): boolean => {
    const cmp = comparedToAdmin(n)
    if (!cmp) return false
    const direct = roleReadRoot(cmp.side)
    const local = direct ? null : localRoleRead(cmp.side)
    const root = direct ?? (local?.initializer ? roleReadRoot(local.initializer) : null)
    if (!root) return false
    const problem = claimsProblem(file, root, n)
    if (problem) {
      manual.push({ idiom: 'clerkRoleRead', line: line(n), why: problem })
      return true
    }
    if (local) {
      const name = (local.name as ts.Identifier).text
      const refs = refsTo(local, name, enclosingFn(local) ?? sf)
      if (!refs.every((r) => comparedToAdmin(r.parent)?.side === r)) {
        manual.push({ idiom: 'clerkRoleRead', line: line(n), why: 'this role is also read for something other than admin' })
        return true
      }
    }
    if (!free('isStellrAdmin', 'clerkRoleRead', n)) return true
    need.add('isStellrAdmin')
    converted.push({ idiom: 'clerkRoleRead', transform: 'T1', line: line(n) })
    const call = predicateCall('isStellrAdmin')
    replace(n, cmp.negated ? `!(await ${call})` : awaited(n, call))
    return true
  }

  const skip = new Set<ts.Node>(helpers.keys())
  const visit = (n: ts.Node): void => {
    if (skip.has(n)) return
    if (ts.isCallExpression(n) && visitCall(n)) return
    if (ts.isBinaryExpression(n) && visitCompare(n)) return
    ts.forEachChild(n, visit)
  }
  visit(sf)

  if (converted.length === 0) return { src, converted, manual }

  // ── Imports ────────────────────────────────────────────────────────────────
  const imports = sf.statements.filter(ts.isImportDeclaration)
  const moduleOf = (s: ts.ImportDeclaration) => (ts.isStringLiteral(s.moduleSpecifier) ? resolveModule(file, s.moduleSpecifier.text) : '')
  const moved: string[] = []
  if (!eventProblem && eventCalls.length) {
    for (const s of imports) {
      if (moduleOf(s) !== EVENT_ACCESS || !s.importClause) continue
      const nb = s.importClause.namedBindings
      if (s.importClause.isTypeOnly || !nb || !ts.isNamedImports(nb)) {
        const spec = s.moduleSpecifier
        const relative = (spec as ts.StringLiteral).text.startsWith('.')
        edits.push({ start: spec.getStart(sf), end: spec.getEnd(), text: `${q}${relative ? relativeSpec(file) : `@/${AUTHZ}`}${q}` })
        continue
      }
      moved.push(...nb.elements.map((el) => el.getText(sf)))
      const r = lineRange(src, s.getStart(sf), s.getEnd())
      edits.push({ ...r, text: '' })
    }
  }
  const wanted = [...need, ...moved]
  const existing = imports.find((s) => moduleOf(s) === AUTHZ && !s.importClause?.isTypeOnly && s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings))
  if (existing) {
    const nb = existing.importClause!.namedBindings as ts.NamedImports
    const have = nb.elements.map((el) => el.getText(sf))
    const add = wanted.filter((w) => !have.includes(w))
    if (add.length) edits.push({ start: nb.getStart(sf), end: nb.getEnd(), text: `{ ${[...have, ...add].join(', ')} }` })
  } else {
    const anchor = imports.find((s) => [ADMIN_AUTH, EVENT_ACCESS].includes(moduleOf(s)))
    const relative = !!anchor && (anchor.moduleSpecifier as ts.StringLiteral).text.startsWith('.')
    const stmt = `import { ${wanted.join(', ')} } from ${q}${relative ? relativeSpec(file) : `@/${AUTHZ}`}${q}${semi}\n`
    if (anchor) edits.push({ start: lineRange(src, anchor.getStart(sf), anchor.getEnd()).start, end: lineRange(src, anchor.getStart(sf), anchor.getEnd()).start, text: stmt })
    else {
      const last = imports[imports.length - 1]
      const at = last ? lineRange(src, last.getStart(sf), last.getEnd()).end : 0
      edits.push({ start: at, end: at, text: stmt })
    }
  }

  return { src: tidy(file, applyEdits(src, edits)), converted, manual }
}

function relativeSpec(file: string): string {
  const rel = path.posix.relative(path.posix.dirname(file), AUTHZ)
  return rel.startsWith('.') ? rel : `./${rel}`
}

/** Remove what the conversion left unused: a role local, the claims, the auth() call, the imports. */
function tidy(file: string, input: string): string {
  let src = input
  // One removal a pass, so each pass reads what the last one left. Each pass removes
  // something, so this ends; the bound only guards against a bug here looping.
  for (let pass = 0; pass < 2000; pass += 1) {
    const sf = parse(file, src) as ts.SourceFile
    const edits: Edit[] = []
    eachNode(sf, (n) => {
      if (edits.length || !ts.isVariableStatement(n) || n.declarationList.declarations.length !== 1) return
      const d = n.declarationList.declarations[0]
      const scope = enclosingFn(n) ?? sf
      if (ts.isIdentifier(d.name) && d.initializer && roleReadRoot(d.initializer) && refsTo(d, d.name.text, scope).length === 0) {
        edits.push({ ...lineRange(src, n.getStart(sf), n.getEnd()), text: '' })
        return
      }
      if (!ts.isObjectBindingPattern(d.name) || !d.initializer) return
      const init = strip(d.initializer)
      if (!ts.isAwaitExpression(init)) return
      const call = strip(init.expression)
      if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || importedName(call.expression, file, [CLERK]) !== 'auth') return
      const pattern = d.name
      if (pattern.elements.some((el) => el.dotDotDotToken)) return
      const dead = pattern.elements.find((el) => {
        if ((el.propertyName ?? el.name).getText(sf) !== 'sessionClaims' || !ts.isIdentifier(el.name)) return false
        return refsTo(el, el.name.text, scope).length === 0
      })
      if (!dead) return
      const rest = pattern.elements.filter((el) => el !== dead).map((el) => el.getText(sf))
      if (rest.length) edits.push({ start: pattern.getStart(sf), end: pattern.getEnd(), text: `{ ${rest.join(', ')} }` })
      else edits.push({ ...lineRange(src, n.getStart(sf), n.getEnd()), text: '' })
    })
    if (!edits.length) {
      for (const s of sf.statements) {
        if (edits.length || !ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue
        const m = resolveModule(file, s.moduleSpecifier.text)
        const nb = s.importClause?.namedBindings
        if (![ADMIN_AUTH, CLERK].includes(m) || !nb || !ts.isNamedImports(nb)) continue
        const dead = nb.elements.filter((el) => {
          const name = (el.propertyName ?? el.name).text
          return (m === CLERK ? name === 'auth' : true) && refsTo(el, el.name.text, sf).length === 0
        })
        if (!dead.length) continue
        const rest = nb.elements.filter((el) => !dead.includes(el)).map((el) => el.getText(sf))
        if (rest.length || s.importClause?.name) edits.push({ start: nb.getStart(sf), end: nb.getEnd(), text: `{ ${rest.join(', ')} }` })
        else edits.push({ ...lineRange(src, s.getStart(sf), s.getEnd()), text: '' })
      }
    }
    if (!edits.length) return src
    src = applyEdits(src, edits)
  }
  return src
}

const isLegacyLeft = (id: string) => {
  const entry = IDIOMS.find((i) => i.id === id)
  return entry?.kind !== 'wrapper' && entry?.kind !== 'page_adapter'
}

/** The idioms still counted in this source, as the ratchet counts them, without the ones it settles elsewhere. */
function legacyLeft(file: string, src: string): string[] {
  const counts = (measureIdioms(new Map([[file, src]])) as Record<string, Record<string, number>>)[file] ?? {}
  return Object.keys(counts).filter(isLegacyLeft)
}

/** Move this file's legacy guards onto lib/authz, as far as can be proven from the file. */
export function transformSource(file: string, src: string): Transform {
  if (isTestFile(file)) return { src, converted: [], manual: [] }
  const before = legacyLeft(file, src)
  const refuse = HELD_WRAPPERS[file] ?? (!isAdminSurface(file) ? OUTSIDE_SURFACE : /^\s*['"]use client['"]/.test(src) ? CLIENT_FILE : null)
  if (refuse) return { src, converted: [], manual: before.map((idiom) => ({ idiom, why: refuse })) }
  const out = convertSites(file, src)
  if (out.src !== src) {
    const { diagnostics } = ts.transpileModule(out.src, { fileName: file, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve } })
    if (diagnostics?.length) {
      return { src, converted: [], manual: [...out.manual, { idiom: 'codemod', why: 'the rewrite did not parse, so nothing was changed' }] }
    }
  }
  for (const idiom of legacyLeft(file, out.src)) {
    if (!out.manual.some((m) => m.idiom === idiom)) out.manual.push({ idiom, why: DISPOSITIONS[idiom]?.why ?? 'unknown idiom' })
  }
  return out
}

// ── T7: test mocks ───────────────────────────────────────────────────────────

const LEGACY_MODULES = [ADMIN_AUTH, EVENT_ACCESS]

/** What a mocked export becomes. `sync` means the legacy helper was synchronous, so the mock must return a promise now. */
const MOCK_RENAMES: Record<string, { to: string; sync?: boolean; page?: boolean }> = {
  isAdminClaims: { to: 'isStellrAdmin', sync: true },
  hasAdminPortalAccess: { to: 'hasPortalAccess', sync: true },
  currentUserIsAdmin: { to: 'isStellrAdmin' },
  currentUserHasScope: { to: 'hasScope' },
  requireEventAccess: { to: 'requireEventAccess' },
  requireAdminPage: { to: 'authz', page: true },
}

/** The modules a test exercises: the file beside it, and what it imports by relative path or from app/. */
function subjectsOf(file: string, sf: ts.SourceFile): string[] {
  const out = new Set<string>([fileModule(file.replace(/(\.[^./]+)?\.test(\.[jt]sx?)$/, '$2'))])
  const take = (spec: string) => {
    const m = resolveModule(file, spec)
    if ((spec.startsWith('.') || m.startsWith('app/')) && !LEGACY_MODULES.includes(m)) out.add(m)
  }
  eachNode(sf, (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) take(n.moduleSpecifier.text)
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) take(n.arguments[0].text)
  })
  return [...out]
}

function isTypeOnlyLink(n: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(n)) return n.isTypeOnly
  const c = n.importClause
  if (!c) return false
  if (c.isTypeOnly) return true
  return !c.name && !!c.namedBindings && ts.isNamedImports(c.namedBindings) && c.namedBindings.elements.length > 0 && c.namedBindings.elements.every((el) => el.isTypeOnly)
}

/** One run reads each module's imports once, however many tests walk past it. */
const importCache = new Map<string, string[]>()

/** The modules this source loads when it runs. A type-only import loads nothing. */
function runtimeImports(file: string, src: string): string[] {
  const key = `${file}\0${src}`
  const cached = importCache.get(key)
  if (cached) return cached
  const out: string[] = []
  eachNode(parse(file, src) as ts.SourceFile, (n) => {
    let spec: ts.Expression | undefined
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) spec = isTypeOnlyLink(n) ? undefined : n.moduleSpecifier
    else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) spec = n.arguments[0]
    if (spec && ts.isStringLiteralLike(spec)) out.push(resolveModule(file, spec.text))
  })
  importCache.set(key, out)
  return out
}

/** The modules this test replaces outright, so the real one's imports never run. A factory keeping the original does not count. */
function replacedModules(file: string, sf: ts.SourceFile): Set<string> {
  const out = new Set<string>()
  for (const s of sf.statements) {
    if (!ts.isExpressionStatement(s) || !ts.isCallExpression(s.expression)) continue
    const call = s.expression
    if (call.expression.getText(sf) !== 'vi.mock' || !call.arguments[0] || !ts.isStringLiteralLike(call.arguments[0])) continue
    const factory = call.arguments[1]
    const keeps = !!factory && ((ts.isFunctionLike(factory) && factory.parameters.length > 0) || /importActual|importOriginal/.test(factory.getText(sf)))
    if (!keeps) out.add(resolveModule(file, call.arguments[0].text))
  }
  return out
}

/** The first module the test loads for real that still imports `legacy`, walking from `roots`. */
function moduleReachingLegacy(roots: readonly string[], legacy: string, replaced: ReadonlySet<string>, readModule: (module: string) => string | null): string | null {
  const seen = new Set<string>()
  const queue = roots.filter((m) => !replaced.has(m) && m !== AUTHZ)
  for (let i = 0; i < queue.length; i += 1) {
    const m = queue[i]
    if (seen.has(m)) continue
    seen.add(m)
    const src = readModule(m)
    if (src === null) continue
    const next = runtimeImports(`${m}.ts`, src)
    if (next.includes(legacy)) return m
    // After this rewrite lib/authz is the mock, so nothing under it loads.
    for (const dep of next) if (dep !== AUTHZ && !replaced.has(dep) && !seen.has(dep)) queue.push(dep)
  }
  return null
}

/**
 * Rewrite one test's mock of a legacy module. Done only when nothing the test still loads
 * for real reads that module, however far down: a mock pointed at lib/authz while such a
 * module still reads lib/admin-auth stubs the wrong thing, and a denial test can then pass
 * for the wrong reason. A module the test replaces outright stops the walk.
 */
export function transformTest(file: string, src: string, readModule: (module: string) => string | null): Transform {
  const unchanged = (why?: string): Transform => ({ src, converted: [], manual: why ? [{ idiom: 'test mock', why }] : [] })
  if (!isTestFile(file) || !/(admin-auth|event-access)/.test(src)) return unchanged()
  const sf = parse(file, src) as ts.SourceFile
  const mocks: { call: ts.CallExpression; module: string }[] = []
  let authzMocked = false
  for (const s of sf.statements) {
    if (!ts.isExpressionStatement(s) || !ts.isCallExpression(s.expression)) continue
    const call = s.expression
    if (!ts.isPropertyAccessExpression(call.expression) || call.expression.getText(sf) !== 'vi.mock') continue
    const spec = call.arguments[0]
    if (!spec || !ts.isStringLiteralLike(spec)) continue
    const m = resolveModule(file, spec.text)
    if (m === AUTHZ) authzMocked = true
    if (LEGACY_MODULES.includes(m)) mocks.push({ call, module: m })
  }
  if (!mocks.length) return unchanged()
  if (authzMocked) return unchanged('this test already mocks lib/authz: merge the mocks by hand')
  // Two vi.mock calls on one module: the second silently replaces the first.
  if (mocks.length > 1) return unchanged('this test mocks both legacy modules: merge them into one lib/authz mock by hand')
  const { call, module } = mocks[0]

  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && LEGACY_MODULES.includes(resolveModule(file, s.moduleSpecifier.text))) {
      return unchanged('this test imports the legacy module itself')
    }
  }

  const subjects = subjectsOf(file, sf).map((m) => ({ m, src: readModule(m) })).filter((x): x is { m: string; src: string } => x.src !== null)
  if (!subjects.length) return unchanged('cannot tell what this test exercises')
  const stuck = moduleReachingLegacy([...subjects.map((x) => x.m), ...runtimeImports(file, src)], module, replacedModules(file, sf), readModule)
  if (stuck) return unchanged(`${stuck} still imports ${module}: convert it first`)

  const factory = call.arguments[1]
  if (!factory || !ts.isArrowFunction(factory) || factory.parameters.length) return unchanged('the mock factory is not a plain `() => ({ … })`')
  const body = strip(factory.body as ts.Expression)
  if (!ts.isObjectLiteralExpression(body)) return unchanged('the mock factory is not a plain `() => ({ … })`')

  const parts: string[] = []
  const seen = new Set<string>()
  for (const p of body.properties) {
    if (!(ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) || !ts.isIdentifier(p.name)) return unchanged('the mock has a form this tool does not read')
    const rule = MOCK_RENAMES[p.name.text]
    if (!rule) return unchanged(`the mock defines ${p.name.text}, which has no one-for-one lib/authz name`)
    if (seen.has(rule.to)) return unchanged(`the mock defines two helpers that become ${rule.to}: merge them by hand`)
    seen.add(rule.to)
    const value = ts.isShorthandPropertyAssignment(p) ? p.name.text : p.initializer.getText(sf)
    if (rule.sync) {
      const init = ts.isPropertyAssignment(p) ? strip(p.initializer) : null
      if (!init || !ts.isArrowFunction(init) || init.parameters.length) {
        return unchanged(`the mock of ${p.name.text} reads the claims it is handed, and lib/authz takes none: rewrite the test to set the answer`)
      }
      parts.push(`${rule.to}: async ${value}`)
    } else if (rule.page) {
      parts.push(`authz: { page: { requireAdmin: ${value} } }`)
    } else {
      parts.push(ts.isShorthandPropertyAssignment(p) && p.name.text === rule.to ? rule.to : `${rule.to}: ${value}`)
    }
  }

  const spec = call.arguments[0]
  const q = spec.getText(sf).charAt(0)
  const edits: Edit[] = [
    { start: spec.getStart(sf), end: spec.getEnd(), text: `${q}@/${AUTHZ}${q}` },
    { start: body.getStart(sf), end: body.getEnd(), text: `{ ${parts.join(', ')} }` },
  ]
  return { src: applyEdits(src, edits), converted: [{ idiom: 'test mock', transform: 'T7', line: sf.getLineAndCharacterOfPosition(call.getStart(sf)).line + 1 }], manual: [] }
}

// ── A run ────────────────────────────────────────────────────────────────────

export interface Run {
  results: Map<string, Transform>
  /** Every source file as it would be after this run. */
  after: Map<string, string>
}

/** Source files first, so a test's mock moves only once its subject has. Touches no file. */
export function runCodemod(sources: Map<string, string>, tests: Map<string, string>, selected: (file: string) => boolean): Run {
  const results = new Map<string, Transform>()
  const after = new Map(sources)
  for (const [file, src] of sources) {
    if (!selected(file)) continue
    const t = transformSource(file, src)
    results.set(file, t)
    after.set(file, t.src)
  }
  const readModule = (m: string) => after.get(`${m}.ts`) ?? after.get(`${m}.tsx`) ?? after.get(`${m}/index.ts`) ?? null
  for (const [file, src] of tests) {
    if (selected(file)) results.set(file, transformTest(file, src, readModule))
  }
  return { results, after }
}

/** `*` within a segment and `**` across them; everything else, brackets included, is literal. */
export function globToRegExp(glob: string): RegExp {
  const body = glob.replace(/\*\*\/|\*\*|\*|[.+?^${}()|[\]\\]/g, (t) => {
    if (t === '**/') return '(?:.*/)?'
    if (t === '**') return '.*'
    if (t === '*') return '[^/]*'
    return `\\${t}`
  })
  return new RegExp(`^${body}$`)
}

function collectTests(root: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) walk(rel)
      else if (/\.test\.tsx?$/.test(e.name)) out.set(rel, fs.readFileSync(path.join(root, rel), 'utf8'))
    }
  }
  for (const dir of ['app', 'lib', 'components']) if (fs.existsSync(path.join(root, dir))) walk(dir)
  return out
}

/** Sites per idiom, for the ratchet's whole-tree count. */
function byIdiom(sources: Map<string, string>): Record<string, number> {
  return totalsOf(measureIdioms(sources)).byIdiom as Record<string, number>
}

export function main(argv: string[], root = process.cwd()): number {
  const values = (flag: string) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []))
  const areas = values('--area').map(globToRegExp)
  const files = values('--file').map((f) => f.split(path.sep).join('/'))
  const all = argv.includes('--all')
  const write = argv.includes('--write')
  const check = argv.includes('--check')
  if (!all && !areas.length && !files.length) {
    console.error('Name what to change: --area <glob>, --file <path>, or --all for a report.')
    return 1
  }
  if (all && write) {
    console.error('--all only reports. Conversion runs one feature area per PR: use --area or --file.')
    return 1
  }
  const sources: Map<string, string> = collectSources(root)
  const tests = collectTests(root)
  const selected = (f: string) => all || files.includes(f) || areas.some((r) => r.test(f))
  const { results, after } = runCodemod(sources, tests, selected)

  let changed = 0
  const why = new Map<string, number>()
  let manualSites = 0
  for (const [file, t] of [...results].sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (const m of t.manual) {
      manualSites += 1
      const key = `${m.idiom}: ${m.why}`
      why.set(key, (why.get(key) ?? 0) + 1)
      if (!all) console.log(`MANUAL ${file}${m.line ? `:${m.line}` : ''} ${m.idiom}: ${m.why}`)
    }
    const original = sources.get(file) ?? tests.get(file)
    if (t.src === original) continue
    changed += 1
    if (!all) console.log(`${write ? 'changed' : 'would change'} ${file}: ${[...new Set(t.converted.map((c) => c.transform))].sort().join(', ')}`)
    if (write) fs.writeFileSync(path.join(root, file), t.src)
  }

  const before = byIdiom(sources)
  const now = byIdiom(after)
  console.log(`\nSites by idiom, whole tree (before -> after this ${write ? 'run' : 'dry run'}):`)
  for (const { id } of IDIOMS) {
    if (before[id] || now[id]) console.log(`  ${id}: ${before[id] ?? 0} -> ${now[id] ?? 0}`)
  }
  if (all) {
    console.log('\nLeft for a person, by reason:')
    for (const [k, n] of [...why].sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${k}`)
  }
  console.log(`\n${changed} file(s) ${write ? 'changed' : 'to change'}, ${manualSites} site(s) to handle by hand.`)
  if (write && changed) console.log(AFTER_WRITE)
  return check && manualSites ? 1 : 0
}

const invoked = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) process.exitCode = main(process.argv.slice(2))
