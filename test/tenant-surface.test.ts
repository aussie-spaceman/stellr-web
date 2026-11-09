// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { allowedTenantFiles } from '@/lib/tenancy/tenant-surface'
import { importClosureOf, readRepoFile, runtimeImports } from './import-closure'
import {
  BASELINE_FILE,
  SOCIAL_ENTRY,
  SOCIAL_MODULES,
  SOCIAL_TABLES,
  measureRepo,
  measureTenantSurface,
  sourceFacts,
  surfaceDiff,
  tenantSurfaceEntries,
  type TenantSurface,
} from './tenant-surface-measure'

// A tenant host may not reach Stellr's social features, by import, by table name or
// by Realtime channel (multi-tenancy plan S5, B8). What it reaches today is in the
// baseline. That list only falls: a new entry fails here, and a removed one must
// leave the baseline. lib/community/event-hooks.ts is the allowed way in.

const HOW = 'Go through lib/community/event-hooks, or stop importing it. A removal shrinks the baseline: npx tsx scripts/tenant-surface-baseline.mjs --write'

// The size of the baseline. Lower these as it falls. Raising one takes a visible edit
// to this file, which .github/CODEOWNERS sends for review.
const MAX_MODULES = 10
const MAX_EDGES = 37
const MAX_TABLE_FILES = 17
const MAX_CHANNEL_FILES = 0

const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as TenantSurface

/** Baseline problems the size limits catch, with no file reading. */
function overLimit(b: TenantSurface): string[] {
  const out: string[] = []
  if (b.modules.length > MAX_MODULES) out.push(`modules ${b.modules.length} > ${MAX_MODULES}`)
  if (b.edges.length > MAX_EDGES) out.push(`edges ${b.edges.length} > ${MAX_EDGES}`)
  if (b.tableFiles.length > MAX_TABLE_FILES) out.push(`tableFiles ${b.tableFiles.length} > ${MAX_TABLE_FILES}`)
  if (b.channelFiles.length > MAX_CHANNEL_FILES) out.push(`channelFiles ${b.channelFiles.length} > ${MAX_CHANNEL_FILES}`)
  return out
}

const fixture = (files: Record<string, string>) => (rel: string) => files[rel] ?? null

/** Files under app/ and lib/ that load the name from the module, with a dynamic import counting as every name. */
function runtimeImportersOf(moduleSuffix: string, name: string): string[] {
  const found: string[] = []
  for (const root of ['app', 'lib']) {
    for (const rel of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
      const file = `${root}/${rel}`
      if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue
      const src = readFileSync(file, 'utf8')
      if (!src.includes(moduleSuffix)) continue
      const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true)
      let loads = false
      const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.endsWith(moduleSuffix) && !node.importClause?.isTypeOnly) {
          const named = node.importClause?.namedBindings
          if (named && ts.isNamedImports(named)) {
            loads ||= named.elements.some((el) => !el.isTypeOnly && (el.propertyName ?? el.name).text === name)
          } else loads = true
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const first = node.arguments[0]
          loads ||= Boolean(first && ts.isStringLiteralLike(first) && first.text.endsWith(moduleSuffix))
        }
        ts.forEachChild(node, visit)
      }
      visit(sf)
      if (loads) found.push(file)
    }
  }
  return found.sort()
}

