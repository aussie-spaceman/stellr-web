// S5 legacy-authorisation inventory and shrink-only ratchet (multi-tenant plan
// S5, C5a). docs/TENANCY-S5.md: the count depends on the idiom list, so the list
// and this script are committed, and the generated baseline is the only number
// the ratchet uses. Authorisation has converged when the baseline reaches 0 (C25).
//
// Counts SITES, found by parsing, so a comment, a string or a look-alike from
// another module never counts:
//   - a reference to a legacy helper imported from its own module (an alias, a
//     namespace, a dynamic import and a re-export all count; a consumer of that
//     re-export does not, the re-export itself is the site). In the module that
//     defines it, every mention counts, the definition included, so 0 means the
//     helper is gone;
//   - a call site of a domain wrapper, only while the wrapper still rests on a
//     legacy check. Re-implemented over lib/authz (codemod T6), its callers have
//     nothing left to convert and drop out;
//   - a use of lib/authz page.requireAdmin. Codemod T4 swaps requireAdminPage for
//     it one for one, and lib/authz warns it does not confine an event manager once
//     the source flips. So the swap is not progress: the site stays counted until
//     the page moves to a confining adapter, and 0 means none is left;
//   - a read of the role from the Clerk session claims or publicMetadata;
//   - a literal list of the two portal roles;
//   - a select from a role table, outside the screens that manage that table.
//
// Same-file `function requireAdmin()` wrappers (idiom 5) are not their own entry:
// each copies a legacy check, and that check is counted where it stands.
//
// lib/authz.ts and lib/authz/** are the replacement, so they are not scanned.
// Nor is scripts/ (operator scripts make no request-time decision), nor tests.
//
// test/authz-ratchet.test.ts fails when a count grows, and when one falls without
// the baseline falling with it, so the ratchet only tightens. It reads the baseline
// in its own tree, so CI's --since step guards the baseline itself.
//
// Usage (tsx, because it imports the TypeScript route AST):
//   npx tsx scripts/authz-idioms.mjs            summary and ratchet diff
//   npx tsx scripts/authz-idioms.mjs --json     the full measurement as JSON
//   npx tsx scripts/authz-idioms.mjs --check    exit 1 when the ratchet grew or is stale
//   npx tsx scripts/authz-idioms.mjs --write    shrink the baseline to what is measured
//   npx tsx scripts/authz-idioms.mjs --write --allow-grow   also take in new sites
//   npx tsx scripts/authz-idioms.mjs --seed     write the baseline (refuses when one exists)
//   npx tsx scripts/authz-idioms.mjs --since <ref>   exit 1 when the committed baseline
//                 holds more sites than at the merge base with <ref>, unless
//                 AUTHZ_RATCHET_GROW_OK=true (the authz-ratchet-grow PR label)
//   --root <dir>  measure another checkout (default: the current directory)
//
// Read-only unless --write or --seed. Never prints file contents.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { analyzeNamedExport, fileModule, resolveModule } from '../lib/security/route-ast'
import { calledFrom } from '../lib/security/route-guards'
import { collectSources, initializerOf, isTestFile, parse, walkNodes } from './s5-inventory.mjs'

// ── The idiom list ───────────────────────────────────────────────────────────

/**
 * `idiom` is the number in the S5 authz analysis's inventory of twelve.
 *   symbol   a helper that C25 removes
 *   wrapper  a domain wrapper that stays, re-implemented over lib/authz
 * The other kinds are found by shape; see roleSites().
 */
