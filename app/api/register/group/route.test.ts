import { describe, it, expect, vi, beforeEach } from 'vitest'
import { appToday } from '@/lib/age'

// Deep-review REG-3 / REG-4 / REG-5 regression tests for the group registration
// route. The route has a very large side-effect surface (Supabase, Stripe,
// Sanity, Clerk, DocuSign, Google Sheets, email); everything below the security
// gate is mocked to a no-op so the tests can assert on (a) the status code and
// (b) the exact `registrations` row the route would insert.

const h = vi.hoisted(() => ({
  getEventBySlug: vi.fn(async (_slug: string): Promise<unknown> => ({
    title: 'Colorado Space Challenge',
    activityType: 'live_event',
    stripePriceId: 'price_x',
  })),
  priceRetrieve: vi.fn(async () => ({ unit_amount: 13500, currency: 'usd' })),
  // PAY-1: Stripe invoice surface for the "pay by invoice" path.
  customersCreate: vi.fn(async () => ({ id: 'cus_1' })),
  invoicesCreate: vi.fn(async () => ({ id: 'in_1' })),
  invoiceItemsCreate: vi.fn(async () => ({ id: 'ii_1' })),
  invoicesFinalize: vi.fn(async (id: string) => ({ id, hosted_invoice_url: null })),
  invoicesSend: vi.fn(async () => ({})),
  getCurrentMember: vi.fn(async (): Promise<unknown> => null),
  findExistingRegistrations: vi.fn(async () => new Map<string, unknown[]>()),
  resolveDuplicate: vi.fn(() => ({ kind: 'none' })),
  // S0: lib/clerk-provisioning runs for real (the COPPA guard); Clerk is faked.
  getUserList: vi.fn(async () => ({ data: [] as Array<{ id: string }> })),
  createUser: vi.fn(async () => ({ id: 'user_new' })),
  createSignInToken: vi.fn(async () => ({ token: 'tkt' })),
  onFile: null as Record<string, unknown> | null,
  // AUTH-N2: controllable rate-limit guard. Returns null (proceed) by default;
  // a test can make it return a 429 Response to assert the route bails first.
  rlGuard: vi.fn((_req: unknown, _route: string, _opts: unknown, _suffix?: string): Response | null => null),
  followUp: vi.fn(async (_db: unknown, _input: unknown) => ({})),
  sendEmail: vi.fn(async () => {}),
  afterTasks: [] as Array<() => Promise<unknown>>,
  // Captures every row passed to `.insert()`, keyed by table name.
  captures: {} as Record<string, unknown[]>,
  // …and to `.upsert()` (the member rows).
  upserts: {} as Record<string, unknown[]>,
}))

