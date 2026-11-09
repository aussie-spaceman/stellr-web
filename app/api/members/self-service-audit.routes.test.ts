// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// docs/TENANCY-S5.md, B16: what each member route records, end to end down to the
// platform_audit_append call. The rows go on Stellr's chain, name a row as their target
// only when the member's own write reached it, and carry no consent or visibility
// choice. With PLATFORM_AUDIT_ENABLED off the routes run their queries exactly as before.

const MEMBER = '33333333-3333-4333-8333-333333333333'
const ADDRESS = '55555555-5555-4555-8555-555555555555'
const REGISTRATION = '66666666-6666-4666-8666-666666666666'
const PARTICIPATION = '77777777-7777-4777-8777-777777777777'

interface Write { table: string; op: string; returning: boolean }

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  afters: [] as Array<() => Promise<unknown>>,
  rows: [] as Array<Record<string, unknown>>,
  writes: [] as Write[],
  /** What maybeSingle/single return, by table. */
  reads: {} as Record<string, unknown>,
  /** The ids an update or delete reaches, by table, when asked for them. */
  reached: {} as Record<string, Array<{ id: string }>>,
  member: null as Record<string, unknown> | null,
}))

vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (task: () => Promise<unknown>) => {
    h.afters.push(task)
  },
}))
vi.mock('@clerk/nextjs/server', () => ({ auth: h.auth }))
vi.mock('@/lib/app-errors', () => ({ captureRequestError: async () => {} }))
vi.mock('@/lib/supabase', () => {
  function builder(table: string) {
    const w: Write = { table, op: 'select', returning: false }
    const settle = () => {
      if (w.op === 'select') return { data: h.reads[table] ?? null, error: null }
      h.writes.push({ ...w })
      return { data: w.returning ? (h.reached[table] ?? []) : null, error: null }
    }
    const b: Record<string, unknown> = {
      select: () => {
        if (w.op !== 'select') w.returning = true
        return b
      },
      insert: () => ((w.op = 'insert'), b),
      update: () => ((w.op = 'update'), b),
      upsert: () => ((w.op = 'upsert'), b),
      delete: () => ((w.op = 'delete'), b),
      eq: () => b,
      neq: () => b,
      order: () => b,
      maybeSingle: async () => settle(),
      single: async () => settle(),
      then: (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve(settle()).then(ok, no),
    }
    return b
  }
  return {
    supabaseServer: () => ({
      from: builder,
      rpc: async (_fn: string, args: Record<string, unknown>) => {
        h.rows.push(args)
        return { data: { id: h.rows.length, chain_seq: h.rows.length }, error: null }
      },
    }),
  }
})
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/store/auth', () => ({ currentStoreMember: async () => h.member }))
vi.mock('@/lib/community', () => ({ getCurrentMember: async () => h.member, memberIsMinor: () => false }))
vi.mock('@/lib/activity-log', () => ({ logActivity: async () => {} }))
vi.mock('@/lib/survey/privacy-prefs', () => ({ showsPrivacyToggles: () => true }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => ({}) }))
vi.mock('@/lib/registration-checkout', () => ({
  createRegistrationCheckout: async () => ({ url: 'https://checkout.example/pay' }),
  RegistrationCheckoutError: class extends Error {},
}))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: async () => null }))
vi.mock('@/lib/refunds/preview', () => ({
  previewRefund: async () => ({ paid: false, options: {}, currency: 'usd', guaranteeDays: 45, daysSincePayment: null }),
}))
vi.mock('@/lib/deletion/execute', () => ({ executeDeletion: async () => {}, DeletionBlockedError: class extends Error {} }))
vi.mock('@/lib/event-participation-sync', () => ({ removeEventParticipation: async () => {} }))
vi.mock('@/lib/notify', () => ({ notifyCommunityAdmins: async () => {} }))

import { PATCH as updateAddress, DELETE as deleteAddress } from './addresses/route'
import { POST as createPaymentLink } from './billing/payment-link/route'
import { GET as previewWithdrawal } from './registrations/[id]/withdraw/route'
import { PATCH as saveDirectoryPrefs } from './directory-prefs/route'
import { PATCH as savePrivacyPrefs } from './privacy-prefs/route'
import { DELETE as deleteParticipation } from './event-participations/[id]/route'
import { resetAuditBudget } from '@/lib/community/self-service-audit'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