export const LEGACY_IDIOMS = [
  { id: 'isAdminClaims', kind: 'symbol', idiom: 1, file: 'lib/admin-auth.ts' },
  { id: 'currentUserIsAdmin', kind: 'symbol', idiom: 2, file: 'lib/admin-auth.ts' },
  { id: 'requireAdminPage', kind: 'symbol', idiom: 3, file: 'lib/admin-auth.ts' },
  { id: 'pageRequireAdmin', kind: 'page_adapter', idiom: 3, swapFor: 'requireAdminPage' },
  { id: 'clerkRoleRead', kind: 'role_read', idiom: 4, also: [8, 10, 11] },
  { id: 'requireEventAccess', kind: 'symbol', idiom: 6, file: 'lib/event-access.ts' },
  { id: 'requireScholarshipAdmin', kind: 'wrapper', idiom: 7, file: 'lib/scholarship-admin.ts' },
  { id: 'requireSurveyAdmin', kind: 'wrapper', idiom: 7, file: 'lib/survey/admin-auth.ts' },
  { id: 'canManageStoreCatalog', kind: 'wrapper', idiom: 7, file: 'lib/store/auth.ts' },
  { id: 'adminName', kind: 'wrapper', idiom: 7, file: 'app/api/admin/esign/templates/guard.ts' },
  { id: 'hasAdminPortalAccess', kind: 'symbol', idiom: 8, file: 'lib/admin-auth.ts' },
  { id: 'isEventManagerClaims', kind: 'symbol', idiom: 8, file: 'lib/admin-auth.ts' },
  { id: 'currentUserHasScope', kind: 'symbol', idiom: 9, file: 'lib/admin-auth.ts' },
  { id: 'isStaffRole', kind: 'symbol', idiom: 10, file: 'lib/admin-auth.ts' },
  { id: 'STAFF_CLERK_ROLES', kind: 'symbol', idiom: 10, file: 'lib/admin-auth.ts' },
  { id: 'portalRoleList', kind: 'role_list', idiom: 10 },
  { id: 'roleTableRead', kind: 'role_table', idiom: 12, also: [9, 10] },
]

/** The tables that say who is staff. */
export const ROLE_TABLES = ['staff_roles', 'event_manager_assignments']

/** Screens whose job is to show or edit a role table. A read here decides nothing, and it stays after C25. */
export const ROLE_TABLE_MANAGERS = {
  'app/api/admin/event-managers/route.ts': 'the screen that assigns event managers',
  'app/(stellr)/(admin)/admin/staff/page.tsx': 'lists staff scopes for editing',
  'app/(stellr)/(admin)/admin/competitions/[slug]/page.tsx': 'lists the managers assigned to the event being edited',
  'lib/event-manager.ts': 'the service both assignment screens call to grant, change, remove and sweep event managers',
}

const SKIP_FILE = /^scripts\/|\.stories\.[jt]sx?$|^lib\/authz(\.|\/)/

export function isScanned(file) {
  return !isTestFile(file) && !SKIP_FILE.test(file)
}

const SYMBOLS = LEGACY_IDIOMS.filter((i) => i.kind === 'symbol' || i.kind === 'wrapper')
const SYMBOL_IDS = SYMBOLS.map((i) => i.id)

// ── Named helpers ────────────────────────────────────────────────────────────

/** Not a reference: a property name, an object key, or the import itself. */
function isKeyOrImport(id) {
  const p = id.parent
  if (ts.isPropertyAccessExpression(p) && p.name === id) return true
  if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isJsxAttribute(p)) && p.name === id) return true
  if (ts.isBindingElement(p)) return true
  return ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)
}

function peel(expr) {
  let e = expr
  while (e && (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e))) e = e.expression
  return e
}

function dynamicImportSpec(expr) {
  const e = peel(expr)
  if (!e || !ts.isCallExpression(e) || e.expression.kind !== ts.SyntaxKind.ImportKeyword) return null
  const a = e.arguments[0]
  return a && ts.isStringLiteralLike(a) ? a.text : null
}

/**
 * Which wrappers still rest on a legacy check. Read through the same analyser
 * the guard check uses, so a wrapper counts through same-file helpers too. A
 * wrapper whose definition cannot be read stays counted: the safe way to be wrong.
 */
export function liveWrappers(sources) {
  const live = new Set()
  const removable = SYMBOLS.filter((i) => i.kind === 'symbol')
  for (const w of SYMBOLS.filter((i) => i.kind === 'wrapper')) {
    const src = sources.get(w.file)
    const facts = src === undefined ? null : analyzeNamedExport(w.file, src, w.id)
    if (!facts || facts.comparesRoleToAdmin || removable.some((s) => calledFrom(facts, s.id, [fileModule(s.file)]))) live.add(w.id)
  }
  return live
}