// A thenable Supabase chain: terminal `.single()`/`.maybeSingle()` resolve, and
// awaiting the chain directly (e.g. `await db.from(t).insert(x)`) resolves too.
function makeDb(captures: Record<string, unknown[]>) {
  const from = (table: string) => {
    const state: { op: string; payload: unknown; single: boolean } = { op: 'select', payload: null, single: false }
    const result = () => {
      if (state.op === 'insert' && table === 'registrations') return { data: { id: 'reg-1' }, error: null }
      if (state.op === 'insert' && table === 'participants') {
        const rows = Array.isArray(state.payload) ? state.payload : [state.payload]
        return { data: rows.map((r: Record<string, unknown>, i: number) => ({ id: `p-${i}`, email: r.email })), error: null }
      }
      if (table === 'members' && state.op === 'upsert') {
        if (state.single) return { data: { id: 'm-teacher' }, error: null }
        // Mirror Supabase `.upsert(rows).select('id,email')`: a created row per
        // payload, id derived from email so the route maps members back by email.
        // REG-11 depends on this linkage being observable on participant rows.
        const rows = Array.isArray(state.payload) ? state.payload : [state.payload]
        return { data: rows.map((r: Record<string, unknown>) => ({ id: `m-${String(r.email)}`, email: r.email })), error: null }
      }
      if (table === 'members' && state.op === 'select') return { data: [], error: null }
      return { data: null, error: null }
    }
    const chain: Record<string, unknown> = {
      select: () => chain, eq: () => chain, in: () => chain, not: () => chain, is: () => chain,
      insert: (p: unknown) => { state.op = 'insert'; state.payload = p; (captures[table] ||= []).push(p); return chain },
      upsert: (p: unknown) => { state.op = 'upsert'; state.payload = p; (h.upserts[table] ||= []).push(p); return chain },
      update: (p: unknown) => { state.op = 'update'; state.payload = p; return chain },
      delete: () => { state.op = 'delete'; return chain },
      single: async () => { state.single = true; return result() },
      maybeSingle: async () => { state.single = true; return result() },
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(result()).then(onF, onR),
    }
    return chain
  }
  return { from }
}

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => makeDb(h.captures) }))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: h.getEventBySlug }))
vi.mock('@/lib/community', () => ({ getCurrentMember: h.getCurrentMember }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/stripe', () => ({
  stripeClient: () => ({
    prices: { retrieve: h.priceRetrieve },
    customers: { create: h.customersCreate },
    invoiceItems: { create: h.invoiceItemsCreate },
    invoices: { create: h.invoicesCreate, finalizeInvoice: h.invoicesFinalize, sendInvoice: h.invoicesSend },
  }),
}))
vi.mock('@/lib/registration-duplicates', () => ({
  findExistingRegistrations: h.findExistingRegistrations,
  resolveDuplicate: h.resolveDuplicate,
}))
vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: async () => ({
    users: { getUserList: h.getUserList, createUser: h.createUser },
    signInTokens: { createSignInToken: h.createSignInToken },
  }),
}))
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: () => {} }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: h.rlGuard, HOUR_MS: 3_600_000 }))
vi.mock('@/lib/group-registration-followup', () => ({ runGroupRegistrationFollowUp: h.followUp }))
// Hold post-response work so a test can assert what ran before the response.
vi.mock('@/lib/after-response', () => ({
  runAfterResponse: (_label: string, task: () => Promise<unknown>) => { h.afterTasks.push(task) },
}))
vi.mock('@/lib/email', () => ({ sendEmail: h.sendEmail, groupConfirmationEmail: () => ({ subject: '', html: '', text: '' }) }))
vi.mock('@/lib/individual-payment', () => ({ ensureIndividualPayments: async () => {} }))
vi.mock('@/lib/store/event-merch', () => ({ finalizeRegistrationMerch: async () => {} }))
vi.mock('@/lib/google-sheets', () => ({ isGoogleSheetsConfigured: () => false, createGroupRegistrationSheet: async () => ({ url: '', spreadsheetId: '' }) }))
vi.mock('@/lib/school-link', () => ({ linkMembersToSchoolByName: async () => {} }))
vi.mock('@/lib/event-participation-sync', () => ({ recordEventParticipation: async () => {} }))
vi.mock('@/lib/space-inheritance', () => ({ syncObjectSpaceRoster: async () => {}, reconcileEventSpaceRoster: async () => {} }))
vi.mock('@/lib/member-profile-options', () => ({ syncMemberOptionSelections: async () => {} }))
vi.mock('@/lib/member-onfile', () => ({ getMemberOnFileByMembershipId: async () => h.onFile }))
vi.mock('@/lib/auto-membership-grant', () => ({ autoGrantBaseMembership: async () => {} }))
vi.mock('@/lib/registration-pay-link', () => ({ sendPayLinkEmail: async () => ({ sent: false, reason: undefined, recipients: [] }) }))
vi.mock('@/lib/registration-checkout', () => ({
  createRegistrationCheckout: async () => ({ url: 'https://checkout.test/cs_1' }),
  RegistrationCheckoutError: class extends Error {},
  ensurePayToken: async () => 'paytok',
  mintPayToken: () => 'paytok',
  payPageUrl: () => 'https://www.stellreducation.org/pay',
}))

const { POST } = await import('./route')

const STUDENT = (email: string) => ({
  email, first_name: 'S', last_name: email, date_of_birth: '2012-01-01',
  phone: '', gender: '', t_shirt_size: '', age_bracket: 'high_school', event_role: 'Student',
})

