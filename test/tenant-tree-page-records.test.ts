// @vitest-environment node
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { isValidElement, type ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hashToken } from '@/lib/survey/tokens'

// Each tenant page against a real tenant check and real record checks, over a small
// in-memory database. A's own record passes. B's record, a record with no tenant, a
// missing record and a failed read all answer the same 404, on A's page and on B's.

const A = { tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantSlug: 'alpha' }
const B = { tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', tenantSlug: 'beta' }

const hoisted = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  failing: new Set<string>(),
  bodyArgs: {} as Record<string, Record<string, unknown>>,
}))

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`)
  },
}))

vi.mock('@/lib/tenancy/host', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenancy/host')>()),
  activeTenantBySlug: async (slug: string) => (slug === 'alpha' ? { tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantSlug: 'alpha' } : slug === 'beta' ? { tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', tenantSlug: 'beta' } : null),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      const rows = () => (hoisted.tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v))
      const fail = () => hoisted.failing.has(table)
      const builder = {
        select: () => builder,
        eq(column: string, value: unknown) {
          filters.push([column, value])
          return builder
        },
        maybeSingle: async () => (fail() ? { data: null, error: { message: 'read failed' } } : { data: rows()[0] ?? null, error: null }),
        then: (done: (v: unknown) => void) => done(fail() ? { data: null, error: { message: 'read failed' } } : { data: rows(), error: null }),
      }
      return builder
    },
  }),
}))

// The Stellr pages and bodies are stubs: what they render has its own tests. Here it
// matters only whether the tenant page reached them.
vi.mock('@/app/(flow)/register/[slug]/page', () => ({ default: function RegisterType() { return null } }))
vi.mock('@/app/(flow)/register/[slug]/individual/individual-body', () => ({ individualRegistrationBody: async (args: Record<string, unknown>) => ((hoisted.bodyArgs.individual = args), 'individual body') }))
vi.mock('@/app/(flow)/register/[slug]/group/group-body', () => ({ groupRegistrationBody: async (args: Record<string, unknown>) => ((hoisted.bodyArgs.group = args), 'group body') }))
vi.mock('@/app/(flow)/register/[slug]/confirmation/confirmation-body', () => ({ confirmationBody: async (args: Record<string, unknown>) => ((hoisted.bodyArgs.confirmation = args), 'confirmation body') }))
vi.mock('@/app/(flow)/register/[slug]/join/[token]/join-body', () => ({ groupJoinBody: async (args: Record<string, unknown>) => ((hoisted.bodyArgs.join = args), 'join body') }))
vi.mock('@/app/(flow)/register/[slug]/pay/[token]/page', () => ({ default: function Pay() { return null } }))
vi.mock('@/app/(flow)/register/[slug]/pay-seat/[token]/page', () => ({ default: function PaySeat() { return null } }))
vi.mock('@/app/(flow)/check-in/[slug]/page', () => ({ default: function CheckIn() { return null } }))
vi.mock('@/app/(flow)/check-in/[slug]/code/page', () => ({ default: function CheckInCode() { return null } }))
vi.mock('@/app/(flow)/check-in/not-open', () => ({ checkInNotOpen: () => 'not open' }))
vi.mock('@/app/(flow)/survey/[token]/page', () => ({ default: function Survey() { return null } }))
vi.mock('@/app/(flow)/survey/[token]/stop-reminders/page', () => ({ default: function StopReminders() { return null } }))
vi.mock('@/app/(flow)/survey/event/[slug]/page', () => ({ default: function EventSurvey() { return null } }))
vi.mock('@/app/(flow)/team-profile/[token]/page', () => ({ default: function TeamProfile() { return null } }))
vi.mock('@/components/esign/SigningApp', () => ({ SigningApp: function SigningApp() { return null } }))
vi.mock('@/components/esign/SignedCopy', () => ({ SignedCopy: function SignedCopy() { return null } }))
vi.mock('@/lib/sanity', () => ({ getEventsBySlugs: async () => [] }))

const TOKEN = 'a'.repeat(43)
const OTHER = 'b'.repeat(43)

function seed() {
  hoisted.failing.clear()
  hoisted.tables = {
    events: [
      { slug: 'a-event', tenant_id: A.tenantId },
      { slug: 'b-event', tenant_id: B.tenantId },
    ],
    survey_invitations: [
      { token_hash: hashToken(TOKEN), distribution_id: 'd-a' },
      { token_hash: hashToken(OTHER), distribution_id: 'd-b' },
    ],
    survey_distributions: [
      { id: 'd-a', tenant_id: A.tenantId },
      { id: 'd-b', tenant_id: B.tenantId },
    ],
    team_profiles: [
      { token_hash: hashToken(TOKEN), tenant_id: A.tenantId },
      { token_hash: hashToken(OTHER), tenant_id: B.tenantId },
    ],
    group_join_tokens: [
      { token: 'join-a', event_slug: 'a-event', tenant_id: A.tenantId, registration_id: 'r-a' },
      { token: 'join-b', event_slug: 'b-event', tenant_id: B.tenantId, registration_id: 'r-b' },
    ],
    registrations: [
      { id: 'r-a', pay_token: 'pay-a', event_slug: 'a-event', tenant_id: A.tenantId },
      { id: 'r-b', pay_token: 'pay-b', event_slug: 'b-event', tenant_id: B.tenantId },
    ],
    participants: [
      { pay_token: 'seat-a', registration_id: 'r-a' },
      { pay_token: 'seat-b', registration_id: 'r-b' },
    ],
    event_settings: [
      { event_slug: 'a-event', check_in_token: 'ta', check_in_open: true, tenant_id: A.tenantId },
      { event_slug: 'b-event', check_in_token: 'tb', check_in_open: true, tenant_id: B.tenantId },
    ],
  }
}

beforeEach(seed)

type PageFn = (props: { params: Promise<Record<string, string>>; searchParams: Promise<Record<string, string>> }) => Promise<unknown>

const load = async (loader: () => Promise<{ default: unknown }>) => (await loader()).default as PageFn
const call = (page: PageFn, params: Record<string, string>) => page({ params: Promise.resolve(params), searchParams: Promise.resolve({}) })

/** Every page in the tree. */
const PAGES: Record<string, () => Promise<{ default: unknown }>> = {
  'register/[slug]/page.tsx': () => import('@/app/%5Ft/[tenant]/(flow)/register/[slug]/page'),
  'register/[slug]/individual/page.tsx': () => import('@/app/%5Ft/[tenant]/(flow)/register/[slug]/individual/page'),
  'register/[slug]/group/page.tsx': () => import('@/app/%5Ft/[tenant]/(flow)/register/[slug]/group/page'),
  'register/[slug]/confirmation/page.tsx': () => import('@/app/%5Ft/[tenant]/(flow)/register/[slug]/confirmation/page'),
  'register/[slug]/join/[token]/page.tsx': () => import('@/app/%5Ft/[tenant]/(flow)/register/[slug]/join/[token]/page'),
  'register/[slug]/pay/[token]/page.tsx': () => import('@/app/%5Ft/[tenant]/(flow)/register/[slug]/pay/[token]/page'),
  'register/[slug]/pay-seat/[token]/page.tsx': () => import('@/app/%5Ft/[tenant]/(flow)/register/[slug]/pay-seat/[token]/page'),
  'check-in/page.tsx': () => import('@/app/%5Ft/[tenant]/(flow)/check-in/page'),
  'check-in/[slug]/page.tsx': () => import('@/app/%5Ft/[tenant]/(flow)/check-in/[slug]/page'),
  'check-in/[slug]/code/page.tsx': () => import('@/app/%5Ft/[tenant]/(flow)/check-in/[slug]/code/page'),
  'survey/[token]/page.tsx': () => import('@/app/%5Ft/[tenant]/(flow)/survey/[token]/page'),
  'survey/[token]/stop-reminders/page.tsx': () => import('@/app/%5Ft/[tenant]/(flow)/survey/[token]/stop-reminders/page'),
  'survey/event/[slug]/page.tsx': () => import('@/app/%5Ft/[tenant]/(flow)/survey/event/[slug]/page'),
  'team-profile/[token]/page.tsx': () => import('@/app/%5Ft/[tenant]/(flow)/team-profile/[token]/page'),
  'sign/page.tsx': () => import('@/app/%5Ft/[tenant]/(flow)/sign/page'),
  'sign/copy/page.tsx': () => import('@/app/%5Ft/[tenant]/(flow)/sign/copy/page'),
}

/** Pages with their own describe below: the banner address and the two signing pages. */
const TESTED_BELOW = ['check-in/page.tsx', 'sign/page.tsx', 'sign/copy/page.tsx']

interface Case {
  name: string
  file: string
  /** The route params other than the tenant, for A's record and for B's. */
  own: Record<string, string>
  foreign: Record<string, string>
  /** The tables holding the record, to wipe or fail. */
  tables: string[]
}

const CASES: Case[] = [
  { name: 'register type', file: 'register/[slug]/page.tsx', own: { slug: 'a-event' }, foreign: { slug: 'b-event' }, tables: ['events'] },
  { name: 'individual', file: 'register/[slug]/individual/page.tsx', own: { slug: 'a-event' }, foreign: { slug: 'b-event' }, tables: ['events'] },
  { name: 'group', file: 'register/[slug]/group/page.tsx', own: { slug: 'a-event' }, foreign: { slug: 'b-event' }, tables: ['events'] },
  { name: 'confirmation', file: 'register/[slug]/confirmation/page.tsx', own: { slug: 'a-event' }, foreign: { slug: 'b-event' }, tables: ['events'] },
  { name: 'join', file: 'register/[slug]/join/[token]/page.tsx', own: { slug: 'a-event', token: 'join-a' }, foreign: { slug: 'b-event', token: 'join-b' }, tables: ['group_join_tokens', 'registrations'] },
  { name: 'pay', file: 'register/[slug]/pay/[token]/page.tsx', own: { slug: 'a-event', token: 'pay-a' }, foreign: { slug: 'b-event', token: 'pay-b' }, tables: ['registrations'] },
  { name: 'pay seat', file: 'register/[slug]/pay-seat/[token]/page.tsx', own: { slug: 'a-event', token: 'seat-a' }, foreign: { slug: 'b-event', token: 'seat-b' }, tables: ['participants', 'registrations'] },
  { name: 'check-in', file: 'check-in/[slug]/page.tsx', own: { slug: 'a-event' }, foreign: { slug: 'b-event' }, tables: ['events'] },
  { name: 'check-in code', file: 'check-in/[slug]/code/page.tsx', own: { slug: 'a-event' }, foreign: { slug: 'b-event' }, tables: ['events'] },
  { name: 'survey', file: 'survey/[token]/page.tsx', own: { token: TOKEN }, foreign: { token: OTHER }, tables: ['survey_invitations', 'survey_distributions'] },
  { name: 'stop reminders', file: 'survey/[token]/stop-reminders/page.tsx', own: { token: TOKEN }, foreign: { token: OTHER }, tables: ['survey_invitations', 'survey_distributions'] },
  { name: 'event survey', file: 'survey/event/[slug]/page.tsx', own: { slug: 'a-event' }, foreign: { slug: 'b-event' }, tables: ['events'] },
  { name: 'team profile', file: 'team-profile/[token]/page.tsx', own: { token: TOKEN }, foreign: { token: OTHER }, tables: ['team_profiles'] },
]

describe.each(CASES)('the tenant page: $name', ({ file, own, foreign, tables }) => {
  const page = PAGES[file]
  it("renders the tenant's own record", async () => {
    await expect(call(await load(page), { tenant: 'alpha', ...own })).resolves.toBeTruthy()
  })

  it("answers 404 for another tenant's record, in both directions", async () => {
    const Page = await load(page)
    await expect(call(Page, { tenant: 'alpha', ...foreign })).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(call(Page, { tenant: 'beta', ...own })).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(call(Page, { tenant: 'beta', ...foreign })).resolves.toBeTruthy()
  })

  it('answers 404 for Stellr and for an unknown tenant', async () => {
    const Page = await load(page)
    await expect(call(Page, { tenant: 'stellr', ...own })).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(call(Page, { tenant: 'nobody', ...own })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('answers 404 for a missing record', async () => {
    for (const table of tables) {
      seed()
      hoisted.tables[table] = []
      await expect(call(await load(page), { tenant: 'alpha', ...own })).rejects.toThrow('NEXT_NOT_FOUND')
    }
  })

  it('answers 404 for a failed read', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const table of tables) {
      seed()
      hoisted.failing.add(table)
      await expect(call(await load(page), { tenant: 'alpha', ...own })).rejects.toThrow('NEXT_NOT_FOUND')
    }
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})

const elementName = (el: unknown) => ((el as ReactElement).type as { name: string }).name

describe('the record checks, case by case', () => {
  it('a row with no tenant is never a match: it is Stellr, not yet backfilled', async () => {
    hoisted.tables.events = [{ slug: 'a-event', tenant_id: null }]
    const Page = await load(() => import('@/app/%5Ft/[tenant]/(flow)/register/[slug]/page'))
    await expect(call(Page, { tenant: 'alpha', slug: 'a-event' })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it("a seat link on its own tenant's other event is refused: the page prices it by the URL's slug", async () => {
    hoisted.tables.events.push({ slug: 'a-other', tenant_id: A.tenantId })
    const Page = await load(() => import('@/app/%5Ft/[tenant]/(flow)/register/[slug]/pay-seat/[token]/page'))
    await expect(call(Page, { tenant: 'alpha', slug: 'a-other', token: 'seat-a' })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('a pay link for another slug is refused', async () => {
    const Page = await load(() => import('@/app/%5Ft/[tenant]/(flow)/register/[slug]/pay/[token]/page'))
    await expect(call(Page, { tenant: 'alpha', slug: 'b-event', token: 'pay-a' })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('a join link whose registration is another tenant\'s is refused', async () => {
    hoisted.tables.group_join_tokens[0].registration_id = 'r-b'
    const Page = await load(() => import('@/app/%5Ft/[tenant]/(flow)/register/[slug]/join/[token]/page'))
    await expect(call(Page, { tenant: 'alpha', slug: 'a-event', token: 'join-a' })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it("a join link on its own tenant's other event is refused: the token is for one slug", async () => {
    hoisted.tables.events.push({ slug: 'a-other', tenant_id: A.tenantId })
    const Page = await load(PAGES['register/[slug]/join/[token]/page.tsx'])
    await expect(call(Page, { tenant: 'alpha', slug: 'a-other', token: 'join-a' })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('a malformed token answers 404 with no read', async () => {
    const survey = await load(() => import('@/app/%5Ft/[tenant]/(flow)/survey/[token]/page'))
    const profile = await load(() => import('@/app/%5Ft/[tenant]/(flow)/team-profile/[token]/page'))
    hoisted.failing.add('survey_invitations')
    hoisted.failing.add('team_profiles')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(call(survey, { tenant: 'alpha', token: 'short' })).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(call(profile, { tenant: 'alpha', token: 'short' })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it('reuses the Stellr page with no tenant in its params', async () => {
    const Page = await load(() => import('@/app/%5Ft/[tenant]/(flow)/survey/[token]/page'))
    const out = (await call(Page, { tenant: 'alpha', token: TOKEN })) as ReactElement<{ params: Promise<object> }>
    expect(isValidElement(out)).toBe(true)
    expect(elementName(out)).toBe('Survey')
    await expect(out.props.params).resolves.toEqual({ token: TOKEN })
  })
})

describe('every page in the tree', () => {
  it('has a behavioural 404 test here, so a new page cannot skip one', () => {
    const root = path.join(process.cwd(), 'app/%5Ft/[tenant]/(flow)')
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .map((rel) => rel.split(path.sep).join('/'))
      .filter((rel) => rel.endsWith('/page.tsx'))
    expect(Object.keys(PAGES).sort()).toEqual(files.sort())
    const tested = [...CASES.map((c) => c.file), ...TESTED_BELOW]
    expect(files.filter((f) => !tested.includes(f))).toEqual([])
  })
})

describe('what a tenant page hands the shared body', () => {
  it('no prefill: it reads a roster row from any organiser', async () => {
    await call(await load(PAGES['register/[slug]/individual/page.tsx']), { tenant: 'alpha', slug: 'a-event' })
    await call(await load(PAGES['register/[slug]/group/page.tsx']), { tenant: 'alpha', slug: 'a-event' })
    await call(await load(PAGES['register/[slug]/join/[token]/page.tsx']), { tenant: 'alpha', slug: 'a-event', token: 'join-a' })
    expect(Object.keys(hoisted.bodyArgs.individual)).toEqual(['slug', 'scholarshipToken'])
    expect(Object.keys(hoisted.bodyArgs.group)).toEqual(['slug'])
    expect(hoisted.bodyArgs.join).toEqual({ slug: 'a-event', token: 'join-a' })
  })

  const sheet = async (value: unknown) => {
    const Page = await load(PAGES['register/[slug]/confirmation/page.tsx'])
    await Page({ params: Promise.resolve({ tenant: 'alpha', slug: 'a-event' }), searchParams: Promise.resolve({ id: 'r', type: 'group', spreadsheet: value }) } as never)
    return hoisted.bodyArgs.confirmation.query as Record<string, unknown>
  }
  const REAL = 'https://docs.google.com/spreadsheets/d/abc123/edit'

  it('passes on the Google Sheets link the group route sends, with the rest of the query', async () => {
    const encoded = encodeURIComponent(REAL)
    expect(await sheet(encoded)).toEqual({ id: 'r', type: 'group', spreadsheet: encoded })
  })

  it.each([
    ['another site', encodeURIComponent('https://example.test/spreadsheets/d/x')],
    ['a look-alike host', encodeURIComponent('https://docs.google.com.example.test/spreadsheets/d/x')],
    ['a host behind a username', encodeURIComponent('https://docs.google.com@example.test/spreadsheets/d/x')],
    ['plain http', encodeURIComponent('http://docs.google.com/spreadsheets/d/x')],
    ['another Google path', encodeURIComponent('https://docs.google.com/forms/d/x')],
    ['another scheme', encodeURIComponent('javascript:void(0)')],
    ['a malformed escape, which would otherwise throw', '%E0%A4%A'],
    ['not a URL', 'nope'],
    ['a repeated parameter', [REAL, REAL]],
  ])('drops anything else: %s', async (_name, value) => {
    expect((await sheet(value)).spreadsheet).toBeUndefined()
  })
})

describe('the tenant banner address', () => {
  const page = () => load(() => import('@/app/%5Ft/[tenant]/(flow)/check-in/page'))

  it("goes only to the tenant's own open check-in", async () => {
    // A check-in only counts as in person once Sanity has the event: see lib/check-in-banner.
    const sanity = await import('@/lib/sanity')
    vi.spyOn(sanity, 'getEventsBySlugs').mockImplementation(async (slugs: string[]) =>
      slugs.map((s) => ({ slug: { current: s }, title: s, date: '2026-11-06' })) as never,
    )
    await expect(call(await page(), { tenant: 'alpha' })).rejects.toThrow('NEXT_REDIRECT /check-in/a-event?t=ta')
    await expect(call(await page(), { tenant: 'beta' })).rejects.toThrow('NEXT_REDIRECT /check-in/b-event?t=tb')
    vi.restoreAllMocks()
  })

  it('says not open when only another tenant has one open', async () => {
    hoisted.tables.event_settings = [{ event_slug: 'b-event', check_in_token: 'tb', check_in_open: true, tenant_id: B.tenantId }]
    await expect(call(await page(), { tenant: 'alpha' })).resolves.toBe('not open')
  })

  it('answers 404 for a failed read, and for Stellr', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    hoisted.failing.add('event_settings')
    await expect(call(await page(), { tenant: 'alpha' })).rejects.toThrow('NEXT_NOT_FOUND')
    error.mockRestore()
    seed()
    await expect(call(await page(), { tenant: 'stellr' })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

describe('the signing pages, which have no record of their own', () => {
  it.each([
    ['sign', () => import('@/app/%5Ft/[tenant]/(flow)/sign/page'), 'SigningApp'],
    ['signed copy', () => import('@/app/%5Ft/[tenant]/(flow)/sign/copy/page'), 'SignedCopy'],
  ])('%s still answers only for an active tenant', async (_name, loader, component) => {
    const Page = await load(loader as () => Promise<{ default: unknown }>)
    expect(elementName(await call(Page, { tenant: 'alpha' }))).toBe(component)
    await expect(call(Page, { tenant: 'stellr' })).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(call(Page, { tenant: 'nobody' })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