/** id → sites, for the helpers in LEGACY_IDIOMS, in one parsed file. */
function symbolSites(file, sf, live) {
  const self = fileModule(file)
  const counts = {}
  const bump = (id) => {
    counts[id] = (counts[id] ?? 0) + 1
  }
  const counted = SYMBOLS.filter((s) => s.kind === 'symbol' || live.has(s.id))
  const fromModule = (spec) => {
    const m = resolveModule(file, spec)
    return counted.filter((s) => fileModule(s.file) === m)
  }
  /** local name → idiom id */
  const locals = new Map()
  /** namespace name → the idioms its module holds */
  const namespaces = new Map()
  // In its own module a symbol is counted under its own name, and a wrapper's
  // own definition is not a call site.
  for (const s of SYMBOLS) if (s.kind === 'symbol' && fileModule(s.file) === self) locals.set(s.id, s.id)

  // A name bound to a module (or a pattern taken from one).
  const bindModule = (name, held) => {
    if (!held.length) return
    if (ts.isIdentifier(name)) namespaces.set(name.text, held)
    if (ts.isObjectBindingPattern(name)) {
      for (const el of name.elements) {
        const key = el.propertyName ?? el.name
        if (ts.isIdentifier(key) && ts.isIdentifier(el.name) && held.some((s) => s.id === key.text)) locals.set(el.name.text, key.text)
      }
    }
  }

  walkNodes(sf, (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const held = fromModule(n.moduleSpecifier.text)
      const nb = n.importClause?.namedBindings
      if (held.length && nb && ts.isNamespaceImport(nb)) namespaces.set(nb.name.text, held)
      if (held.length && nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) {
          const name = (el.propertyName ?? el.name).text
          if (held.some((s) => s.id === name)) locals.set(el.name.text, name)
        }
      }
    }
    if (ts.isVariableDeclaration(n) && n.initializer) {
      const spec = dynamicImportSpec(n.initializer)
      if (spec !== null) bindModule(n.name, fromModule(spec))
      // const { isAdminClaims: ok } = namespace
      const init = peel(n.initializer)
      if (ts.isIdentifier(init) && namespaces.has(init.text)) bindModule(n.name, namespaces.get(init.text))
    }
    // import('…').then((m) => …), and .then(({ isAdminClaims }) => …).
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'then') {
      const spec = dynamicImportSpec(n.expression.expression)
      const fn = n.arguments[0]
      if (spec !== null && fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && fn.parameters[0]) {
        bindModule(fn.parameters[0].name, fromModule(spec))
      }
    }
    // export { isAdminClaims } from '…', and export * from '…'.
    if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      const held = fromModule(n.moduleSpecifier.text)
      if (n.exportClause && ts.isNamedExports(n.exportClause)) {
        for (const el of n.exportClause.elements) {
          const name = (el.propertyName ?? el.name).text
          if (held.some((s) => s.id === name)) bump(name)
        }
      } else if (!n.exportClause) {
        for (const s of held) bump(s.id)
      }
    }
  })

  walkNodes(sf, (n) => {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && namespaces.get(n.expression.text)?.some((s) => s.id === n.name.text)) {
      bump(n.name.text)
    }
    // (await import('…')).isAdminClaims
    if (ts.isPropertyAccessExpression(n)) {
      const spec = dynamicImportSpec(n.expression)
      if (spec !== null && fromModule(spec).some((s) => s.id === n.name.text)) bump(n.name.text)
    }
    if (!ts.isIdentifier(n) || !locals.has(n.text) || isKeyOrImport(n)) return
    // Inside `export { x } from '…'` the name is not a local; that form is counted above.
    if (ts.isExportSpecifier(n.parent) && n.parent.parent.parent.moduleSpecifier) return
    if (ts.isExportSpecifier(n.parent) && n.parent.propertyName && n.parent.name === n) return
    bump(locals.get(n.text))
  })
  return counts
}

const AUTHZ_MODULE = 'lib/authz'