function body(overrides: Record<string, unknown> = {}) {
  return {
    event_slug: 'colorado',
    event_title: 'FORGED TITLE',
    registrant_role: 'teacher',
    teacher: {
      email: 'teacher@example.com', first_name: 'T', last_name: 'Eacher',
      school_name: 'Denver High', date_of_birth: '1980-01-01',
      phone: '', gender: '', t_shirt_size: '', age_bracket: 'adult',
    },
    adult_count: 1, student_count: 2, total_participants: 3,
    details_method: 'add_now',
    payment_method: 'none',
    additional_adults: [],
    students: [STUDENT('s1@example.com'), STUDENT('s2@example.com')],
    school_dpa_agreed: true,
    ...overrides,
  }
}

function post(b: Record<string, unknown>) {
  return POST(
    new Request('https://www.stellreducation.org/api/register/group', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
    }) as never,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(h.captures)) delete h.captures[k]
  for (const k of Object.keys(h.upserts)) delete h.upserts[k]
  h.afterTasks.length = 0
  h.getEventBySlug.mockResolvedValue({ title: 'Colorado Space Challenge', activityType: 'live_event', stripePriceId: 'price_x' })
  h.priceRetrieve.mockResolvedValue({ unit_amount: 13500, currency: 'usd' })
  h.getCurrentMember.mockResolvedValue(null)
  h.findExistingRegistrations.mockResolvedValue(new Map())
  h.resolveDuplicate.mockReturnValue({ kind: 'none' })
  h.getUserList.mockResolvedValue({ data: [] })
  h.onFile = null
  h.rlGuard.mockReturnValue(null)
})

