import { describe, it, expect, vi, beforeEach } from 'vitest'
import { rec, OPEN_EVENT, eqFilter, jsonRequest, settle, type DbCall, type DbResult } from '@/test/registration/fixtures'

// Tracker member-merge-school-email.7: on the join link, a person found by a
// SCHOOL address (theirs or one they submit) is not new, so a signed-out caller
// is asked to sign in and gets no sign-in token. The real lib/clerk-provisioning
// runs here, with Clerk's client mocked, so the test proves no ticket is minted.

const h = vi.hoisted(() => ({
  getEventBySlug: vi.fn(),
  upsertMember: vi.fn(),
  clerk: {
    getUserList: vi.fn(),
    create: vi.fn(),
    createSignInToken: vi.fn(),
  },
}))

vi.mock('@/lib/supabase', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return { supabaseServer: () => rec.client() }
})
vi.mock('@/lib/field-crypto-shadow', () => ({ shadowSyncFields: () => {} }))
vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: null }),
  clerkClient: async () => ({
    users: { getUserList: h.clerk.getUserList, createUser: h.clerk.create },
    signInTokens: { createSignInToken: h.clerk.createSignInToken },
  }),
}))
vi.mock('@/lib/pending-consent', () => ({ childAwaitingConsentBlock: async () => null }))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: h.getEventBySlug }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/rate-limit-async', () => ({ rateLimit: async () => null }))
vi.mock('@/lib/member-sync', () => ({ upsertMember: h.upsertMember }))
vi.mock('@/lib/email', () => ({
  sendEmail: async () => {},
  groupMemberJoinedEmail: () => ({ subject: 's', html: 'h', text: 't' }),
}))
vi.mock('@/lib/individual-payment', () => ({ ensureIndividualPayments: async () => {} }))
vi.mock('@/lib/docusign-agreements', () => ({ dispatchAgreement: async () => {} }))
vi.mock('@/lib/school-link', () => ({ linkMembersToSchoolByName: async () => {} }))
vi.mock('@/lib/event-participation-sync', () => ({ recordEventParticipation: async () => {} }))
vi.mock('@/lib/space-inheritance', () => ({
  syncObjectSpaceRoster: async () => {},
  reconcileEventSpaceRoster: async () => {},
}))

const { POST } = await import('./route')

const LINK = {
  token: 'tok', registration_id: 'reg-1', event_slug: 'colorado', event_title: 'Colorado',
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  registrations: {
    status: 'pending', withdrawn_at: null, school_name: 'Denver High',
    school_address_street: '1 Main', school_address_city: 'Denver', school_address_state: 'CO', school_address_zip: '80202',
    adult_count: 1, student_count: 2, member_pays_individually: false,
    teacher_email: 'teacher@example.com', teacher_first_name: 'T', teacher_poc_email: 'poc@example.com',
  },
}

const DETAILS = {
  first_name: 'K', last_name: 'Id', email: 'kid@example.com', date_of_birth: '1985-04-01',
  type: 'Mentor', phone: '555', gender: 'Female', grade: '9', t_shirt_size: 'M',
  emergency_contact_first_name: 'P', emergency_contact_last_name: 'Id',
  emergency_contact_email: 'parent@example.com', emergency_contact_phone: '556',
  emergency_contact_relationship: 'Parent',
}

const post = (details: Record<string, unknown>) =>
  POST(jsonRequest('/api/register/group-join', { token: 'tok', details }))

let onFile: (c: DbCall) => DbResult | undefined

const clerkCalled = () =>
  h.clerk.getUserList.mock.calls.length + h.clerk.create.mock.calls.length + h.clerk.createSignInToken.mock.calls.length

beforeEach(() => {
  vi.clearAllMocks()
  rec.reset()
  onFile = () => undefined
  rec.respond((c) => {
    const hit = onFile(c)
    if (hit) return hit
    if (c.table === 'group_join_tokens') return { data: LINK, error: null }
    return undefined
  })
  h.getEventBySlug.mockResolvedValue(OPEN_EVENT)
  h.upsertMember.mockResolvedValue('m-1')
  h.clerk.getUserList.mockResolvedValue({ data: [] })
  h.clerk.create.mockResolvedValue({ id: 'user_new_placeholder' })
  h.clerk.createSignInToken.mockResolvedValue({ token: 'ticket_placeholder' })
})

describe('POST /api/register/group-join — a match by school address is not new', () => {
  it('control: a brand-new address is new, and gets a sign-in token', async () => {
    const res = await settle(await post(DETAILS))
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ signInToken: 'ticket_placeholder' })
    expect(h.clerk.createSignInToken).toHaveBeenCalledTimes(1)
  })

  it.each<[string, string, string, Record<string, unknown>]>([
    ["their address is a member's school address", 'school_email', 'kid@example.com', {}],
    ['the school address they submit is a member’s email', 'email', 'old@school.example.com', { school_email: 'old@school.example.com' }],
    ['the school address they submit is another member’s school address', 'school_email', 'old@school.example.com', { school_email: 'old@school.example.com' }],
  ])('%s: asked to sign in, with no token, no login and nothing written', async (_case, column, value, extra) => {
    onFile = (c) =>
      c.table === 'members' && c.op === 'select' && eqFilter(c, column, value)
        ? { data: { id: 'm-prior' }, error: null }
        : undefined
    const res = await settle(await post({ ...DETAILS, ...extra }))
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ code: 'sign_in_required' })
    expect(res.body).not.toHaveProperty('signInToken')
    expect(clerkCalled()).toBe(0)
    expect(h.upsertMember).not.toHaveBeenCalled()
    expect(rec.calls.filter((c) => c.op !== 'select')).toEqual([])
  })
})