/** Uses of lib/authz's page.requireAdmin, however `page` was reached. */
function pageAdapterSites(file, sf) {
  /** Local names of lib/authz's `page`. */
  const pages = new Set()
  /** Local names of the module itself, or of its `authz` object. */
  const roots = new Set()
  const take = (name, isModule) => {
    if (ts.isIdentifier(name) && isModule) roots.add(name.text)
    if (ts.isObjectBindingPattern(name)) {
      for (const el of name.elements) {
        const key = el.propertyName ?? el.name
        if (!ts.isIdentifier(key) || !ts.isIdentifier(el.name)) continue
        if (key.text === 'page') pages.add(el.name.text)
        if (key.text === 'authz') roots.add(el.name.text)
      }
    }
  }
  const isPage = (expr, depth = 0) => {
    const e = peel(expr)
    if (depth > 4 || !e) return false
    if (ts.isIdentifier(e)) {
      if (pages.has(e.text)) return true
      const init = initializerOf(e)
      return !!init && isPage(init, depth + 1)
    }
    if (!ts.isPropertyAccessExpression(e) || e.name.text !== 'page') return false
    let root = peel(e.expression)
    while (ts.isPropertyAccessExpression(root)) root = peel(root.expression)
    return ts.isIdentifier(root) && roots.has(root.text)
  }
  let sites = 0
  walkNodes(sf, (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && resolveModule(file, n.moduleSpecifier.text) === AUTHZ_MODULE) {
      const nb = n.importClause?.namedBindings
      if (nb && ts.isNamespaceImport(nb)) roots.add(nb.name.text)
      if (nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) {
          const name = (el.propertyName ?? el.name).text
          if (name === 'page') pages.add(el.name.text)
          if (name === 'authz') roots.add(el.name.text)
        }
      }
    }
    if (ts.isVariableDeclaration(n) && n.initializer) {
      const spec = dynamicImportSpec(n.initializer)
      if (spec !== null && resolveModule(file, spec) === AUTHZ_MODULE) take(n.name, true)
      const init = peel(n.initializer)
      if (ts.isIdentifier(init) && roots.has(init.text)) take(n.name, false)
      // const { requireAdmin } = page
      if (ts.isObjectBindingPattern(n.name) && isPage(n.initializer)) {
        sites += n.name.elements.filter((el) => (el.propertyName ?? el.name).getText() === 'requireAdmin').length
      }
    }
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'requireAdmin' && isPage(n.expression)) sites += 1
  })
  return sites ? { pageRequireAdmin: sites } : {}
}

// ── Found by shape ───────────────────────────────────────────────────────────

const CLERK_METADATA = new Set(['publicMetadata', 'sessionClaims'])

/** The property this name was destructured from (`const { sessionClaims: c } = …` gives sessionClaims). */
function destructuredKey(id) {
  for (let n = id.parent; n; n = n.parent) {
    const statements = ts.isBlock(n) || ts.isSourceFile(n) ? n.statements : null
    if (!statements) continue
    for (const s of statements) {
      if (!ts.isVariableStatement(s)) continue
      for (const d of s.declarationList.declarations) {
        if (!ts.isObjectBindingPattern(d.name)) continue
        const el = d.name.elements.find((e) => ts.isIdentifier(e.name) && e.name.text === id.text)
        if (el) return (el.propertyName ?? el.name).getText()
      }
    }
  }
  return null
}

/** `claims?.metadata` where `claims` is a parameter: a helper handed the session claims. */
function readsClaimsParamMetadata(expr) {
  const e = peel(expr)
  if (!e || !ts.isPropertyAccessExpression(e) || e.name.text !== 'metadata') return false
  const root = peel(e.expression)
  return ts.isIdentifier(root) && /claims$/i.test(root.text) && initializerOf(root) === null
}

/**
 * The expression reads the Clerk session claims or publicMetadata, directly or
 * through a local binding. By name, as lib/security/route-ast.ts does: a role read
 * from any other JWT's claims is not a Clerk role.
 */