describe('the tenant surface', () => {
  const live = measureRepo()
  const entries = tenantSurfaceEntries()

  it('starts from real files, so the walk cannot pass by reaching nothing', () => {
    expect(allowedTenantFiles().length).toBeGreaterThan(30)
    expect(entries).toContain('app/%5Ft/[tenant]/page.tsx')
    expect(entries).toContain('app/api/register/individual/route.ts')
    expect(entries.filter((f) => readRepoFile(f) === null)).toEqual([])
  })

  it('starts from what wraps the tree too, which nothing imports', () => {
    expect(entries).toEqual(expect.arrayContaining(['app/%5Ft/[tenant]/layout.tsx', 'app/global-error.tsx', 'app/global-not-found.tsx']))
  })

  it('reaches no new social module, table name or Realtime channel', () => {
    const { added } = surfaceDiff(baseline, live)
    const shown = added.map((line) => {
      const file = line.slice(line.indexOf(': ') + 2)
      return `${line} (${live.way(file)})`
    })
    expect(shown, HOW).toEqual([])
  })

  it('the baseline lists nothing the tree no longer reaches', () => {
    expect(surfaceDiff(baseline, live).stale, HOW).toEqual([])
  })

  it('the baseline cannot grow', () => {
    expect(overLimit(baseline)).toEqual([])
  })

  it('opens no Realtime channel at all', () => {
    expect(live.channelFiles).toEqual([])
  })

  it('the one way in is a file, and is on no list', () => {
    expect(readRepoFile(SOCIAL_ENTRY)).not.toBeNull()
    expect(SOCIAL_MODULES.some((re) => re.test(SOCIAL_ENTRY))).toBe(true)
    expect(live.modules).not.toContain(SOCIAL_ENTRY)
    expect(live.edges.filter((e) => e.endsWith(SOCIAL_ENTRY))).toEqual([])
  })

  it('lib/member-session imports nothing social directly', () => {
    const social = runtimeImports('lib/member-session.ts', readRepoFile('lib/member-session.ts') ?? '')
      .filter((spec) => spec.startsWith('@/'))
      .map((spec) => `${spec.slice(2)}.ts`)
      .filter((file) => SOCIAL_MODULES.some((re) => re.test(file)))
    expect(social).toEqual([])
  })

  // When this fails because the chain was cut, the split has started to pay: pages can
  // move to lib/member-session and the baseline can fall. Update this test then.
  it('lib/member-session reaches the community only through lib/pending-consent', () => {
    const social = (files: Set<string>) => [...files].filter((f) => SOCIAL_MODULES.some((re) => re.test(f)))
    const whole = importClosureOf(['lib/member-session.ts'], readRepoFile)
    const cut = importClosureOf(['lib/member-session.ts'], readRepoFile, { stopAt: (f) => f === 'lib/pending-consent.ts' })
    expect(social(whole)).toContain('lib/community.ts')
    expect(social(cut)).toEqual([])
  })

  // The walk cannot see these: they act on a registration by id from Stellr's own
  // host, whatever tenant owns its event. recordEventParticipation does Stellr's
  // community and grant work unconditionally, so a new caller needs an event hook
  // or a tenant check of its own, and a visible edit here.
  it('only known files call the participation writers', () => {
    expect(runtimeImportersOf('lib/event-participation-sync', 'recordEventParticipation')).toEqual([
      'lib/community/event-hooks.ts',
      // A7 moves these to the hook.
      'lib/registration/group-join/stellr-hooks.ts',
      'lib/registration/group/stellr-hooks.ts',
      'lib/registration/individual/stellr-hooks.ts',
    ])
    // Refuses another tenant's row itself: see its test in lib/community/event-hooks.test.ts.
    expect(runtimeImportersOf('lib/event-participation-sync', 'recordEventParticipationForRegistration')).toEqual([
      'lib/group-participant-add.ts',
      'lib/sheet-participant-sync.ts',
    ])
  })
})

