import { readdirSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { TABLE_REGISTRY } from '../lib/tenancy/registry'
import { allowedTenantFiles } from '../lib/tenancy/tenant-surface'
import { importClosureOf, localImportsOf, readRepoFile } from './import-closure'

// What a tenant host can reach of Stellr's social features: community, chat,
// Spaces, cohorts and memberships. A tenant's participants can be 14, and these
// features must stay off tenant hosts (multi-tenancy plan S5, B8). The walk starts
// from the code tenant hosts serve and follows every runtime import, because a
// tenant page reaches a social module through what it reuses.
//
// Four lists: the social modules reached, the first hop into one from a file that
// isn't social, the files naming a social table, and the files opening a Realtime
// channel. The first hops matter because a module stays listed while any chain still
// reaches it, so a new direct import of one shows only as a new first hop.
//
// test/tenant-surface.test.ts holds the result to a baseline that only shrinks, and
// `npx tsx scripts/tenant-surface-baseline.mjs --write` writes it.
//
// The walk sees what a tenant host serves. It cannot see a Stellr-host route acting
// on another tenant's row: test/tenant-surface.test.ts lists those callers by name.

export const BASELINE_FILE = 'test/tenant-surface-baseline.json'

const TREE = 'app/%5Ft'

/** Wrap the tree without being imported by it, so the walk starts from them too. */
const ROOT_BOUNDARY = /^(layout|template|not-found|error|global-error|loading)\.tsx?$/

/** The one allowed way in. It does nothing for another tenant's event, so the walk stops there. */
export const SOCIAL_ENTRY = 'lib/community/event-hooks.ts'

export const SOCIAL_MODULES: readonly RegExp[] = [
  /^lib\/community(\.ts$|-[^/]*\.ts$|\/)/,
  /^lib\/spaces\.ts$/,
  /^lib\/space-[^/]*\.ts$/,
  /^lib\/teacher-spaces\.ts$/,
  /^lib\/event-space-sync\.ts$/,
  /^lib\/event-participation-sync\.ts$/,
  /^lib\/notify\.ts$/,
  /^lib\/mentoring[^/]*\.ts$/,
  /^lib\/coaching[^/]*\.ts$/,
  /^lib\/sessions\.ts$/,
  /^lib\/containers?(-sync)?\.ts$/,
  /^lib\/auto-membership-grant\.ts$/,
  /^lib\/membership-grants\.ts$/,
  // Not social by table, but a registration's writes to the person's shared record
  // and the school directory. lib/community/event-hooks holds them to Stellr's events.
  /^lib\/school-link\.ts$/,
  /^lib\/member-profile-options\.ts$/,
  /^lib\/resource-(upload|finalise|admin)\.ts$/,
  /^components\/community\//,
  /^app\/\(member\)\/community\//,
  /^app\/api\/community\//,
]

const isSocialTableName = (name: string) => /^(community|chat)_[a-z0-9_]+$/.test(name)

// The registry's notes name the product a stellr_only table belongs to. The rest are
// named: event-scoped tables that are Stellr's only in practice (B9's CHECK holds
// them there), and the membership tables, which carry no product note.
const SOCIAL_NOTE = /\b(community|mentoring|coaching|academy)\b/
const NAMED_SOCIAL_TABLES = ['community_resources', 'community_spaces', 'mentoring_cohorts', 'training_modules', 'member_memberships', 'membership_tiers', 'tier_grant_rules']

export const SOCIAL_TABLES: ReadonlySet<string> = new Set([
  ...NAMED_SOCIAL_TABLES,
  ...Object.entries(TABLE_REGISTRY)
    .filter(([t, e]) => t.startsWith('public.') && e.class === 'stellr_only' && (isSocialTableName(t.slice(7)) || SOCIAL_NOTE.test(e.note ?? '')))
    .map(([t]) => t.slice(7)),
])

export interface SourceFacts {
  /** Names a social table. A code string such as 'community_restricted' is not one. */
  namesSocialTable: boolean
  /** Opens a Realtime channel. */
  opensChannel: boolean
}

/**
 * A name with an underscore counts wherever a string has it. A plain word such as
 * `sessions` is also ordinary text, so it counts only as the whole string or an embed.
 */
function stringNamesSocialTable(text: string): boolean {
  for (const match of text.matchAll(/\b[a-z][a-z0-9_]*\b/g)) {
    const word = match[0]
    if (!SOCIAL_TABLES.has(word)) continue
    if (word.includes('_') || text.trim() === word) return true
    if (/^\s*[(!]/.test(text.slice(match.index + word.length))) return true
  }
  return false
}

export function sourceFacts(fileName: string, src: string): SourceFacts {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const facts: SourceFacts = { namesSocialTable: false, opensChannel: false }
  const visit = (node: ts.Node) => {
    if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && stringNamesSocialTable(node.text)) {
      facts.namesSocialTable = true
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      if (method === 'channel') facts.opensChannel = true
      // A table the registry doesn't list yet is still a table when it is queried.
      const first = node.arguments[0]
      if (method === 'from' && first && ts.isStringLiteralLike(first) && isSocialTableName(first.text)) facts.namesSocialTable = true
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return facts
}

export interface TenantSurface {
  modules: string[]
  /** `importer > module`: each first step from a file that isn't social into one that is. */
  edges: string[]
  tableFiles: string[]
  channelFiles: string[]
}

export interface TenantSurfaceMeasure extends TenantSurface {
  /** How the walk reached a file, entry first. */
  way(file: string): string
}

export function measureTenantSurface(entries: readonly string[], read: (rel: string) => string | null): TenantSurfaceMeasure {
  const parents = new Map<string, string>()
  const closure = importClosureOf(entries, read, { stopAt: (f) => f === SOCIAL_ENTRY, parents })
  const out: TenantSurface = { modules: [], edges: [], tableFiles: [], channelFiles: [] }
  const isSocial = (file: string) => file !== SOCIAL_ENTRY && SOCIAL_MODULES.some((re) => re.test(file))
  for (const file of closure) {
    if (file === SOCIAL_ENTRY) continue
    const src = read(file) ?? ''
    if (isSocial(file)) out.modules.push(file)
    else for (const next of new Set(localImportsOf(file, src, read))) if (isSocial(next)) out.edges.push(`${file} > ${next}`)
    const facts = sourceFacts(file, src)
    if (facts.namesSocialTable) out.tableFiles.push(file)
    if (facts.opensChannel) out.channelFiles.push(file)
  }
  const way = (file: string) => {
    const chain = [file]
    for (let at = parents.get(file); at && !chain.includes(at); at = parents.get(at)) chain.unshift(at)
    return chain.join(' > ')
  }
  return { modules: out.modules.sort(), edges: out.edges.sort(), tableFiles: out.tableFiles.sort(), channelFiles: out.channelFiles.sort(), way }
}

/** The tenant tree's own files, what wraps it, and every manifest file allowed on a tenant host. */
export function tenantSurfaceEntries(): string[] {
  const tree = readdirSync(path.join(process.cwd(), TREE), { recursive: true, encoding: 'utf8' })
    .map((rel) => path.posix.join(TREE, rel.split(path.sep).join('/')))
    .filter((rel) => /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel))
  const boundaries = readdirSync(path.join(process.cwd(), 'app')).filter((f) => ROOT_BOUNDARY.test(f)).map((f) => `app/${f}`)
  return [...new Set([...tree, ...boundaries, ...allowedTenantFiles()])].sort()
}

export function measureRepo(): TenantSurfaceMeasure {
  return measureTenantSurface(tenantSurfaceEntries(), readRepoFile)
}

/** What the tree has beyond the baseline, and what the baseline still lists that has gone. */
export function surfaceDiff(baseline: TenantSurface, measured: TenantSurface): { added: string[]; stale: string[] } {
  const added: string[] = []
  const stale: string[] = []
  for (const key of ['modules', 'edges', 'tableFiles', 'channelFiles'] as const) {
    for (const f of measured[key]) if (!baseline[key].includes(f)) added.push(`${key}: ${f}`)
    for (const f of baseline[key]) if (!measured[key].includes(f)) stale.push(`${key}: ${f}`)
  }
  return { added, stale }
}