function readsClerkMetadata(expr, depth = 0) {
  if (depth > 4) return false
  if (readsClaimsParamMetadata(expr)) return true
  let found = false
  walkNodes(expr, (n) => {
    if (found) return
    if (ts.isPropertyAccessExpression(n) && CLERK_METADATA.has(n.name.text)) found = true
    if (ts.isIdentifier(n) && !isKeyOrImport(n)) {
      if (CLERK_METADATA.has(n.text) || CLERK_METADATA.has(destructuredKey(n))) found = true
      else {
        const init = depth < 4 ? initializerOf(n) : null
        if (init && init !== expr && readsClerkMetadata(init, depth + 1)) found = true
      }
    }
  })
  return found
}

/** `claims?.metadata?.role`, `user.publicMetadata.role`, `meta.role`, `const { role } = claims.metadata`. */
function readsClerkRole(n) {
  if (ts.isPropertyAccessExpression(n) && n.name.text === 'role') return readsClerkMetadata(n.expression)
  if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && n.argumentExpression.text === 'role') return readsClerkMetadata(n.expression)
  if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent)) {
    const key = n.propertyName ?? n.name
    const decl = n.parent.parent
    return ts.isIdentifier(key) && key.text === 'role' && ts.isVariableDeclaration(decl) && !!decl.initializer && readsClerkMetadata(decl.initializer)
  }
  return false
}

const isPortalRoleList = (n) => {
  if (!ts.isArrayLiteralExpression(n)) return false
  const words = n.elements.filter(ts.isStringLiteralLike).map((e) => e.text)
  return words.includes('admin') && words.includes('event_manager')
}

/** A local name stands for its initializer. */
const throughBinding = (expr) => {
  const e = peel(expr)
  return e && ts.isIdentifier(e) ? peel(initializerOf(e)) : e
}

/** `.from('<role table>').select(…)`, also with the query or the table name held in a const. */
function selectsRoleTable(n) {
  if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || n.expression.name.text !== 'select') return false
  const r = throughBinding(n.expression.expression)
  if (!r || !ts.isCallExpression(r) || !ts.isPropertyAccessExpression(r.expression) || r.expression.name.text !== 'from') return false
  const t = r.arguments[0] && throughBinding(r.arguments[0])
  return !!t && ts.isStringLiteralLike(t) && ROLE_TABLES.includes(t.text)
}

/** The file has a role-table read, whether or not it is exempt from the count. */
export function selectsFromRoleTable(file, src) {
  let found = false
  walkNodes(parse(file, src), (n) => {
    if (selectsRoleTable(n)) found = true
  })
  return found
}

function roleSites(file, sf) {
  const counts = {}
  const bump = (id) => {
    counts[id] = (counts[id] ?? 0) + 1
  }
  const managesRoleTable = file in ROLE_TABLE_MANAGERS
  walkNodes(sf, (n) => {
    if (readsClerkRole(n)) bump('clerkRoleRead')
    if (isPortalRoleList(n)) bump('portalRoleList')
    if (!managesRoleTable && selectsRoleTable(n)) bump('roleTableRead')
  })
  return counts
}

// ── Measurement ──────────────────────────────────────────────────────────────

const WORTH_PARSING = new RegExp([...SYMBOL_IDS, 'requireAdmin', 'publicMetadata', 'laims', 'event_manager', ...ROLE_TABLES].join('|'))

/** file → idiom id → sites, from repo-relative path → source. */
export function measureIdioms(sources) {
  const live = liveWrappers(sources)
  const files = {}
  for (const [file, src] of sources) {
    if (!isScanned(file) || !WORTH_PARSING.test(src)) continue
    const sf = parse(file, src)
    const counts = { ...symbolSites(file, sf, live), ...pageAdapterSites(file, sf), ...roleSites(file, sf) }
    if (Object.keys(counts).length) files[file] = sortObj(counts)
  }
  return sortObj(files)
}

const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

export function totalsOf(files) {
  const byIdiom = {}
  let sites = 0
  for (const counts of Object.values(files)) {
    for (const [id, n] of Object.entries(counts)) {
      byIdiom[id] = (byIdiom[id] ?? 0) + n
      sites += n
    }
  }
  return { files: Object.keys(files).length, sites, byIdiom: sortObj(byIdiom) }
}

