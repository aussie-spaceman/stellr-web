// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { laneOf, transformSource } from './events-facade'
import { sanityGetterImports } from '../s5-inventory.mjs'

const run = (src: string, file = 'lib/a.ts') => transformSource(file, src)

describe('events-facade codemod: golden cases', () => {
  const cases: [string, string, string, string?][] = [
    ['a lone getter', "import { getEventBySlug } from '@/lib/sanity'\n", "import { getEventBySlug } from '@/lib/events/repo'\n"],
    [
      'getters beside other exports',
      "import { getAllEvents, getAllCampaigns, getAllNewsPosts } from '@/lib/sanity'\n",
      "import { getAllEvents, getAllCampaigns } from '@/lib/events/repo'\nimport { getAllNewsPosts } from '@/lib/sanity'\n",
    ],
    [
      'a default import beside a getter stays with lib/sanity',
      "import dflt, { getAllEvents } from '@/lib/sanity'\n",
      "import { getAllEvents } from '@/lib/events/repo'\nimport dflt from '@/lib/sanity'\n",
    ],
    [
      'an inline type stays with lib/sanity',
      "import { getEventBySlug, type StellarEvent } from '@/lib/sanity'\n",
      "import { getEventBySlug } from '@/lib/events/repo'\nimport { type StellarEvent } from '@/lib/sanity'\n",
    ],
    ['an alias survives', "import { getEventBySlug as find } from '@/lib/sanity'\n", "import { getEventBySlug as find } from '@/lib/events/repo'\n"],
    ['semicolons and double quotes survive', 'import { getAllEvents } from "@/lib/sanity";\n', 'import { getAllEvents } from "@/lib/events/repo";\n'],
    [
      'a multi-line import',
      "import {\n  getEventBySlug,\n  getEventsBySlugs,\n  urlFor,\n} from '@/lib/sanity'\n",
      "import { getEventBySlug, getEventsBySlugs } from '@/lib/events/repo'\nimport { urlFor } from '@/lib/sanity'\n",
    ],
    ['a sibling relative path', "import { getAllEvents } from './sanity'\n", "import { getAllEvents } from './events/repo'\n"],
    ['a script relative path', "import { getAllEvents } from '../lib/sanity'\n", "import { getAllEvents } from '../lib/events/repo'\n", 'scripts/x.ts'],
    ['a named re-export', "export { getEventsByIds } from '@/lib/sanity'\n", "export { getEventsByIds } from '@/lib/events/repo'\n"],
    [
      'a destructured dynamic import',
      "async function f() { const { getEventsBySlugs } = await import('@/lib/sanity'); return getEventsBySlugs([]) }\n",
      "async function f() { const { getEventsBySlugs } = await import('@/lib/events/repo'); return getEventsBySlugs([]) }\n",
    ],
    [
      'merges into an existing facade import',
      "import { getEventBySlug } from '@/lib/events/repo'\nimport { getAllEvents } from '@/lib/sanity'\nexport const a = 1\n",
      "import { getEventBySlug, getAllEvents } from '@/lib/events/repo'\nexport const a = 1\n",
    ],
  ]

  it.each(cases)('%s', (_name, input, expected, file) => {
    const out = run(input, file)
    expect(out.src).toBe(expected)
    expect(out.manual).toEqual([])
  })

  it.each(cases)('%s: a second run changes nothing', (_name, input, _expected, file) => {
    const once = run(input, file).src
    expect(run(once, file).src).toBe(once)
  })

  it.each(cases)('%s: the ratchet no longer sees a getter import', (_name, input, _expected, file) => {
    const f = file ?? 'lib/a.ts'
    expect(sanityGetterImports(f, run(input, file).src)).toEqual([])
  })

  it('reports which getters moved', () => {
    expect(run("import { getEventsBySlugs, getAllEvents, client } from '@/lib/sanity'\n").moved).toEqual(['getAllEvents', 'getEventsBySlugs'])
  })

  it('leaves every other byte of the file alone', () => {
    const body = "\n// a comment   with odd   spacing\nexport const x = await   getEventBySlug( 'a' )\n\n\n"
    expect(run(`import { getEventBySlug } from '@/lib/sanity'${body}`).src).toBe(`import { getEventBySlug } from '@/lib/events/repo'${body}`)
  })
})