describe('POST /api/register/group', () => {
  // ── REG-3 ──────────────────────────────────────────────────────────────────
  it('REG-3: a client is_campaign flag cannot confirm a paid event unpaid', async () => {
    const res = await post(body({ is_campaign: true, payment_method: 'none' }))
    expect(res.status).toBe(201)
    const reg = (h.captures.registrations?.[0] ?? {}) as Record<string, unknown>
    // The paid live event stays pending (unpaid) and keeps type 'group' — the
    // forged flag is ignored because status/type derive from the CMS event.
    expect(reg.status).toBe('pending')
    expect(reg.type).toBe('group')
    expect(reg.amount_due_cents).toBe(13500 * 3)
  })

  it('REG-3/REG-4: event_title is taken from the server, not the client body', async () => {
    await post(body({ event_title: 'FORGED TITLE' }))
    const reg = (h.captures.registrations?.[0] ?? {}) as Record<string, unknown>
    expect(reg.event_title).toBe('Colorado Space Challenge')
  })

  // ── REG-4 ──────────────────────────────────────────────────────────────────
  it('REG-4: a Sanity outage fails closed with 503 and inserts nothing', async () => {
    h.getEventBySlug.mockRejectedValue(new Error('sanity timeout'))
    const res = await post(body())
    expect(res.status).toBe(503)
    expect(h.captures.registrations).toBeUndefined()
  })

  it('REG-4: an unknown slug fails closed with 404 and inserts nothing', async () => {
    h.getEventBySlug.mockResolvedValue(null)
    const res = await post(body())
    expect(res.status).toBe(404)
    expect(h.captures.registrations).toBeUndefined()
  })

  // ── REG-5 ──────────────────────────────────────────────────────────────────
  it('REG-5: more students than declared is rejected before any insert', async () => {
    const res = await post(body({
      student_count: 2, total_participants: 3,
      students: [STUDENT('a@x.com'), STUDENT('b@x.com'), STUDENT('c@x.com'), STUDENT('d@x.com'), STUDENT('e@x.com')],
    }))
    expect(res.status).toBe(400)
    expect(h.captures.registrations).toBeUndefined()
  })

  it('REG-5: more additional adults than the group allows is rejected', async () => {
    const res = await post(body({
      adult_count: 1, // teacher only → 0 additional adults allowed
      additional_adults: [{ email: 'extra@x.com', first_name: 'E', last_name: 'X', date_of_birth: '1990-01-01', phone: '', gender: '', t_shirt_size: '', age_bracket: 'adult', event_role: 'Adult' }],
    }))
    expect(res.status).toBe(400)
    expect(h.captures.registrations).toBeUndefined()
  })

  it('REG-5: a negative adult_count that nets to the declared total is rejected', async () => {
    // adult_count:-10 + student_count:12 == total_participants:2 passed the sum
    // equality check before the count validation existed.
    const res = await post(body({ adult_count: -10, student_count: 12, total_participants: 2, students: [STUDENT('s1@example.com'), STUDENT('s2@example.com')] }))
    expect(res.status).toBe(400)
    expect(h.captures.registrations).toBeUndefined()
  })

  it('accepts a well-formed add_now group within the declared counts', async () => {
    const res = await post(body())
    expect(res.status).toBe(201)
    expect(h.captures.registrations?.length).toBe(1)
    // teacher + 2 students
    expect((h.captures.participants?.[0] as unknown[]).length).toBe(3)
  })

  // ── PAY-1 ────────────────────────────────────────────────────────────────────
  // The "pay by invoice" path must attach the line item to a specific invoice so
  // the invoice carries the real amount. The bug created a *pending* invoice item
  // first and then an invoice with no `pending_invoice_items_behavior`; on the
  // pinned SDK that defaults to excluding pending items, finalising a $0 invoice.
  it('PAY-1: invoice is created BEFORE the line item, which is attached with invoice:<id>', async () => {
    const res = await post(body({ payment_method: 'invoice' }))
    expect(res.status).toBe(201)

    // The invoice was created, then the line item attached to THAT invoice.
    expect(h.invoicesCreate).toHaveBeenCalledTimes(1)
    expect(h.invoiceItemsCreate).toHaveBeenCalledTimes(1)
    // One per-place line (29 Oct 2026), so a later roster change can revise it.
    expect(h.invoiceItemsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ invoice: 'in_1', quantity: 3 }),
    )
    const [line] = h.invoiceItemsCreate.mock.calls[0] as unknown as [{ unit_amount_decimal: unknown }]
    expect(String(line.unit_amount_decimal)).toBe('13500')
    // Ordering: invoices.create ran before invoiceItems.create (so the item is
    // never left as an unattached pending item that the invoice excludes).
    expect(h.invoicesCreate.mock.invocationCallOrder[0]).toBeLessThan(
      h.invoiceItemsCreate.mock.invocationCallOrder[0],
    )
    // And it was finalised + sent.
    expect(h.invoicesFinalize).toHaveBeenCalledWith('in_1')
    expect(h.invoicesSend).toHaveBeenCalledTimes(1)
  })

  // ── REG-11 ─────────────────────────────────────────────────────────────────
  it('REG-11: two same-email, different-name students are not merged into one member', async () => {
    const shared = 'family@example.com'
    const res = await post(body({
      student_count: 2, total_participants: 3,
      students: [
        { ...STUDENT(shared), first_name: 'Alice', last_name: 'Smith', date_of_birth: '2011-03-01' },
        { ...STUDENT(shared), first_name: 'Bob', last_name: 'Smith', date_of_birth: '2013-07-15' },
      ],
    }))
    expect(res.status).toBe(201)
    const parts = (h.captures.participants?.[0] ?? []) as Array<Record<string, unknown>>
    const alice = parts.find((p) => p.first_name === 'Alice')
    const bob = parts.find((p) => p.first_name === 'Bob')
    // Both distinct students survive as their own participant rows…
    expect(alice).toBeTruthy()
    expect(bob).toBeTruthy()
    // …each keeping its own identity (not overwritten last-wins).
    expect(alice!.last_name).toBe('Smith')
    expect(alice!.date_of_birth).toBe('2011-03-01')
    expect(bob!.date_of_birth).toBe('2013-07-15')
    // …and they are NOT collapsed onto one shared member row. Before the fix the
    // email-keyed dedupe linked both participant rows to the same member id; now
    // only the first claimant of the shared family email owns a member and the
    // sibling's member_id is null (its identity lives on the participant row).
    const bothLinkedToSameMember = !!alice!.member_id && alice!.member_id === bob!.member_id
    expect(bothLinkedToSameMember).toBe(false)
  })

  // ── 28 Oct 2026: bad guardian emails, and agreements after the response ────
  it('rejects a guardian email that is a placeholder, before any insert', async () => {
    const res = await post(body({
      students: [
        { ...STUDENT('s1@example.com'), emergency_contact_email: 'none' },
        STUDENT('s2@example.com'),
      ],
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/guardian email/)
    expect(h.captures.registrations).toBeUndefined()
  })

  it('rejects a guardian email missing the dot before the domain ending', async () => {
    const res = await post(body({
      students: [
        STUDENT('s1@example.com'),
        { ...STUDENT('s2@example.com'), emergency_contact_email: 'parent@gmailcom' },
      ],
    }))
    expect(res.status).toBe(400)
    expect(h.captures.registrations).toBeUndefined()
  })

  it('rejects a malformed participant email', async () => {
    const res = await post(body({ students: [STUDENT('s1@example.com'), STUDENT('not-an-email')] }))
    expect(res.status).toBe(400)
    expect(h.captures.registrations).toBeUndefined()
  })

  it('sends the invoice and confirmation first; agreements and logins run after the response', async () => {
    const res = await post(body({ payment_method: 'invoice' }))
    expect(res.status).toBe(201)
    // Billing and the confirmation email happened inside the request…
    expect(h.invoicesSend).toHaveBeenCalledTimes(1)
    expect(h.sendEmail).toHaveBeenCalled()
    // …and the slow per-person work was only scheduled.
    expect(h.followUp).not.toHaveBeenCalled()
    expect(h.afterTasks).toHaveLength(1)

    await h.afterTasks[0]()
    expect(h.followUp).toHaveBeenCalledTimes(1)
    const input = h.followUp.mock.calls[0][1] as {
      people: Array<{ isRegistrant: boolean; agreement: { participantId: string; eventSlug: string } }>
      deadline: number
    }
    expect(input.people).toHaveLength(3)
    expect(input.people.filter((p) => p.isRegistrant)).toHaveLength(1)
    expect(input.people.every((p) => p.agreement.eventSlug === 'colorado' && p.agreement.participantId)).toBe(true)
    expect(input.deadline).toBeGreaterThan(Date.now())
  })

  // ── AUTH-N2 ────────────────────────────────────────────────────────────────
  it('AUTH-N2: runs the rate-limit guard first, sub-keyed by event slug', async () => {
    await post(body())
    expect(h.rlGuard).toHaveBeenCalledWith(
      expect.anything(),
      'register-group',
      { limit: 3, windowMs: 3_600_000 },
      'colorado',
    )
  })

  it('AUTH-N2: a throttled caller gets 429 and nothing is created', async () => {
    h.rlGuard.mockReturnValue(
      new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }),
    )
    const res = await post(body())
    expect(res.status).toBe(429)
    expect(h.captures.registrations).toBeUndefined()
    expect(h.captures.participants).toBeUndefined()
  })
})