// ── Baseline and ratchet diff ────────────────────────────────────────────────

export const BASELINE_FILE = 'test/baselines/authz-legacy-idioms.json'

export function baselineOf(files, idioms = LEGACY_IDIOMS.map((i) => i.id)) {
  return {
    $comment:
      'Generated by `npx tsx scripts/authz-idioms.mjs`; never edit by hand. Shrink-only: legacy authorisation sites per file, reaching 0 at C25. The idiom list is LEGACY_IDIOMS in that script. See test/authz-ratchet.test.ts.',
    idioms,
    totals: totalsOf(files),
    files: sortObj(files),
  }
}

/** adapter idiom → the legacy idiom it replaces one for one, without confining anyone further. */
const SWAPS = LEGACY_IDIOMS.filter((i) => i.swapFor).map((i) => [i.id, i.swapFor])

/** A file's counts with each swap adapter added onto the idiom it replaced. */
function foldSwaps(counts = {}) {
  const out = { ...counts }
  for (const [adapter, legacy] of SWAPS) {
    if (out[adapter] === undefined) continue
    out[legacy] = (out[legacy] ?? 0) + out[adapter]
    delete out[adapter]
  }
  return out
}

/**
 * Per file and idiom: sites above the baseline (growth), and sites below it (a shrink
 * not recorded). A swap is neither: the file holds as many sites to convert as before.
 * The test that the baseline is exactly what the script writes makes it recorded.
 */
export function idiomDiff(baseline, measured) {
  const base = baseline?.files ?? {}
  const added = []
  const stale = []
  for (const file of new Set([...Object.keys(base), ...Object.keys(measured)])) {
    const before = foldSwaps(base[file])
    const after = foldSwaps(measured[file])
    for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const was = before[id] ?? 0
      const now = after[id] ?? 0
      if (now > was) added.push(`${file}: ${id} ${was} -> ${now}`)
      if (now < was) stale.push(`${file}: ${id} ${was} -> ${now}`)
    }
  }
  return { added: added.sort(), stale: stale.sort() }
}

/** The committed baseline holds more sites than the one at the merge base (null: it has none yet). */
export function sitesGrew(atBase, committed) {
  return !!atBase && committed.totals.sites > atBase.totals.sites
}

/**
 * Idioms the baseline tracked with sites still in it that the list no longer has.
 * Dropping an entry would otherwise be a quiet way to shrink the count: take its
 * sites to 0 first.
 */
export function droppedIdioms(baseline, list = LEGACY_IDIOMS) {
  const ids = new Set(list.map((i) => i.id))
  const held = new Set(Object.values(baseline?.files ?? {}).flatMap((counts) => Object.keys(counts)))
  return (baseline?.idioms ?? []).filter((id) => !ids.has(id) && held.has(id))
}

/** The next baseline's files: each count falls to what is measured, and rises only with allowGrow. */
export function nextIdiomFiles(baseline, measured, { allowGrow = false } = {}) {
  if (allowGrow) return sortObj(measured)
  const base = baseline?.files ?? {}
  const swapIds = new Set(SWAPS.flat())
  const out = {}
  for (const [file, counts] of Object.entries(base)) {
    const now = measured[file] ?? {}
    const kept = {}
    for (const [id, was] of Object.entries(counts)) {
      if (swapIds.has(id)) continue
      const n = Math.min(was, now[id] ?? 0)
      if (n > 0) kept[id] = n
    }
    // A swap keeps the pair's total; the split follows what is measured.
    for (const [adapter, legacy] of SWAPS) {
      let room = Math.min((counts[adapter] ?? 0) + (counts[legacy] ?? 0), (now[adapter] ?? 0) + (now[legacy] ?? 0))
      for (const id of [adapter, legacy]) {
        const n = Math.min(now[id] ?? 0, room)
        if (n > 0) kept[id] = n
        room -= n
      }
    }
    if (Object.keys(kept).length) out[file] = sortObj(kept)
  }
  return sortObj(out)
}

export function readIdiomBaseline(root) {
  const p = path.join(root, BASELINE_FILE)
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null
}

