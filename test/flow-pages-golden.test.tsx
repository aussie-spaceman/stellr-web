import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tree } from './golden-tree'

// What the four Stellr flow pages B5b splits return, pinned before the split. Each
// page's shared body moved to a file a tenant page can reuse, and the tracking moved
// to the Stellr page through a slot, so Stellr must see no change.
//
// The golden file was written by this test against the unsplit pages. It holds three
// things for each case: the exact element tree the page returns, which is what Next
// serialises for both the HTML and the page payload; that tree rendered to HTML; and
// each data read in order, so a read added, dropped or moved shows too. A change to
// the golden file is a change to what Stellr serves: read the diff.
//
// The golden file holds GOLDEN_SHEET as its placeholder for the sheet link. Those cases
// feed the page a link in the form the group route generates (lib/google-sheets), and
// the output must match byte for byte once that one link is swapped for the placeholder.
const GENERATED_SHEET = 'https://docs.google.com/spreadsheets/d/abc123/edit'
const GOLDEN_SHEET = 'https://docs.test/sheet'

process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
process.env.NEXT_PUBLIC_SITE_URL = 'https://www.test'

const reads: string[] = []
const state = vi.hoisted(() => ({
  event: null as unknown,
  eventThrows: false,
  price: { kind: 'priced' } as unknown,
  offer: null as unknown,
  open: [] as unknown[],
}))

