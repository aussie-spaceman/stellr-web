// @vitest-environment node
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  SANITY_EVENT_GETTERS,
  collectSources,
  gettersDiff,
  hasRawEventGroq,
  measure,
  nextGetterFiles,
  nextRawEventQueries,
  rawEventQueriesDiff,
  readBaseline,
  sanityEventQueryExports,
  sanityGetterImports,
  summarize,
} from '../scripts/s5-inventory.mjs'
import { laneOf } from '../scripts/codemods/events-facade'
import { auditHandlers } from '../lib/security/audit-coverage'

// S5 data access (C2): events move from Sanity to Postgres behind
// lib/events/repo.ts (S8 needs 0 getter imports left). A new direct import of a
// lib/sanity event getter fails here; a removed one must leave the baseline, so
// the count only falls. A file with its own raw `_type == "event"` GROQ bypasses
// the facade the same way, so those are a second shrink-only list, with the mirror
// writer exempt (RAW_EVENT_GROQ_EXEMPT).

const HOW = 'Import from @/lib/events/repo. A removed import shrinks the ratchet: npx tsx scripts/s5-inventory.mjs --write'

describe('events-facade ratchet', () => {
  let live: ReturnType<typeof measure>
  const baseline = readBaseline(process.cwd(), 'getters')

  beforeAll(() => {
    live = measure(collectSources(process.cwd()))
  }, 120_000)

  it('has a committed baseline', () => {
    expect(baseline).not.toBeNull()
  })

  it('no new direct import of a Sanity event getter', () => {
    expect(gettersDiff(baseline, live.getters).added, HOW).toEqual([])
  })

  it('the baseline lists no import that has gone', () => {
    expect(gettersDiff(baseline, live.getters).stale, HOW).toEqual([])
  })

  it('the baseline count equals the inventory count', () => {
    expect(Object.keys(baseline?.files ?? {}).length).toBe(summarize(live).sanityGetterImporters)
  })

  it('a synthetic new getEventBySlug importer fails the ratchet', () => {
    const file = 'app/(public)/zz-synthetic/page.tsx'
    const src = "import { getEventBySlug } from '@/lib/sanity'\nexport default async function P() { return getEventBySlug('x') }\n"
    const measured = { ...live.getters, ...measure(new Map([[file, src]])).getters }
    expect(gettersDiff(baseline, measured).added).toEqual([`${file}: getEventBySlug`])
  })

  it('a second getter in an already-listed file also fails', () => {
    const [file, gs] = Object.entries(live.getters)[0] as [string, string[]]
    const extra = SANITY_EVENT_GETTERS.find((g: string) => !gs.includes(g)) as string
    const measured = { ...live.getters, [file]: [...gs, extra] }
    expect(gettersDiff(baseline, measured).added).toEqual([`${file}: ${extra}`])
  })

  it('no new file holds raw event GROQ, and none has gone unrecorded', () => {
    const { added, stale } = rawEventQueriesDiff(baseline, live.rawEventQueries)
    expect(added, HOW).toEqual([])
    expect(stale, HOW).toEqual([])
    expect(baseline?.rawEventQueries).toContain('lib/locations.ts')
  })

  it('a synthetic new raw event query fails the ratchet', () => {
    const file = 'lib/zz-synthetic.ts'
    const src = "import { client } from '@/lib/sanity'\nexport const a = () => client.fetch('*[_type == \"event\"]{ _id }')\n"
    const measured = [...live.rawEventQueries, ...measure(new Map([[file, src]])).rawEventQueries]
    expect(rawEventQueriesDiff(baseline, measured).added).toEqual([file])
  })

  it('the getter list is everything in lib/sanity.ts that queries event documents, whatever its name', () => {
    const src = readFileSync('lib/sanity.ts', 'utf8')
    expect(sanityEventQueryExports(src)).toEqual([...SANITY_EVENT_GETTERS].sort())
  })

  it('a new event query in lib/sanity.ts under any name fails that check', () => {
    const src = 'export async function listThings() { return client.fetch(`*[_type == "event"]{ _id }`) }\nexport async function news() { return client.fetch(`*[_type == "newsPost"]`) }\n'
    expect(sanityEventQueryExports(src)).toEqual(['listThings'])
  })

  it('the facade fronts every getter', () => {
    const src = readFileSync('lib/events/repo.ts', 'utf8')
    for (const g of SANITY_EVENT_GETTERS as string[]) expect(src, g).toMatch(new RegExp(`export async function ${g}\\(`))
  })

  it('the facade imports lib/sanity and nothing else, so a plain read loads no database client', () => {
    const src = readFileSync('lib/events/repo.ts', 'utf8')
    const specs = [...src.matchAll(/(?:from\s+|import\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1])
    expect(specs).toEqual(['@/lib/sanity'])
  })

  it('every file left in the baseline has a lane to move it, so the count can reach 0', () => {
    expect(Object.keys(baseline?.files ?? {}).filter((f) => laneOf(f) === null)).toEqual([])
  })

  it.each(SANITY_EVENT_GETTERS as string[])('a GET that reads through the facade %s is not a GET that writes', (g) => {
    const file = 'app/api/zz-synthetic/route.ts'
    const src = `import { ${g} } from '@/lib/events/repo'\nexport async function GET() { return Response.json(await ${g}('x')) }\n`
    const project = new Map([...collectSources(process.cwd()), [file, src]])
    expect(auditHandlers(file, src, project)).toEqual([])
  })

  it('the gate does follow a GET into the mirrored read, so that check above has teeth', () => {
    const file = 'app/api/zz-synthetic/route.ts'
    const src = "import { getEventBySlugMirrored } from '@/lib/events/mirror'\nexport async function GET() { return Response.json(await getEventBySlugMirrored('x', opts)) }\n"
    const project = new Map([...collectSources(process.cwd()), [file, src]])
    expect(auditHandlers(file, src, project).map((h) => h.kind)).toEqual(['get_mutation'])
  })
})

describe('sanityGetterImports', () => {
  it('sees alias, relative, namespace, re-export and dynamic forms', () => {
    expect(sanityGetterImports('lib/a.ts', "import { getEventBySlug as g } from './sanity'")).toEqual(['getEventBySlug'])
    expect(sanityGetterImports('scripts/a.ts', "import { getAllEvents } from '../lib/sanity'")).toEqual(['getAllEvents'])
    expect(sanityGetterImports('lib/a.ts', "import * as s from '@/lib/sanity'\ns.getFeaturedEvents()")).toEqual(['getFeaturedEvents'])
    expect(sanityGetterImports('lib/a.ts', "export { getEventsByIds } from '@/lib/sanity'")).toEqual(['getEventsByIds'])
    expect(sanityGetterImports('lib/a.ts', "async function f() { const { getEventsBySlugs } = await import('@/lib/sanity'); return getEventsBySlugs([]) }")).toEqual(['getEventsBySlugs'])
    expect(sanityGetterImports('scripts/a.ts', "async function f() { return { ...(await import('../lib/sanity')) } }\nconst d = await f(); d.getAllEvents()")).toEqual(['getAllEvents'])
  })

  it('ignores the facade, other lib/sanity exports and look-alike modules', () => {
    expect(sanityGetterImports('lib/a.ts', "import { getEventBySlug } from '@/lib/events/repo'")).toEqual([])
    expect(sanityGetterImports('lib/a.ts', "import { client, urlFor } from '@/lib/sanity'")).toEqual([])
    expect(sanityGetterImports('lib/a.ts', "import { getEventBySlug } from '@/lib/sanity-helpers'")).toEqual([])
    expect(sanityGetterImports('lib/events/repo.ts', "import { getEventBySlug } from '@/lib/sanity'")).toEqual([])
    expect(sanityGetterImports('lib/sanity.ts', 'export async function getEventBySlug() {}')).toEqual([])
  })
})

describe('hasRawEventGroq', () => {
  it('sees a string, a template and the spacing variants', () => {
    expect(hasRawEventGroq('lib/a.ts', "const q = '*[_type == \"event\"]'")).toBe(true)
    expect(hasRawEventGroq('lib/a.ts', "const q = `*[_type=='event' && slug == $s]`")).toBe(true)
    expect(hasRawEventGroq('lib/a.ts', 'const q = `*[_type == "event" && slug == "${s}"]`')).toBe(true)
  })

  it('ignores a comment, another document type, the facade and the mirror writer', () => {
    expect(hasRawEventGroq('lib/a.ts', '// *[_type == "event"]\nexport const a = 1')).toBe(false)
    expect(hasRawEventGroq('lib/a.ts', "const q = '*[_type == \"eventSeries\"]'")).toBe(false)
    const q = "const q = '*[_type == \"event\"]'"
    for (const f of ['lib/sanity.ts', 'lib/events/repo.ts', 'lib/events/sync.ts']) expect(hasRawEventGroq(f, q), f).toBe(false)
  })

  it('the list shrinks by default and grows only when told to', () => {
    expect(nextRawEventQueries({ rawEventQueries: ['lib/a.ts', 'lib/gone.ts'] }, ['lib/a.ts', 'lib/new.ts'])).toEqual(['lib/a.ts'])
    expect(nextRawEventQueries({ rawEventQueries: ['lib/a.ts'] }, ['lib/a.ts', 'lib/new.ts'], { allowGrow: true })).toEqual(['lib/a.ts', 'lib/new.ts'])
  })
})

describe('baseline writer', () => {
  it('shrinks by default and grows only when told to', () => {
    const baseline = { files: { 'lib/a.ts': ['getAllEvents', 'getEventBySlug'], 'lib/gone.ts': ['getAllEvents'] } }
    const measured = { 'lib/a.ts': ['getAllEvents', 'getFeaturedEvents'], 'lib/new.ts': ['getEventBySlug'] }
    expect(nextGetterFiles(baseline, measured)).toEqual({ 'lib/a.ts': ['getAllEvents'] })
    expect(nextGetterFiles(baseline, measured, { allowGrow: true })).toEqual(measured)
  })
})