function writeIdiomBaseline(root, files) {
  fs.writeFileSync(path.join(root, BASELINE_FILE), `${JSON.stringify(baselineOf(files), null, 2)}\n`)
}

/**
 * Compare the committed baseline with the one at the merge base. Only a merge base
 * whose tree has no baseline passes without a comparison. Anything else that stops
 * the read fails: CI's checkout is blobless, so a failed blob fetch must not pass.
 */
export function checkSince(root, ref) {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  let mergeBase
  try {
    mergeBase = git(['merge-base', ref, 'HEAD']).trim()
  } catch {
    console.error(`--since: cannot find the merge base with ${ref}.`)
    return 1
  }
  let atBase
  try {
    // ls-tree reads trees only, which the blobless checkout already has.
    if (!git(['ls-tree', mergeBase, '--', BASELINE_FILE]).trim()) {
      console.log(`--since: ${ref} has no ${BASELINE_FILE} yet; nothing to compare.`)
      return 0
    }
    atBase = JSON.parse(git(['show', `${mergeBase}:${BASELINE_FILE}`]))
  } catch {
    console.error(`--since: cannot read ${BASELINE_FILE} at the merge base ${mergeBase}.`)
    return 1
  }
  const committed = readIdiomBaseline(root)
  if (!committed) {
    console.error(`--since: ${BASELINE_FILE} is missing from this tree.`)
    return 1
  }
  const [was, now] = [atBase.totals.sites, committed.totals.sites]
  if (!sitesGrew(atBase, committed)) {
    console.log(`Authz ratchet: ${was} -> ${now} sites since ${ref}.`)
    return 0
  }
  if (process.env.AUTHZ_RATCHET_GROW_OK === 'true') {
    console.log(`Authz ratchet: ${was} -> ${now} sites since ${ref}, acknowledged by the authz-ratchet-grow label.`)
    return 0
  }
  console.error(`Authz ratchet: ${was} -> ${now} sites since ${ref}. The baseline only falls. Use lib/authz; if the rise is meant (an idiom added to the list), add the authz-ratchet-grow label, then push a commit: a re-run keeps the labels of the event it re-runs.`)
  return 1
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function main(argv) {
  const flag = (f) => argv.includes(f)
  const ri = argv.indexOf('--root')
  const root = path.resolve(ri >= 0 ? argv[ri + 1] : process.cwd())
  const si = argv.indexOf('--since')
  if (si >= 0) return checkSince(root, argv[si + 1])
  const measured = measureIdioms(collectSources(root))

  if (flag('--json')) {
    process.stdout.write(`${JSON.stringify({ totals: totalsOf(measured), files: measured }, null, 2)}\n`)
    return 0
  }

  let baseline = readIdiomBaseline(root)

  if (flag('--seed')) {
    if (baseline) {
      console.error(`--seed refuses: ${BASELINE_FILE} already exists. Use --write.`)
      return 1
    }
    writeIdiomBaseline(root, measured)
    console.log(`Seeded ${BASELINE_FILE}`, totalsOf(measured))
    return 0
  }

  const dropped = droppedIdioms(baseline)
  if (flag('--write')) {
    if (dropped.length) {
      console.error(`--write refuses: idioms removed from the list with sites left: ${dropped.join(', ')}`)
      return 1
    }
    writeIdiomBaseline(root, nextIdiomFiles(baseline, measured, { allowGrow: flag('--allow-grow') }))
    baseline = readIdiomBaseline(root)
  }

  const { added, stale } = idiomDiff(baseline, measured)
  console.log('S5 legacy authorisation idioms', totalsOf(measured))
  const show = (label, list) => {
    if (!list.length) return
    console.log(`\n${label} (${list.length}):`)
    for (const x of list) console.log(`  ${x}`)
  }
  show('NEW sites (ratchet fails; use lib/authz)', added)
  show('Stale baseline entries (run --write)', stale)
  show('Idioms removed from the list with sites left', dropped)
  return flag('--check') && added.length + stale.length + dropped.length ? 1 : 0
}

const invoked = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) process.exitCode = main(process.argv.slice(2))
