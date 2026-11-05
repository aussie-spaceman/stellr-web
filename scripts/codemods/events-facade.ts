// Events-facade codemod (docs/TENANCY-S5.md, C8; A7 and B19 run it on their own files).
//
// Moves imports of the Sanity event getters from lib/sanity to lib/events/repo.
// Only the import changes: every call site, alias and other lib/sanity import stays
// as it was, so a file's behaviour is whatever the facade's pass-through gives it.
//
// Built on the TypeScript compiler API, as scripts/s5-inventory.mjs is. It edits
// text at the node's position rather than reprinting, so the rest of a file keeps
// its bytes. A second run changes nothing.
//
// Usage:
//   npx tsx scripts/codemods/events-facade.ts --lane C            what would change
//   npx tsx scripts/codemods/events-facade.ts --lane C --write    change it
//   npx tsx scripts/codemods/events-facade.ts --file <path> [--write]
//       a file by path, including one no lane owns
//
// A lane run touches only the files that lane owns, by the ownership in
// docs/TENANCY-S5.md, "Lanes and file ownership". After --write, shrink the ratchet:
//   npx tsx scripts/s5-inventory.mjs --write
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { resolveModule } from '../../lib/security/route-ast'
import { SANITY_EVENT_GETTERS, collectSources } from '../s5-inventory.mjs'

const FACADE = 'lib/events/repo'
const SANITY = 'lib/sanity'
/** The two modules this codemod must never rewrite: the getters' home and the facade itself. */
const EXEMPT = [`${SANITY}.ts`, `${FACADE}.ts`]

export type Lane = 'A' | 'B' | 'C'

const LANE_A: RegExp[] = [
  /^app\/api\/register\//,
  /^app\/\(flow\)\//,
  /^app\/\(public\)\/credentials\//,
  /^app\/api\/members\/teams\//,
  /^app\/api\/(check-in|check-in-desk|sign|survey|credentials|team-profile|volunteer|consent|uploads)\//,
  /^app\/api\/(stripe|webhooks)\//,
  /^lib\/registration\//,
  /^lib\/(registration-eligibility|registration-checkout|group-billing|individual-payment|group-registration-setup|sheet-participant-sync|age|pending-consent|guardian-consent)\.ts$/,
  /^lib\/esign\//,
  /^lib\/credentials[^/]*\.ts$/,
  /^lib\/check-in[^/]*\.ts$/,
]

const LANE_B_LIB: RegExp[] = [
  /^lib\/(csp|request-nonce|private-routes|analytics)\.ts$/,
  /^lib\/tenancy\/(host|host-pure|tenant-surface|request-tenant|stellr-scope|registry)\.ts$/,
  /^lib\/community(\.ts$|\/)/,
  /^lib\/(member-session|event-participation-sync|auto-membership-grant|notify|email|email-budget)\.ts$/,
  /^lib\/event-emails\//,
  /^lib\/(event-space-sync|resource-upload|resource-finalise|mentoring|coaching|container-sync)\.ts$/,
  /^lib\/spaces[^/]*\.ts$/,
  /^lib\/space-[^/]*\.ts$/,
  /^lib\/(cron|cron-runs|cron-tenants|cron-scope)\.ts$/,
  /^lib\/(admin-digest|compliance-notify|membership-grants|training-reminders)\.ts$/,
  /^lib\/survey\/(run|retention)\.ts$/,
  /^lib\/team-profile\/store\.ts$/,
  /^lib\/rate-limit[^/]*\.ts$/,
]