// ── S0 (2 Nov 2026): age gate ────────────────────────────────────────────────
const TODAY = appToday().toISOString().slice(0, 10)
/** A date of birth `n` years before the app's today, less `extraDays`. */
function yearsAgo(n: number, extraDays = 0): string {
  const d = appToday()
  d.setUTCFullYear(d.getUTCFullYear() - n)
  d.setUTCDate(d.getUTCDate() - extraDays)
  return d.toISOString().slice(0, 10)
}
const participantRows = () => (h.captures.participants?.[0] ?? []) as Array<Record<string, unknown>>
const memberRows = () => (h.upserts.members ?? []).flatMap((p) => (Array.isArray(p) ? p : [p])) as Array<Record<string, unknown>>
/** Nothing at all was written: no registration, participant or member row, no login, no email. */
function expectNothingWritten() {
  expect(h.captures).toEqual({})
  expect(h.upserts).toEqual({})
  expect(h.getUserList).not.toHaveBeenCalled()
  expect(h.createUser).not.toHaveBeenCalled()
  expect(h.sendEmail).not.toHaveBeenCalled()
}
const studentManager = (dob: string) => body({
  registrant_role: 'student_manager',
  teacher: {
    email: 'sm@example.com', first_name: 'S', last_name: 'Manager',
    school_name: 'Denver High', date_of_birth: dob,
    phone: '', gender: '', t_shirt_size: '', age_bracket: 'high_school',
  },
  teacher_poc: { first_name: 'P', last_name: 'Oc', email: 'poc@example.com' },
  adult_count: 0, student_count: 2, total_participants: 3,
})

