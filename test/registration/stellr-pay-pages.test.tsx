import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// S5 A7: Stellr's pay and pay-seat pages on Stellr's host. A registration of another
// tenant gets the unknown link's page, before its event, amount or payer is shown,
// whatever state it is in. Stellr's own rows, NULL or stamped, answer as before. The
// tenant tree's call, which checked its own record first, still answers for it.

const CANARY = 'c0000000-0000-4000-8000-0000000000aa'
const STELLR = '00000000-0000-4000-8000-000000000001'

const h = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown> | null>,
  stripe: null as unknown,
  shareCents: 0,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: h.rows[table] ?? null, error: null }),
      }
      return chain
    },
  }),
}))
vi.mock('@/lib/group-billing', () => ({ billableSeats: (n: number) => n, paidSeatCount: async () => 0 }))
vi.mock('@/lib/scholarships', () => ({ findOfferForRegistration: async () => null }))
vi.mock('@/lib/events/repo', () => ({
  getEventBySlug: async () => ({ title: 'Canary Cup', ...(h.stripe ? { stripePriceId: 'price_1' } : {}) }),
}))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => h.stripe }))
vi.mock('@/app/(stellr)/(flow)/register/[slug]/pay/[token]/PayNowButton', () => ({ default: () => 'PAY BUTTON' }))
vi.mock('@/app/(stellr)/(flow)/register/[slug]/pay-seat/[token]/SharedSeatPay', () => ({
  default: ({ totalLabel }: { totalLabel: string }) => `SHARED PAY ${totalLabel}`,
}))
vi.mock('@/lib/teacher-share', () => ({
  loadShareGroup: async () => ({ reg: {}, people: [] }),
  summarise: () => ({ shareCents: h.shareCents }),
}))
vi.mock('@/components/ui/MoneyBackGuarantee', () => ({ MoneyBackGuarantee: () => 'MONEY BACK' }))

const PayPage = (await import('@/app/(stellr)/(flow)/register/[slug]/pay/[token]/page')).default
const SeatPage = (await import('@/app/(stellr)/(flow)/register/[slug]/pay-seat/[token]/page')).default
const { registrationPayBody } = await import('@/app/(stellr)/(flow)/register/[slug]/pay/[token]/pay-body')
const { seatPayBody } = await import('@/app/(stellr)/(flow)/register/[slug]/pay-seat/[token]/pay-seat-body')

const props = { params: Promise.resolve({ slug: 'canary-cup', token: 'tok' }), searchParams: Promise.resolve({}) }
const html = async (node: Promise<unknown>) => renderToStaticMarkup((await node) as never)

const registration = (tenantId: string | null, overrides: Record<string, unknown> = {}) => ({
  id: 'reg-1', event_slug: 'canary-cup', event_title: 'Canary Cup', type: 'group', status: 'pending',
  amount_due_cents: 5000, invoice_requested: false, member_pays_individually: true,
  adult_count: 1, student_count: 2, teacher_first_name: 'Tess', teacher_email: 'organiser@example.com',
  tenant_id: tenantId, ...overrides,
})
const seat = (status: string | null) => ({
  id: 'p-1', first_name: 'Kim', email: 'kim@example.com', registration_id: 'reg-1', individual_payment_status: status,
})

beforeEach(() => {
  h.rows = {}
  h.stripe = null
  h.shareCents = 0
})