/** The lane that owns this file, or null for one no lane claims (an operator script, say). */
export function laneOf(file: string): Lane | null {
  if (/^app\/api\/admin\//.test(file) || /^app\/\(admin\)\//.test(file)) return 'C'
  if (file === 'app/(member)/layout.tsx' || file === 'app/api/store/returns/route.ts') return 'C'
  if (file === 'lib/survey/admin-auth.ts') return 'C'
  if (LANE_A.some((r) => r.test(file))) return 'A'
  if (LANE_B_LIB.some((r) => r.test(file))) return 'B'
  // lib/survey/** and lib/team-profile/** that the two lists above did not take are Lane A's.
  if (/^lib\/(survey|team-profile)\//.test(file)) return 'A'
  // Any other lib file belongs to Lane C, by the plan's rule for unclaimed lib files.
  if (file.startsWith('lib/')) return 'C'
  // Every other page and non-admin route is Lane B's: public, auth, member, the sitemap.
  if (file.startsWith('app/') || file.startsWith('components/analytics/') || file === 'proxy.ts') return 'B'
  return null
}

function parse(file: string, src: string): ts.SourceFile {
  return ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
}

/** How this file should name the facade, in the style it named lib/sanity. */
function facadeSpecifier(file: string, sanitySpec: string): string {
  if (sanitySpec.startsWith('@/')) return `@/${FACADE}`
  const rel = path.posix.relative(path.posix.dirname(file), FACADE)
  return rel.startsWith('.') ? rel : `./${rel}`
}

const isGetter = (name: string) => (SANITY_EVENT_GETTERS as string[]).includes(name)

function specOf(node: ts.Expression | undefined): string | null {
  return node && ts.isStringLiteral(node) ? node.text : null
}

/** The first statement importing values by name from the facade, to add to rather than repeat. */
function existingFacadeImport(file: string, sf: ts.SourceFile): ts.ImportDeclaration | null {
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || s.importClause?.isTypeOnly) continue
    const spec = specOf(s.moduleSpecifier)
    const named = s.importClause?.namedBindings
    if (spec && resolveModule(file, spec) === FACADE && named && ts.isNamedImports(named)) return s
  }
  return null
}

export interface Transform {
  /** The file's new source; the same string when nothing moved. */
  src: string
  /** The getters now taken from the facade. */
  moved: string[]
  /** Forms the codemod will not guess at; each needs a plain edit. */
  manual: string[]
}