const log = (name: string, ...args: unknown[]) => reads.push(`${name}(${args.map((a) => JSON.stringify(a)).join(', ')})`)

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`)
  },
}))

vi.mock('@/lib/sanity', () => ({
  getEventBySlug: async (slug: string) => {
    log('getEventBySlug', slug)
    if (state.eventThrows) throw new Error('sanity down')
    return state.event
  },
}))
vi.mock('@/lib/registration-prefill', () => ({
  getRegistrationPrefill: async () => {
    log('getRegistrationPrefill')
    return { firstName: 'Pre' }
  },
}))
vi.mock('@/lib/event-pricing', () => ({
  getEventPrice: async (id: string | undefined) => {
    log('getEventPrice', id)
    return state.price
  },
}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => 'db' }))
vi.mock('@/lib/store/event-merch', () => ({
  listEventAddons: async (db: string, slug: string) => {
    log('listEventAddons', db, slug)
    return [{ id: 'addon-1' }]
  },
}))
vi.mock('@/lib/stripe', () => ({
  stripeClient: () => ({
    prices: {
      retrieve: async (id: string) => {
        log('prices.retrieve', id)
        return { unit_amount: 10000 }
      },
    },
  }),
}))
vi.mock('@/lib/scholarships', () => ({
  findOfferByToken: async (db: string, token: string) => {
    log('findOfferByToken', db, token)
    return state.offer
  },
  discountedCents: (cents: number, percent: number) => Math.round((cents * (100 - percent)) / 100),
  formatUsd: (cents: number) => `$${(cents / 100).toFixed(2)}`,
}))
vi.mock('@/lib/check-in-banner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/check-in-banner')>()),
  loadOpenCheckIns: async (...args: unknown[]) => {
    log('loadOpenCheckIns', ...args)
    return state.open
  },
  todayUtc: () => '2026-11-05',
}))
// The forms are client components with their own tests: here only what they are handed matters.
vi.mock('@/components/forms/IndividualRegistrationForm', () => ({
  default: function IndividualRegistrationForm(props: object) {
    return <div data-form="individual" data-props={JSON.stringify(props)} />
  },
}))
vi.mock('@/components/forms/GroupRegistrationForm', () => ({
  default: function GroupRegistrationForm(props: object) {
    return <div data-form="group" data-props={JSON.stringify(props)} />
  },
}))

async function capture(run: () => Promise<ReactNode>) {
  reads.length = 0
  try {
    const out = await run()
    return { tree: tree(out), html: renderToStaticMarkup(<>{out}</>), reads: [...reads] }
  } catch (err) {
    return { threw: (err as Error).message, reads: [...reads] }
  }
}

const EVENT = {
  title: 'Nevada Design Challenge',
  date: '2026-11-06',
  endDate: '2026-11-07',
  city: 'Reno',
  state: 'NV',
  activityType: 'competition',
  stripePriceId: 'price_1',
  gradeMin: 9,
  gradeMax: 12,
}
const CAMPAIGN = { ...EVENT, title: 'Tree Campaign', activityType: 'campaign' }
const OFFER = { event_slug: 'nv', percent_off: 50, first_name: 'Ada', last_name: 'L', email: 'ada@example.test' }

const params = <T,>(value: T) => Promise.resolve(value)

beforeEach(() => {
  state.event = EVENT
  state.eventThrows = false
  state.price = { kind: 'priced' }
  state.offer = null
  state.open = []
})

async function individual(query: { scholarship?: string } = {}) {
  const { default: Page } = await import('@/app/(stellr)/(flow)/register/[slug]/individual/page')
  return capture(() => Page({ params: params({ slug: 'nv' }), searchParams: params(query) }))
}
async function group() {
  const { default: Page } = await import('@/app/(stellr)/(flow)/register/[slug]/group/page')
  return capture(() => Page({ params: params({ slug: 'nv' }) }))
}
async function confirmation(query: Record<string, string> = {}) {
  const { default: Page } = await import('@/app/(stellr)/(flow)/register/[slug]/confirmation/page')
  return capture(() => Page({ params: params({ slug: 'nv' }), searchParams: params(query) }))
}
async function banner() {
  const { default: Page } = await import('@/app/(stellr)/(flow)/check-in/page')
  return capture(() => Page())
}

describe('the Stellr flow pages B5b split', () => {
  it('return what they returned before the split', async () => {
    const out: Record<string, unknown> = {}

    out['individual, priced'] = await individual()
    state.offer = OFFER
    out['individual, scholarship offer'] = await individual({ scholarship: 'tok' })
    state.offer = { ...OFFER, event_slug: 'other' }
    out['individual, offer for another event'] = await individual({ scholarship: 'tok' })
    state.offer = null
    state.price = { kind: 'free' }
    out['individual, free'] = await individual()
    state.price = { kind: 'priced' }
    state.event = CAMPAIGN
    out['individual, campaign'] = await individual()
    state.event = null
    out['individual, no event'] = await individual()
    state.eventThrows = true
    out['individual, event read fails'] = await individual()
    state.eventThrows = false

    state.event = EVENT
    out['group, priced'] = await group()
    state.price = { kind: 'free' }
    out['group, free'] = await group()
    state.price = { kind: 'tbc' }
    out['group, price to be confirmed'] = await group()
    state.price = { kind: 'priced' }
    state.event = CAMPAIGN
    out['group, campaign'] = await group()
    state.event = null
    out['group, no event'] = await group()
    state.eventThrows = true
    out['group, event read fails'] = await group()
    state.eventThrows = false

    state.event = EVENT
    out['confirmation, individual'] = await confirmation({ id: 'reg-1' })
    out['confirmation, no reference'] = await confirmation()
    out['confirmation, group'] = await confirmation({ id: 'reg-1', type: 'group' })
    out['confirmation, group with people still to add'] = await confirmation({
      id: 'reg-1',
      type: 'group',
      remaining: '3',
      spreadsheet: encodeURIComponent(GENERATED_SHEET),
    })
    out['confirmation, group with a sheet'] = await confirmation({ id: 'reg-1', type: 'group', spreadsheet: encodeURIComponent(GENERATED_SHEET) })
    out['confirmation, campaign'] = await confirmation({ id: 'reg-1', type: 'group', campaign: '1' })
    state.event = null
    out['confirmation, no event'] = await confirmation({ id: 'reg-1' })
    state.eventThrows = true
    out['confirmation, event read fails'] = await confirmation({ id: 'reg-1' })
    state.eventThrows = false

    out['check-in banner, nothing open'] = await banner()
    state.open = [{ slug: 'nv', token: 'tok en', title: 'Nevada', date: '2026-11-06', endDate: null, inPerson: true }]
    out['check-in banner, one open'] = await banner()
    state.open = [{ slug: 'nv', token: null, title: 'Nevada', date: '2026-11-06', endDate: null, inPerson: true }]
    out['check-in banner, open with no token'] = await banner()

    await expect(`${JSON.stringify(out, null, 1).replaceAll(GENERATED_SHEET, GOLDEN_SHEET)}\n`).toMatchFileSnapshot('./fixtures/flow-pages-golden.json')
  })
})

describe('the sheet link on the confirmation page', () => {
  const page = async (spreadsheet: string) =>
    ((await confirmation({ id: 'reg-1', type: 'group', spreadsheet })) as { html: string }).html

  it.each([
    ['the whole roster later', {}],
    ['people still to add', { remaining: '3' }],
  ])('renders the Google Sheets link the group route generates: %s', async (_name, extra) => {
    const { html } = (await confirmation({ id: 'reg-1', type: 'group', spreadsheet: encodeURIComponent(GENERATED_SHEET), ...extra })) as { html: string }
    expect(html).toContain(`href="${GENERATED_SHEET}"`)
    expect(html).toContain('Open Google Sheet')
  })

  it.each([
    ['another site', encodeURIComponent('https://example.test/spreadsheets/d/x')],
    ['a look-alike host', encodeURIComponent('https://docs.google.com.example.test/spreadsheets/d/x')],
    ['a host behind a username', encodeURIComponent('https://docs.google.com@example.test/spreadsheets/d/x')],
    ['plain http', encodeURIComponent('http://docs.google.com/spreadsheets/d/x')],
    ['another Google path', encodeURIComponent('https://docs.google.com/forms/d/x')],
    ['another scheme', encodeURIComponent('javascript:void(0)')],
    ['a malformed escape', '%E0%A4%A'],
    ['not a URL', 'nope'],
  ])('renders no button for any other value: %s', async (_name, value) => {
    const html = await page(value)
    expect(html).not.toContain('Open Google Sheet')
    expect(html).not.toContain('example.test')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('Group Registration Submitted!')
  })
})

describe('the shared bodies, as a tenant page calls them', () => {
  it('read no prefill and hand the form none', async () => {
    const { individualRegistrationBody } = await import('@/app/(stellr)/(flow)/register/[slug]/individual/individual-body')
    const { groupRegistrationBody } = await import('@/app/(stellr)/(flow)/register/[slug]/group/group-body')
    for (const body of [() => individualRegistrationBody({ slug: 'nv', scholarshipToken: undefined }), () => groupRegistrationBody({ slug: 'nv' })]) {
      const { html, reads: seen } = (await capture(body)) as { html: string; reads: string[] }
      expect(seen).not.toContain('getRegistrationPrefill()')
      expect(html).toContain('&quot;prefill&quot;:null')
    }
  })
})