describe('S5 A7: the pay page on Stellr’s host', () => {
  it('another tenant’s registration gets the unknown link’s page, in every state', async () => {
    const unknown = await html(PayPage(props))
    expect(unknown).toContain('This link isn')
    for (const overrides of [{ member_pays_individually: false }, { status: 'confirmed' }, { status: 'withdrawn' }, {}]) {
      h.rows.registrations = registration(CANARY, overrides)
      const foreign = await html(PayPage(props))
      expect(foreign).toBe(unknown)
      expect(foreign).not.toContain('Canary Cup')
    }
  })

  it('Stellr’s own registration, NULL or stamped, still answers as before', async () => {
    for (const tenantId of [null, STELLR]) {
      h.rows.registrations = registration(tenantId, { member_pays_individually: false })
      const page = await html(PayPage(props))
      expect(page).toContain('Canary Cup')
      expect(page).toContain('$50.00')
    }
  })

  it('the tenant tree’s call still answers for its own registration', async () => {
    h.rows.registrations = registration(CANARY, { member_pays_individually: false })
    expect(await html(registrationPayBody({ slug: 'canary-cup', token: 'tok' }))).toContain('Canary Cup')
  })
})

describe('S5 A7: the pay-seat page on Stellr’s host', () => {
  it('another tenant’s seat gets the unknown link’s page, paid, waived or due', async () => {
    const unknown = await html(SeatPage(props))
    expect(unknown).toContain('This link isn')
    h.rows.registrations = registration(CANARY)
    for (const status of ['paid', 'waived', 'pending']) {
      h.rows.participants = seat(status)
      const foreign = await html(SeatPage(props))
      expect(foreign).toBe(unknown)
      expect(foreign).not.toContain('Canary Cup')
    }
  })

  it('Stellr’s own seat, NULL or stamped, still answers as before', async () => {
    for (const tenantId of [null, STELLR]) {
      h.rows.registrations = registration(tenantId)
      h.rows.participants = seat('pending')
      expect(await html(SeatPage(props))).toContain('Canary Cup')
      h.rows.participants = seat('paid')
      expect(await html(SeatPage(props))).toContain('Already paid')
    }
  })

  it('the tenant tree’s call still answers for its own seat', async () => {
    h.rows.registrations = registration(CANARY)
    h.rows.participants = seat('waived')
    expect(await html(seatPayBody({ slug: 'canary-cup', token: 'tok' }))).toContain('all set')
  })
})

// #584 carried into the shared body: a part-invoiced group's own-link seat is owed,
// a group sharing the teacher's cost shows the share and takes a code, and Stellr's
// guarantee shows only on Stellr's seats.
describe('S5 A7 with #584: the pay-seat body', () => {
  const priced = () => {
    h.stripe = { prices: { retrieve: async () => ({ unit_amount: 5000 }) } }
  }

  it('a part-invoiced group: a pending seat of its own is owed; one on the invoice has nothing to pay', async () => {
    h.rows.registrations = registration(null, { member_pays_individually: false })
    h.rows.participants = seat('pending')
    const owed = await html(SeatPage(props))
    expect(owed).toContain('PAY BUTTON')
    expect(owed).toContain('MONEY BACK')
    h.rows.participants = seat(null)
    expect(await html(SeatPage(props))).toContain('Nothing to pay here')
  })

  it('a Stellr group sharing the teacher’s cost shows the place, the share and the total, and the code entry', async () => {
    priced()
    h.shareCents = 1250
    h.rows.registrations = registration(null, { share_estimate: 8 })
    h.rows.participants = seat('pending')
    const page = await html(SeatPage(props))
    expect(page).toContain('Your share of the teacher’s cost')
    expect(page).toContain('$12.50')
    expect(page).toContain('SHARED PAY $62.50')
    expect(page).not.toContain('PAY BUTTON')
    expect(page).toContain('MONEY BACK')
  })

  it('a tenant’s own seat, in its tree: no shared teacher’s cost, and no Stellr guarantee', async () => {
    priced()
    h.shareCents = 1250
    h.rows.registrations = registration(CANARY, { share_estimate: 8 })
    h.rows.participants = seat('pending')
    const page = await html(seatPayBody({ slug: 'canary-cup', token: 'tok' }))
    expect(page).toContain('Canary Cup')
    expect(page).not.toContain('SHARED PAY')
    expect(page).not.toContain('MONEY BACK')
  })
})