/** Move this file's event-getter imports from lib/sanity to the facade. */
export function transformSource(file: string, src: string): Transform {
  if (EXEMPT.includes(file) || !src.includes('sanity')) return { src, moved: [], manual: [] }
  const sf = parse(file, src)
  const isSanity = (spec: string | null): spec is string => !!spec && resolveModule(file, spec) === SANITY
  const edits: { start: number; end: number; text: string }[] = []
  const moved = new Set<string>()
  const manual: string[] = []
  const quote = (node: ts.Node) => node.getText(sf).charAt(0)
  const semi = (node: ts.Node) => (node.getText(sf).endsWith(';') ? ';' : '')
  const merged = existingFacadeImport(file, sf)
  const mergeNames: string[] = []

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const spec = specOf(stmt.moduleSpecifier)
      if (!isSanity(spec) || stmt.importClause?.isTypeOnly) continue
      const clause = stmt.importClause
      const named = clause?.namedBindings
      if (named && ts.isNamespaceImport(named)) {
        const local = named.name.text
        const used = (SANITY_EVENT_GETTERS as string[]).filter((g) => new RegExp(`\\b${local}\\.${g}\\b`).test(src))
        if (used.length) manual.push(`namespace import of lib/sanity uses ${used.join(', ')}`)
        continue
      }
      if (!named || !ts.isNamedImports(named)) continue
      const getters = named.elements.filter((el) => !el.isTypeOnly && isGetter((el.propertyName ?? el.name).text))
      if (!getters.length) continue
      for (const el of getters) moved.add((el.propertyName ?? el.name).text)
      const rest = named.elements.filter((el) => !getters.includes(el)).map((el) => el.getText(sf))
      const q = quote(stmt.moduleSpecifier)
      const end = semi(stmt)
      const names = getters.map((el) => el.getText(sf))
      const lines: string[] = []
      if (merged) mergeNames.push(...names)
      else lines.push(`import { ${names.join(', ')} } from ${q}${facadeSpecifier(file, spec)}${q}${end}`)
      const dflt = clause?.name?.text
      if (rest.length || dflt) {
        const parts = [dflt, rest.length ? `{ ${rest.join(', ')} }` : null].filter(Boolean)
        lines.push(`import ${parts.join(', ')} from ${q}${spec}${q}${end}`)
      }
      const start = stmt.getStart(sf)
      // A statement that moves whole into an existing facade import leaves no blank line behind.
      const stop = lines.length ? stmt.getEnd() : src.indexOf('\n', stmt.getEnd()) + 1 || stmt.getEnd()
      edits.push({ start, end: stop, text: lines.join('\n') })
    } else if (ts.isExportDeclaration(stmt)) {
      const spec = specOf(stmt.moduleSpecifier)
      if (!isSanity(spec) || stmt.isTypeOnly) continue
      if (!stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) {
        manual.push('`export *` from lib/sanity')
        continue
      }
      const getters = stmt.exportClause.elements.filter((el) => !el.isTypeOnly && isGetter((el.propertyName ?? el.name).text))
      if (!getters.length) continue
      for (const el of getters) moved.add((el.propertyName ?? el.name).text)
      const rest = stmt.exportClause.elements.filter((el) => !getters.includes(el)).map((el) => el.getText(sf))
      const q = quote(stmt.moduleSpecifier as ts.Expression)
      const end = semi(stmt)
      const lines = [`export { ${getters.map((el) => el.getText(sf)).join(', ')} } from ${q}${facadeSpecifier(file, spec)}${q}${end}`]
      if (rest.length) lines.push(`export { ${rest.join(', ')} } from ${q}${spec}${q}${end}`)
      edits.push({ start: stmt.getStart(sf), end: stmt.getEnd(), text: lines.join('\n') })
    }
  }

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const spec = specOf(n.arguments[0])
      if (isSanity(spec)) {
        let p: ts.Node = n.parent
        while (ts.isAwaitExpression(p) || ts.isParenthesizedExpression(p)) p = p.parent
        const pattern = ts.isVariableDeclaration(p) && ts.isObjectBindingPattern(p.name) ? p.name : null
        const keys = pattern?.elements.map((el) => el.propertyName ?? el.name) ?? []
        const names = keys.filter(ts.isIdentifier).map((k) => k.text)
        const all = pattern !== null && names.length === keys.length && !pattern.elements.some((el) => el.dotDotDotToken)
        if (all && names.length && names.every(isGetter)) {
          names.forEach((g) => moved.add(g))
          const arg = n.arguments[0]
          const q = quote(arg)
          edits.push({ start: arg.getStart(sf), end: arg.getEnd(), text: `${q}${facadeSpecifier(file, spec)}${q}` })
        } else if (all ? names.some(isGetter) : (SANITY_EVENT_GETTERS as string[]).some((g) => new RegExp(`\\b${g}\\b`).test(src))) {
          manual.push('dynamic import of lib/sanity that takes more than event getters')
        }
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)

  if (merged && mergeNames.length) {
    const named = merged.importClause?.namedBindings as ts.NamedImports
    const have = new Set(named.elements.map((el) => el.getText(sf)))
    const add = mergeNames.filter((n) => !have.has(n))
    if (add.length) {
      const list = [...named.elements.map((el) => el.getText(sf)), ...add].join(', ')
      edits.push({ start: named.getStart(sf), end: named.getEnd(), text: `{ ${list} }` })
    }
  }

  let out = src
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return { src: out, moved: [...moved].sort(), manual }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function main(argv: string[]): number {
  const value = (flag: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const lane = value('--lane')
  const one = value('--file')
  const write = argv.includes('--write')
  if ((!lane && !one) || (lane && !['A', 'B', 'C'].includes(lane))) {
    console.error('Name what to change: --lane A|B|C, or --file <path>.')
    return 1
  }
  const root = process.cwd()
  const sources: Map<string, string> = collectSources(root)
  const files = one ? [one.split(path.sep).join('/')] : [...sources.keys()].filter((f) => laneOf(f) === lane)
  let changed = 0
  let needsHand = 0
  for (const file of files) {
    const src = sources.get(file) ?? fs.readFileSync(path.join(root, file), 'utf8')
    const t = transformSource(file, src)
    for (const m of t.manual) {
      needsHand += 1
      console.log(`MANUAL ${file}: ${m}`)
    }
    if (t.src === src) continue
    changed += 1
    console.log(`${write ? 'changed' : 'would change'} ${file}: ${t.moved.join(', ')}`)
    if (write) fs.writeFileSync(path.join(root, file), t.src)
  }
  console.log(`${changed} file(s) ${write ? 'changed' : 'to change'}, ${needsHand} form(s) to edit by hand.`)
  return 0
}

const invoked = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) process.exitCode = main(process.argv.slice(2))
