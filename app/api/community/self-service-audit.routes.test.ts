// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// docs/TENANCY-S5.md, B16: the member and community routes audit through
// lib/community/self-service-audit and the real lib/audit modules. Two routes stand
// for the sweep, end to end down to the platform_audit_append call: one under
// app/api/community and one under app/api/members. Every other route in the sweep
// has the same two helpers, which the coverage gate (test/audit-coverage.test.ts)
// reads in each file.

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  afters: [] as Array<() => Promise<unknown>>,
  rows: [] as Array<Record<string, unknown>>,
  rpc: vi.fn(),
  upsert: vi.fn(),
  flagMessage: vi.fn(),
  member: { id: '33333333-3333-4333-8333-333333333333', first_name: 'Jane', email: 'jane@example.org' } as Record<string, unknown> | null,
}))

vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (task: () => Promise<unknown>) => {
    h.afters.push(task)
  },
}))
vi.mock('@clerk/nextjs/server', () => ({ auth: h.auth }))
vi.mock('@/lib/app-errors', () => ({ captureRequestError: async () => {} }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({ rpc: h.rpc, from: () => ({ upsert: h.upsert }) }),
}))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/onboarded-member', () => ({ getOnboardedMember: async () => h.member }))
vi.mock('@/lib/sessions', () => ({ flagMessage: h.flagMessage }))
vi.mock('@/lib/community', () => ({ getCurrentMember: async () => h.member }))
vi.mock('@/lib/activity-log', () => ({ logActivity: async () => {} }))
vi.mock('@/lib/survey/privacy-prefs', () => ({ showsPrivacyToggles: () => true }))

import { POST as flagChat } from './chat/flag/route'
import { PATCH as savePrivacyPrefs } from '../members/privacy-prefs/route'
import { resetAuditBudget } from '@/lib/community/self-service-audit'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { expectWithin } from '@/test/time-budget'

const MESSAGE = '44444444-4444-4444-8444-444444444444'
const post = (body: unknown) => new Request('http://x/api/community/chat/flag', { method: 'POST', body: JSON.stringify(body) })
const patch = (body: unknown) => new Request('http://x/api/members/privacy-prefs', { method: 'PATCH', body: JSON.stringify(body) })
const flush = async () => {
  for (const task of h.afters.splice(0)) await task()
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
  h.afters = []
  h.rows = []
  h.member = { id: '33333333-3333-4333-8333-333333333333', first_name: 'Jane', email: 'jane@example.org' }
  h.auth.mockReset()
  h.auth.mockResolvedValue({ userId: 'user_2member' })
  h.rpc.mockReset()
  h.rpc.mockImplementation(async (_fn: string, args: Record<string, unknown>) => {
    h.rows.push(args)
    return { data: { id: h.rows.length, chain_seq: h.rows.length }, error: null }
  })
  h.upsert.mockReset()
  h.upsert.mockResolvedValue({ error: null })
  h.flagMessage.mockReset()
  h.flagMessage.mockResolvedValue(true)
  resetAuditBudget()
})

describe('with PLATFORM_AUDIT_ENABLED off, the default', () => {
  it('answers as before, reads no session, schedules nothing and writes no event', async () => {
    const a = await flagChat(post({ messageId: MESSAGE }))
    const b = await savePrivacyPrefs(patch({ allow_quotes: false }))
    expect([a.status, await a.json(), b.status, await b.json()]).toEqual([200, { ok: true }, 200, { ok: true }])
    expect(h.auth).not.toHaveBeenCalled()
    expect(h.afters).toEqual([])
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('a handler that throws still throws', async () => {
    h.flagMessage.mockRejectedValue(new Error('db down'))
    await expect(flagChat(post({ messageId: MESSAGE }))).rejects.toThrow('db down')
    expect(h.afters).toEqual([])
  })
})

describe('with it on', () => {
  beforeEach(() => vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true'))

  it('writes one event after the response: the signed-in user, Stellr, the row, the status', async () => {
    const res = await flagChat(post({ messageId: MESSAGE }))
    expect(res.status).toBe(200)
    expect(h.rows).toEqual([])
    await flush()
    expect(h.rows).toEqual([
      {
        p_tenant: STELLR_TENANT_ID,
        p_actor: 'user_2member',
        p_actor_kind: 'user',
        p_action: 'community.chat_message.flag',
        p_target_table: 'chat_messages',
        p_target_id: MESSAGE,
        p_reason: null,
        p_metadata: { status: 200 },
      },
    ])
  })

  it('writes nothing for a refusal', async () => {
    expect((await flagChat(post({}))).status).toBe(400)
    h.flagMessage.mockResolvedValue(false)
    expect((await flagChat(post({ messageId: MESSAGE }))).status).toBe(400)
    h.member = null
    expect((await flagChat(post({ messageId: MESSAGE }))).status).toBe(401)
    await flush()
    expect(h.rows).toEqual([])
  })

  it('records a handler that threw as a 500, and the error still reaches the caller', async () => {
    h.flagMessage.mockRejectedValue(new Error('db down'))
    await expect(flagChat(post({ messageId: MESSAGE }))).rejects.toThrow('db down')
    await flush()
    expect(h.rows).toHaveLength(1)
    expect(h.rows[0]).toMatchObject({ p_action: 'community.chat_message.flag', p_target_id: null, p_metadata: { status: 500 } })
  })

  it('a failed or hung audit write changes no answer and holds up no response', async () => {
    h.rpc.mockImplementation(() => new Promise(() => {}))
    const started = performance.now()
    const res = await savePrivacyPrefs(patch({ allow_media: true }))
    expectWithin(started, 250)
    expect([res.status, await res.json()]).toEqual([200, { ok: true }])
    h.rpc.mockRejectedValue(new Error('audit down'))
    const again = await flagChat(post({ messageId: MESSAGE }))
    await flush()
    expect([again.status, await again.json()]).toEqual([200, { ok: true }])
  })

  it('keeps the member\'s name, email and the request body out of the row', async () => {
    await savePrivacyPrefs(patch({ allow_quotes: true }))
    await flush()
    expect(h.rows[0]).toMatchObject({
      p_action: 'member.privacy_prefs.update',
      p_target_table: 'member_privacy_prefs',
      p_metadata: { quotes_changed: true, media_changed: false, status: 200 },
    })
    const row = JSON.stringify(h.rows)
    expect(row).not.toContain('Jane')
    expect(row).not.toContain('example.org')
  })

  it('a member repeating an action that is not high-volume is recorded every time', async () => {
    for (let i = 0; i < 125; i++) expect((await flagChat(post({ messageId: MESSAGE }))).status).toBe(200)
    expect(h.flagMessage).toHaveBeenCalledTimes(125)
    await flush()
    expect(h.rows).toHaveLength(125)
    expect(h.rows.every((r) => JSON.stringify(r.p_metadata) === JSON.stringify({ status: 200 }))).toBe(true)
  })
})