const send = (method: string, path: string, body?: unknown) =>
  new Request(`http://x${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const flush = async () => {
  for (const task of h.afters.splice(0)) await task()
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
  h.afters = []
  h.rows = []
  h.writes = []
  h.reached = {}
  h.member = { id: MEMBER, first_name: 'Jane', email: 'jane@example.org' }
  h.reads = {
    members: { id: MEMBER, email: 'jane@example.org', first_name: 'Jane', last_name: 'Doe' },
    registrations: { id: REGISTRATION, type: 'individual', status: 'pending', event_slug: 'tenant-event-2027', event_title: 'Tenant Event' },
    participants: { id: '88888888-8888-4888-8888-888888888888', member_id: MEMBER, checked_in_at: null, individual_payment_status: null },
  }
  h.auth.mockReset()
  h.auth.mockResolvedValue({ userId: 'user_2member' })
  resetAuditBudget()
})

describe('a write naming a row by id', () => {
  it('records the row as its target when the member\'s own write reached it', async () => {
    h.reached.member_addresses = [{ id: ADDRESS }]
    expect((await updateAddress(send('PATCH', '/api/members/addresses', { id: ADDRESS, city: 'Reno' }))).status).toBe(200)
    expect((await deleteAddress(send('DELETE', `/api/members/addresses?id=${ADDRESS}`))).status).toBe(200)
    h.reached.event_participations = [{ id: PARTICIPATION }]
    expect((await deleteParticipation(send('DELETE', '/x'), { params: Promise.resolve({ id: PARTICIPATION }) })).status).toBe(200)
    await flush()
    expect(h.rows.map((r) => [r.p_action, r.p_target_table, r.p_target_id, r.p_metadata])).toEqual([
      ['member.address.update', 'member_addresses', ADDRESS, { matched: 1, status: 200 }],
      ['member.address.delete', 'member_addresses', ADDRESS, { matched: 1, status: 200 }],
      ['member.event_participation.delete', 'event_participations', PARTICIPATION, { matched: 1, status: 200 }],
    ])
  })

  it('records no target when the id is not the member\'s, and the answer is unchanged', async () => {
    const res = await updateAddress(send('PATCH', '/api/members/addresses', { id: ADDRESS, city: 'Reno' }))
    expect([res.status, await res.json()]).toEqual([200, { ok: true }])
    const del = await deleteAddress(send('DELETE', `/api/members/addresses?id=${ADDRESS}`))
    expect([del.status, await del.json()]).toEqual([200, { ok: true }])
    await deleteParticipation(send('DELETE', '/x'), { params: Promise.resolve({ id: PARTICIPATION }) })
    await flush()
    expect(h.rows.map((r) => [r.p_target_id, r.p_metadata])).toEqual([
      [null, { matched: 0, status: 200 }],
      [null, { matched: 0, status: 200 }],
      [null, { matched: 0, status: 200 }],
    ])
    expect(JSON.stringify(h.rows)).not.toContain(ADDRESS)
  })

  it('with the flag off runs the same queries, asking for no rows back', async () => {
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
    h.reached.member_addresses = [{ id: ADDRESS }]
    await updateAddress(send('PATCH', '/api/members/addresses', { id: ADDRESS, city: 'Reno' }))
    await deleteAddress(send('DELETE', `/api/members/addresses?id=${ADDRESS}`))
    await deleteParticipation(send('DELETE', '/x'), { params: Promise.resolve({ id: PARTICIPATION }) })
    await flush()
    expect(h.writes).toEqual([
      { table: 'member_addresses', op: 'update', returning: false },
      { table: 'member_addresses', op: 'delete', returning: false },
      { table: 'event_participations', op: 'delete', returning: false },
    ])
    expect(h.rows).toEqual([])
  })
})

describe('a member\'s registration payment and withdrawal', () => {
  it('go on Stellr\'s chain, with the registration as the target', async () => {
    expect((await createPaymentLink(send('POST', '/api/members/billing/payment-link', { registrationId: REGISTRATION }) as never)).status).toBe(200)
    expect((await previewWithdrawal(send('GET', '/x'), { params: Promise.resolve({ id: REGISTRATION }) })).status).toBe(200)
    await flush()
    expect(h.rows.map((r) => [r.p_tenant, r.p_action, r.p_target_table, r.p_target_id])).toEqual([
      [STELLR_TENANT_ID, 'member.payment_link.create', 'registrations', REGISTRATION],
      [STELLR_TENANT_ID, 'member.registration.withdraw_preview', 'registrations', REGISTRATION],
    ])
  })
})

describe('consent and visibility choices', () => {
  it('record which setting changed, never the choice', async () => {
    expect((await savePrivacyPrefs(send('PATCH', '/api/members/privacy-prefs', { allow_media: false }))).status).toBe(200)
    expect((await savePrivacyPrefs(send('PATCH', '/api/members/privacy-prefs', { allow_quotes: true, allow_media: true }))).status).toBe(200)
    expect((await saveDirectoryPrefs(send('PATCH', '/api/members/directory-prefs', { is_visible: false }))).status).toBe(200)
    await flush()
    expect(h.rows.map((r) => [r.p_action, r.p_metadata])).toEqual([
      ['member.privacy_prefs.update', { quotes_changed: false, media_changed: true, status: 200 }],
      ['member.privacy_prefs.update', { quotes_changed: true, media_changed: true, status: 200 }],
      ['member.directory_prefs.update', { status: 200 }],
    ])
  })
})
