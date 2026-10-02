// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'

const { sent, notify } = vi.hoisted(() => ({ sent: [] as { to: string; text: string }[], notify: vi.fn(async () => {}) }))
vi.mock('@/lib/email', () => ({ sendEmail: async (m: { to: string; text: string }) => { sent.push(m); return { id: 're_1' } } }))
vi.mock('@/lib/notify', () => ({ notifyCommunityAdmins: notify }))

import { confirmRequest, findMatches, purgeRequests, requestSchema, resolveRequest, submitRequest } from './privacy-requests'

const valid = { kind: 'deletion', relationship: 'parent_guardian', requesterName: 'Pat Lee', requesterEmail: 'Pat@Example.test', subjectName: 'Sam Lee' }
const linkIn = (text: string) => /\/privacy\/request\/confirm#(\S+)/.exec(text)?.[1] as string

beforeEach(() => {
  sent.length = 0
  vi.clearAllMocks()
  vi.stubEnv('ESIGN_TOKEN_SECRET', 'k'.repeat(48))
})
afterEach(() => vi.unstubAllEnvs())

describe('requestSchema', () => {
  it('needs the child’s name for a parent’s request, and refuses a filled honeypot', () => {
    expect(requestSchema.safeParse({ ...valid, subjectName: '' }).success).toBe(false)
    expect(requestSchema.safeParse({ ...valid, website: 'http://spam.test' }).success).toBe(false)
    expect(requestSchema.parse(valid).requesterEmail).toBe('pat@example.test')
  })
})

describe('a request, from form to answer', () => {
  it('counts only once the emailed link is followed, and the link works once', async () => {
    const db = fakeSupabase({ privacy_requests: [] })
    await submitRequest(db.client, requestSchema.parse(valid))
    const row = db.table('privacy_requests')[0]
    expect(row).toMatchObject({ status: 'unverified', kind: 'deletion', requester_email: 'pat@example.test' })
    expect(sent.map((m) => m.to)).toEqual(['pat@example.test'])
    expect(notify).not.toHaveBeenCalled()

    const token = linkIn(sent[0].text)
    expect(await confirmRequest(db.client, token, { ip: '203.0.113.5' })).toBe('confirmed')
    expect(db.table('privacy_requests')[0]).toMatchObject({ status: 'verified', verified_ip: '203.0.113.5' })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(await confirmRequest(db.client, token, { ip: null })).toBe('already_confirmed')
    expect(await confirmRequest(db.client, `${row.id}.r1.9999999999.forged`, { ip: null })).toBe('invalid')

    expect(await resolveRequest(db.client, row.id as string, { status: 'completed', note: 'Deleted Sam’s account' }, 'Admin A')).toBe(true)
    expect(db.table('privacy_requests')[0]).toMatchObject({ status: 'completed', handled_by: 'Admin A' })
    // Closed: cannot be reopened through the same route.
    expect(await resolveRequest(db.client, row.id as string, { status: 'refused', note: 'x' }, 'Admin B')).toBe(false)
  })

  it('a signing link cannot confirm a request', async () => {
    const db = fakeSupabase({ privacy_requests: [] })
    await submitRequest(db.client, requestSchema.parse(valid))
    const { mintToken } = await import('@/lib/esign/native/tokens')
    const signing = mintToken(db.table('privacy_requests')[0].id as string, 'sign', 1, 3600).token
    expect(await confirmRequest(db.client, signing, { ip: null })).toBe('invalid')
  })

  it('sends at most three emails a day to one address, saying the same on screen', async () => {
    const db = fakeSupabase({ privacy_requests: [] })
    for (let i = 0; i < 5; i++) await submitRequest(db.client, requestSchema.parse(valid))
    expect(sent).toHaveLength(3)
  })
})

describe('findMatches', () => {
  it('finds records by own or guardian address, case-insensitively, and treats _ in an address literally', async () => {
    const db = fakeSupabase({
      members: [
        { id: 'm1', first_name: 'Pat', last_name: 'Lee', email: 'PAT_LEE@example.test', ec_email: null, deleted_at: null, event_role: 'adult' },
        { id: 'm2', first_name: 'Sam', last_name: 'Lee', email: 'sam@example.test', ec_email: 'pat_lee@example.test', deleted_at: null, event_role: 'participant' },
        { id: 'm3', first_name: 'Other', last_name: 'Person', email: 'patxlee@example.test', ec_email: null, deleted_at: null, event_role: 'adult' },
      ],
      participants: [],
    })
    const found = await findMatches(db.client, 'pat_lee@example.test')
    expect(found.map((m) => [m.id, m.via])).toEqual([['m1', 'own email'], ['m2', 'guardian email']])
  })
})

describe('purgeRequests', () => {
  it('deletes unconfirmed requests after 30 days and answered ones after 3 years', async () => {
    const now = new Date('2026-10-02T00:00:00Z')
    const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString()
    const db = fakeSupabase({
      privacy_requests: [
        { id: 'stale', status: 'unverified', created_at: ago(31) },
        { id: 'fresh', status: 'unverified', created_at: ago(5) },
        { id: 'old-done', status: 'completed', created_at: ago(1200), handled_at: ago(1100) },
        { id: 'open', status: 'verified', created_at: ago(400) },
      ],
    })
    expect(await purgeRequests(db.client, now)).toEqual({ unverified: 1, handled: 1 })
    expect(db.table('privacy_requests').map((r) => r.id).sort()).toEqual(['fresh', 'open'])
  })
})