describe('events-facade codemod: what it must not touch', () => {
  it.each([
    ['another export of lib/sanity', "import { client, urlFor } from '@/lib/sanity'\n"],
    ['a type-only import', "import type { StellarEvent } from '@/lib/sanity'\n"],
    ['a type-only import naming a getter', "import type { getAllEvents } from '@/lib/sanity'\n"],
    ['an inline type naming a getter', "import { type getAllEvents, urlFor } from '@/lib/sanity'\n"],
    ['a look-alike module', "import { getEventBySlug } from '@/lib/sanity-helpers'\n"],
    ['the same name from elsewhere', "import { getEventBySlug } from '@/lib/other'\n"],
    ['no import at all', "export const getEventBySlug = () => 'sanity'\n"],
  ])('%s', (_name, src) => {
    const out = run(src)
    expect(out.src).toBe(src)
    expect(out.manual).toEqual([])
  })

  it.each(['lib/sanity.ts', 'lib/events/repo.ts'])('never rewrites %s', (file) => {
    const src = "import { getEventBySlug } from '@/lib/sanity'\n"
    expect(run(src, file).src).toBe(src)
  })

  it.each([
    ['a namespace import', "import * as s from '@/lib/sanity'\ns.getAllEvents()\n", /namespace/],
    ['export *', "export * from '@/lib/sanity'\n", /export \*/],
    ['a dynamic import kept whole', "const d = { ...(await import('../lib/sanity')) }\nd.getEventBySlug('a')\n", /dynamic/],
    ['a dynamic import taking other names too', "const { client, getAllEvents } = await import('@/lib/sanity')\n", /dynamic/],
  ])('reports %s for a hand edit and leaves it', (_name, src, why) => {
    const out = run(src)
    expect(out.src).toBe(src)
    expect(out.manual.join()).toMatch(why)
  })
})

describe('laneOf', () => {
  it('claims the files docs/TENANCY-S5.md gives Lane C', () => {
    for (const f of [
      'app/api/admin/events/[slug]/badges/route.ts',
      'app/(admin)/admin/competitions/page.tsx',
      'lib/refunds/payment-basis.ts',
      'lib/scholarship-offer.ts',
      'lib/survey/admin-auth.ts',
      'lib/event-portal.ts', // unclaimed lib files are Lane C's
    ]) expect(laneOf(f), f).toBe('C')
  })

  it('leaves Lane A and Lane B importers to those lanes', () => {
    for (const f of [
      'app/api/register/group/route.ts',
      'app/(flow)/check-in/[slug]/page.tsx',
      'app/api/volunteer/interest/route.ts',
      'lib/esign/needs-paperwork.ts',
      'lib/check-in-banner.ts',
      'lib/group-billing.ts',
      'lib/survey/events.ts',
    ]) expect(laneOf(f), f).toBe('A')
    for (const f of [
      'app/(public)/page.tsx',
      'app/(member)/campaigns/[slug]/page.tsx',
      'app/sitemap.ts',
      'app/api/cron/event-emails/route.ts',
      'app/api/store/reship/route.ts',
      'lib/survey/run.ts',
      'lib/space-admin.ts',
      'lib/admin-digest.ts',
      'lib/compliance-notify.ts',
      'lib/event-emails/send.ts',
      'lib/training-reminders.ts',
    ]) expect(laneOf(f), f).toBe('B')
  })

  it('has no lane for an operator script, so a lane run never touches one', () => {
    expect(laneOf('scripts/notify-event-waitlist.ts')).toBeNull()
  })

  it('gives lib/events and lib/audit to Lane C, as the plan of record does', () => {
    const plan = readFileSync('docs/TENANCY-S5.md', 'utf8')
    expect(plan).toContain('`lib/events/**`, `lib/audit/**`')
    expect(laneOf('lib/events/sync.ts')).toBe('C')
    expect(laneOf('lib/audit/platform.ts')).toBe('C')
  })
})