describe('the check itself', () => {
  const PAGE = 'app/(stellr)/(flow)/register/page.tsx'

  it('fires on the chat panel imported by a flow page, and says how it got there', () => {
    const read = fixture({
      [PAGE]: "import { Body } from '@/components/registration/Body'\nexport default Body\n",
      'components/registration/Body.tsx': "export { ChatPanel as Body } from '@/components/community/ChatPanel'\n",
      'components/community/ChatPanel.tsx': 'export const ChatPanel = 1\n',
    })
    const found = measureTenantSurface([PAGE], read)
    expect(found.modules).toEqual(['components/community/ChatPanel.tsx'])
    expect(found.way('components/community/ChatPanel.tsx')).toBe(
      `${PAGE} > components/registration/Body.tsx > components/community/ChatPanel.tsx`,
    )
  })

  it('fires on the real chat panel, for its import and its Realtime channel', () => {
    const found = measureTenantSurface(['components/community/ChatPanel.tsx'], readRepoFile)
    expect(found.modules).toContain('components/community/ChatPanel.tsx')
    expect(found.channelFiles).toContain('components/community/ChatPanel.tsx')
  })

  it('fires on a planted table read in a file that is not social by name', () => {
    const read = fixture({
      [PAGE]: "import { load } from '@/lib/plain'\nexport default load\n",
      'lib/plain.ts': "export const load = (db) => db.from('community_posts').select('id')\n",
    })
    expect(measureTenantSurface([PAGE], read).tableFiles).toEqual(['lib/plain.ts'])
  })

  it('counts a table named through a variable, an embed or a template', () => {
    expect(sourceFacts('a.ts', "const t = 'chat_messages'\ndb.from(t)\n").namesSocialTable).toBe(true)
    expect(sourceFacts('a.ts', "db.from('members').select('id, community_spaces(name)')\n").namesSocialTable).toBe(true)
    expect(sourceFacts('a.ts', 'db.from("members").select(`id, ${x}, community_posts(id)`)\n').namesSocialTable).toBe(true)
    expect(sourceFacts('a.ts', "db.from('community_not_registered_yet')\n").namesSocialTable).toBe(true)
  })

  it('does not count a comment, a code string, or a storage bucket', () => {
    expect(sourceFacts('a.ts', "// .from('community_posts')\nexport const a = 1\n").namesSocialTable).toBe(false)
    expect(sourceFacts('a.ts', "export const code = 'community_restricted'\n").namesSocialTable).toBe(false)
    expect(sourceFacts('a.ts', "db.storage.from('community-resources')\n").namesSocialTable).toBe(false)
  })

  it('knows the cohort, mentoring, coaching, membership and training tables', () => {
    for (const table of ['cohort_members', 'mentoring_cohorts', 'coaching_requests', 'member_memberships', 'membership_tiers', 'training_modules', 'training_items', 'sessions']) {
      expect(SOCIAL_TABLES.has(table), table).toBe(true)
    }
    expect(sourceFacts('a.ts', "db.from('cohort_members').insert({})\n").namesSocialTable).toBe(true)
    expect(sourceFacts('a.ts', "db.from('coaching_requests').insert({})\n").namesSocialTable).toBe(true)
    expect(sourceFacts('a.ts', "db.from('members').select('id, member_memberships(tier_id)')\n").namesSocialTable).toBe(true)
  })

  it('leaves out the tables a tenant event really uses, and the person record', () => {
    for (const table of ['members', 'participants', 'registrations', 'event_participations', 'schools', 'member_schools', 'member_activity_log', 'agreements']) {
      expect(SOCIAL_TABLES.has(table), table).toBe(false)
    }
  })

  it('counts a plain-word table only as a table', () => {
    expect(sourceFacts('a.ts', "db.from('sessions').select('id')\n").namesSocialTable).toBe(true)
    expect(sourceFacts('a.ts', "db.from('members').select('id, sessions(id)')\n").namesSocialTable).toBe(true)
    expect(sourceFacts('a.ts', "export const t = 'Your coaching sessions start soon'\n").namesSocialTable).toBe(false)
    expect(sourceFacts('a.ts', "export const u = '/account/sessions'\n").namesSocialTable).toBe(false)
  })

  it('fires on a new direct import of a module the baseline already lists', () => {
    const page = 'app/(stellr)/(flow)/register/[slug]/page.tsx'
    for (const [spec, file] of [
      ['@/lib/space-inheritance', 'lib/space-inheritance.ts'],
      ['@/lib/membership-grants', 'lib/membership-grants.ts'],
      ['@/lib/event-participation-sync', 'lib/event-participation-sync.ts'],
      ['@/lib/spaces', 'lib/spaces.ts'],
      ['@/lib/school-link', 'lib/school-link.ts'],
    ]) {
      expect(baseline.modules).toContain(file)
      const planted = (rel: string) => {
        const src = readRepoFile(rel)
        return rel === page ? `import * as planted from '${spec}'\nexport { planted }\n${src}` : src
      }
      expect(surfaceDiff(baseline, measureTenantSurface(tenantSurfaceEntries(), planted))).toMatchObject({
        added: [`edges: ${page} > ${file}`],
        stale: [],
      })
    }
    // Five walks over the whole surface, which takes seconds on a loaded machine.
  }, 60_000)

  it('a hook call adds no edge, however many social modules the hook imports', () => {
    const read = fixture({
      [PAGE]: "import { y } from '@/lib/community/event-hooks'\nexport default y\n",
      [SOCIAL_ENTRY]: "import { x } from '@/lib/space-inheritance'\nexport const y = x\n",
      'lib/space-inheritance.ts': 'export const x = 1\n',
    })
    expect(measureTenantSurface([PAGE], read).edges).toEqual([])
  })

  it('counts one edge per step in, and none between two social modules', () => {
    const read = fixture({
      [PAGE]: "import { a } from '@/lib/spaces'\nimport { b } from '@/lib/spaces'\nexport { a, b }\n",
      'lib/spaces.ts': "export { c as a, c as b } from '@/lib/notify'\n",
      'lib/notify.ts': 'export const c = 1\n',
    })
    expect(measureTenantSurface([PAGE], read).edges).toEqual([`${PAGE} > lib/spaces.ts`])
  })

  it('fires on a Realtime channel, and not on the word in a comment', () => {
    expect(sourceFacts('a.ts', "db.channel('room').subscribe()\n").opensChannel).toBe(true)
    expect(sourceFacts('a.ts', '// db.channel(x)\nexport const a = 1\n').opensChannel).toBe(false)
  })

  it('follows a dynamic import, and not a type-only one', () => {
    const social = 'lib/spaces.ts'
    const dynamic = fixture({ [PAGE]: "export const f = () => import('@/lib/spaces')\n", [social]: 'export const a = 1\n' })
    const typeOnly = fixture({ [PAGE]: "import type { A } from '@/lib/spaces'\nexport type B = A\n", [social]: 'export type A = 1\n' })
    expect(measureTenantSurface([PAGE], dynamic).modules).toEqual([social])
    expect(measureTenantSurface([PAGE], typeOnly).modules).toEqual([])
  })

  it('stops at event-hooks, and only there', () => {
    const files = {
      [SOCIAL_ENTRY]: "import { x } from '@/lib/space-inheritance'\nexport const y = x\n",
      'lib/space-inheritance.ts': "export const x = (db) => db.from('community_space_members')\n",
    }
    const viaHook = { ...files, [PAGE]: "import { y } from '@/lib/community/event-hooks'\nexport default y\n" }
    const direct = { ...files, [PAGE]: "import { x } from '@/lib/space-inheritance'\nexport default x\n" }
    const sibling = {
      [PAGE]: "import { z } from '@/lib/community/other'\nexport default z\n",
      'lib/community/other.ts': 'export const z = 1\n',
    }
    expect(measureTenantSurface([PAGE], fixture(viaHook))).toMatchObject({ modules: [], tableFiles: [] })
    expect(measureTenantSurface([PAGE], fixture(direct))).toMatchObject({
      modules: ['lib/space-inheritance.ts'],
      tableFiles: ['lib/space-inheritance.ts'],
    })
    expect(measureTenantSurface([PAGE], fixture(sibling)).modules).toEqual(['lib/community/other.ts'])
  })

  it('a planted file fails the ratchet, and a removed one shows as stale', () => {
    const planted = { ...baseline, modules: [...baseline.modules, 'components/community/ChatPanel.tsx'].sort() }
    expect(surfaceDiff(baseline, planted).added).toEqual(['modules: components/community/ChatPanel.tsx'])
    const [first, ...rest] = baseline.modules
    expect(surfaceDiff(baseline, { ...baseline, modules: rest }).stale).toEqual([`modules: ${first}`])
  })

  it('a baseline raised without raising the limit fails', () => {
    const raised = { ...baseline, modules: [...baseline.modules, 'components/community/ChatPanel.tsx'] }
    expect(overLimit(raised)).toEqual([`modules ${MAX_MODULES + 1} > ${MAX_MODULES}`])
    expect(overLimit({ ...baseline, edges: [...baseline.edges, 'a > b'] })).toEqual([`edges ${MAX_EDGES + 1} > ${MAX_EDGES}`])
    expect(overLimit({ ...baseline, channelFiles: ['x.ts'] })).toEqual([`channelFiles 1 > ${MAX_CHANNEL_FILES}`])
  })
})