describe('POST /api/register/group — S0 age gate', () => {
  beforeEach(() => {
    // The event is today, so "age on the event date" and "age today" agree.
    h.getEventBySlug.mockResolvedValue({ title: 'Colorado Space Challenge', activityType: 'live_event', stripePriceId: 'price_x', date: TODAY })
  })

  it.each([
    ['missing', undefined, 'dob_missing'],
    ['blank', '', 'dob_missing'],
    ['invalid', 'abc', 'dob_invalid'],
    ['impossible', '2013-02-30', 'dob_invalid'],
    ['implausible', '0201-05-05', 'dob_invalid'],
    ['in the future', '2999-01-01', 'dob_invalid'],
  ])('a student whose date of birth is %s stops the whole registration with a 400 naming them, before anything is written', async (_l, dob, code) => {
    const res = await post(body({ students: [STUDENT('s1@example.com'), { ...STUDENT('s2@example.com'), first_name: 'Ana', last_name: 'Ruiz', date_of_birth: dob }] }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe(code)
    expect(json.error).toMatch(/date of birth for Ana Ruiz/)
    expectNothingWritten()
  })

  it('an additional adult with an unreadable date of birth is refused, not stored as an adult', async () => {
    const res = await post(body({
      adult_count: 2, total_participants: 4,
      additional_adults: [{ email: 'a@x.com', first_name: 'Al', last_name: 'X', date_of_birth: 'not a date', phone: '', gender: '', t_shirt_size: '', age_bracket: 'adult', event_role: 'Mentor' }],
    }))
    expect(res.status).toBe(400)
    expectNothingWritten()
  })

  it('the registrant needs a usable date of birth too', async () => {
    const res = await post(body({ teacher: { ...body().teacher as object, date_of_birth: '' } }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ code: 'dob_missing', error: 'Please add your date of birth.' })
    expectNothingWritten()
  })

  it('checks the registrant even when the roster comes later (sheet / email link)', async () => {
    const res = await post(body({ details_method: 'sheet', students: [], teacher: { ...body().teacher as object, date_of_birth: 'nope' } }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('dob_invalid')
    expectNothingWritten()
  })

  it('a Member-ID-linked person with no date of birth on file is refused with a way forward', async () => {
    h.onFile = {
      memberId: 'm-linked', first_name: 'Lee', last_name: 'Ng', nickname: null, email: 'lee@x.com', phone: null,
      date_of_birth: null, grade: null, gender: null, t_shirt_size: null, ethnicity: [], dietary_requirements: [],
      health_conditions: null,
    }
    const res = await post(body({ students: [STUDENT('s1@example.com'), { linked: true, existing_membership_id: 'STL-1' }] }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe('dob_missing')
    expect(json.error).toMatch(/don't have a date of birth on file for Lee Ng/)
    expectNothingWritten()
  })

  it('a Member-ID-linked person whose date of birth on file is wrong is asked to correct it', async () => {
    h.onFile = {
      memberId: 'm-linked', first_name: 'Lee', last_name: 'Ng', nickname: null, email: 'lee@x.com', phone: null,
      date_of_birth: '2999-01-01', grade: null, gender: null, t_shirt_size: null, ethnicity: [], dietary_requirements: [],
      health_conditions: null,
    }
    const res = await post(body({ students: [STUDENT('s1@example.com'), { linked: true, existing_membership_id: 'STL-1' }] }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe('dob_invalid')
    expect(json.error).toMatch(/date of birth on file for Lee Ng's Stellr Member ID doesn't look right/)
    // Members cannot edit their own date of birth; only staff can correct it.
    expect(json.error).toMatch(/contact Stellr to correct it/)
    expect(json.error).not.toMatch(/correct it in their profile/)
    expectNothingWritten()
  })

  it.each([
    ['12', yearsAgo(13, -1)],
    ['13', yearsAgo(13)],
    ['14', yearsAgo(14)],
  ])('a %s-year-old student is registered as a participant whatever role was sent', async (_l, dob) => {
    const res = await post(body({ students: [STUDENT('s1@example.com'), { ...STUDENT('s2@example.com'), event_role: 'Mentor', age_bracket: 'adult', date_of_birth: dob }] }))
    expect(res.status).toBe(201)
    const row = participantRows().find((p) => p.email === 's2@example.com')
    expect(row).toMatchObject({ date_of_birth: dob, event_role: 'participant' })
    // The member row, too: a high-school participant, not the adult the form sent.
    expect(memberRows().find((m) => m.email === 's2@example.com')).toMatchObject({ age_bracket: 'high_school', event_role: 'participant' })
  })

  it('takes the age on the event date, but an adult who is a minor today is still stored as a participant', async () => {
    // 17 today, 18 at an event a year out: not refused, and not stored as an adult mentor.
    h.getEventBySlug.mockResolvedValue({ title: 'Colorado Space Challenge', activityType: 'live_event', stripePriceId: 'price_x', date: yearsAgo(-1) })
    const res = await post(body({
      adult_count: 2, total_participants: 4,
      additional_adults: [{ email: 'almost@x.com', first_name: 'Al', last_name: 'Most', date_of_birth: yearsAgo(18, -1), phone: '', gender: '', t_shirt_size: '', age_bracket: 'adult', event_role: 'Mentor' }],
    }))
    expect(res.status).toBe(201)
    expect(participantRows().find((p) => p.email === 'almost@x.com')).toMatchObject({ event_role: 'participant' })
    expect(memberRows().find((m) => m.email === 'almost@x.com')).toMatchObject({ age_bracket: 'high_school', event_role: 'participant' })
  })

  it('a Student Manager aged 12 is registered but gets no login and no sign-in token', async () => {
    const res = await post(studentManager(yearsAgo(13, -1)))
    expect(res.status).toBe(201)
    expect((await res.json()).signInToken).toBeNull()
    expect(h.getUserList).not.toHaveBeenCalled()
    expect(h.createUser).not.toHaveBeenCalled()
    // The organiser keeps their role.
    expect(participantRows()[0]).toMatchObject({ email: 'sm@example.com', event_role: 'school_student_manager' })
  })

  it.each([
    ['13', yearsAgo(13)],
    ['14', yearsAgo(14)],
  ])('a Student Manager aged %s gets the login and sign-in token', async (_l, dob) => {
    const res = await post(studentManager(dob))
    expect(res.status).toBe(201)
    expect((await res.json()).signInToken).toBe('tkt')
    expect(h.createUser).toHaveBeenCalledWith(expect.objectContaining({ emailAddress: ['sm@example.com'] }))
  })

  it('adults are unaffected: an adult teacher gets the login, and an adult mentor keeps the role', async () => {
    const res = await post(body({
      adult_count: 2, total_participants: 4,
      additional_adults: [{ email: 'm@x.com', first_name: 'Mo', last_name: 'X', date_of_birth: '1990-02-03', phone: '', gender: '', t_shirt_size: '', age_bracket: 'adult', event_role: 'Mentor' }],
    }))
    expect(res.status).toBe(201)
    expect((await res.json()).signInToken).toBe('tkt')
    expect(participantRows().find((p) => p.email === 'm@x.com')).toMatchObject({ event_role: 'mentor' })
    expect(participantRows()[0]).toMatchObject({ email: 'teacher@example.com', event_role: 'teacher' })
  })
})
