// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@clerk/nextjs/server', () => ({ auth }))

import {
  AUDIT_ROWS_PER_WINDOW,
  AUDIT_WINDOW_MS,
  auditBudget,
  HIGH_VOLUME_ACTIONS,
  knownOperation,
  noteAudit,
  resetAuditBudget,
  selfServiceEvent,
} from './self-service-audit'

const req = () => new Request('http://x/api/community/thing', { method: 'POST' })
const ok = () => new Response('{}', { status: 200 })
const spec = { action: 'community.comment.create', table: 'community_comments' } as const
/** An action that is frequent by design, so its rows are capped. */
const busy = { action: 'community.reaction.toggle', table: 'community_reactions' } as const

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
  auth.mockReset()
  auth.mockResolvedValue({ userId: 'user_2member' })
  resetAuditBudget()
})
afterEach(() => vi.unstubAllEnvs())

describe('selfServiceEvent with PLATFORM_AUDIT_ENABLED off, the default', () => {
  beforeEach(() => vi.stubEnv('PLATFORM_AUDIT_ENABLED', ''))

  it('writes nothing and reads no session', async () => {
    const r = req()
    noteAudit(r, { targetId: '11111111-1111-4111-8111-111111111111' })
    expect(await selfServiceEvent(r, ok(), spec)).toBeNull()
    expect(auth).not.toHaveBeenCalled()
  })

  it('keeps no note, so turning the flag on later finds none', async () => {
    const r = req()
    noteAudit(r, { targetId: '11111111-1111-4111-8111-111111111111' })
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
    expect((await selfServiceEvent(r, ok(), spec))?.target).toEqual({ table: 'community_comments', id: null })
  })

  it('does not count towards the cap', async () => {
    for (let i = 0; i < AUDIT_ROWS_PER_WINDOW + 5; i++) await selfServiceEvent(req(), ok(), busy)
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
    expect((await selfServiceEvent(req(), ok(), busy))?.metadata).toEqual({ status: 200 })
  })
})

describe('selfServiceEvent with it on', () => {
  it('names the signed-in user, Stellr, the row and the status', async () => {
    const r = req()
    noteAudit(r, { targetId: '11111111-1111-4111-8111-111111111111', metadata: { reacted: true } })
    expect(await selfServiceEvent(r, ok(), spec)).toEqual({
      action: 'community.comment.create',
      actor: { userId: 'user_2member' },
      tenant: { stellr: true },
      target: { table: 'community_comments', id: '11111111-1111-4111-8111-111111111111' },
      metadata: { reacted: true, status: 200 },
    })
  })

  it('reads the session in the request, so the deferred write does not depend on it', async () => {
    const event = await selfServiceEvent(req(), ok(), spec)
    expect(auth).toHaveBeenCalledTimes(1)
    expect(event?.actor).toEqual({ userId: 'user_2member' })
  })

  it('leaves the session to the deferred write when it cannot be read here', async () => {
    auth.mockRejectedValue(new Error('no request'))
    expect((await selfServiceEvent(req(), ok(), spec))?.actor).toEqual({ session: true })
  })

  it('writes nothing for a refusal', async () => {
    for (const status of [400, 401, 403, 404, 409, 415, 429]) {
      expect(await selfServiceEvent(req(), new Response(null, { status }), spec), String(status)).toBeNull()
    }
    expect(auth).not.toHaveBeenCalled()
  })

  it('records a 3xx and a 5xx with the status, and a handler that threw as a 500', async () => {
    expect((await selfServiceEvent(req(), new Response(null, { status: 303 }), spec))?.metadata).toEqual({ status: 303 })
    expect((await selfServiceEvent(req(), new Response(null, { status: 502 }), spec))?.metadata).toEqual({ status: 502 })
    expect((await selfServiceEvent(req(), undefined, spec))?.metadata).toEqual({ status: 500 })
  })

  it('takes the table, the chain and later notes from what the handler noted', async () => {
    const r = req()
    noteAudit(r, { table: 'registrations', targetId: 'a' })
    noteAudit(r, { targetId: '22222222-2222-4222-8222-222222222222', tenant: { eventSlug: 'nevada-2027' }, metadata: { one: 1 } })
    noteAudit(r, { metadata: { two: 2 } })
    expect(await selfServiceEvent(r, ok(), spec)).toMatchObject({
      tenant: { eventSlug: 'nevada-2027' },
      target: { table: 'registrations', id: '22222222-2222-4222-8222-222222222222' },
      metadata: { one: 1, two: 2, status: 200 },
    })
  })

  it('a note cannot overwrite the status', async () => {
    const r = req()
    noteAudit(r, { metadata: { status: 201 } })
    expect((await selfServiceEvent(r, new Response(null, { status: 500 }), spec))?.metadata).toEqual({ status: 500 })
  })

  it('a note on one request does not reach another', async () => {
    noteAudit(req(), { targetId: '11111111-1111-4111-8111-111111111111' })
    expect((await selfServiceEvent(req(), ok(), spec))?.target).toEqual({ table: 'community_comments', id: null })
  })

  it('has no target when the route names no table', async () => {
    expect((await selfServiceEvent(req(), ok(), { action: 'community.media.publish' }))?.target).toBeNull()
  })
})

describe('the cap on audit rows', () => {
  it(`records ${AUDIT_ROWS_PER_WINDOW} rows per user for a high-volume action, one more marked coalesced, then none`, async () => {
    const seen: Array<Record<string, unknown> | null> = []
    for (let i = 0; i < AUDIT_ROWS_PER_WINDOW + 3; i++) seen.push((await selfServiceEvent(req(), ok(), busy))?.metadata ?? null)
    expect(seen.slice(0, AUDIT_ROWS_PER_WINDOW).every((m) => m && !('coalesced' in m))).toBe(true)
    expect(seen[AUDIT_ROWS_PER_WINDOW]).toEqual({ status: 200, coalesced: true })
    expect(seen.slice(AUDIT_ROWS_PER_WINDOW + 1)).toEqual([null, null])
  })

  it('caps only the actions that are frequent by design', () => {
    expect([...HIGH_VOLUME_ACTIONS].sort()).toEqual([
      'community.chat_message.create',
      'community.notifications.mark_read',
      'community.reaction.toggle',
      'community.training.progress',
      'member.survey.save',
    ])
  })

  it('a signed-in member repeating any other action is recorded every time', async () => {
    for (const action of ['member.agreement.download', 'member.profile.update', 'community.chat_message.delete', 'community.comment.create'] as const) {
      for (let i = 0; i < AUDIT_ROWS_PER_WINDOW + 3; i++) {
        const event = await selfServiceEvent(req(), ok(), { action })
        expect(event?.metadata).toEqual({ status: 200 })
      }
    }
  })

  it('exhausting a high-volume allowance leaves the member\'s other actions recorded', async () => {
    for (let i = 0; i <= AUDIT_ROWS_PER_WINDOW + 1; i++) await selfServiceEvent(req(), ok(), busy)
    expect(await selfServiceEvent(req(), ok(), busy)).toBeNull()
    expect(await selfServiceEvent(req(), ok(), { action: 'member.agreement.download' })).not.toBeNull()
  })

  it('counts each user and each action apart', async () => {
    for (let i = 0; i <= AUDIT_ROWS_PER_WINDOW + 1; i++) await selfServiceEvent(req(), ok(), busy)
    expect(await selfServiceEvent(req(), ok(), busy)).toBeNull()
    expect(await selfServiceEvent(req(), ok(), { action: 'community.chat_message.create' })).not.toBeNull()
    auth.mockResolvedValue({ userId: 'user_2other' })
    expect(await selfServiceEvent(req(), ok(), busy)).not.toBeNull()
  })

  it('every caller with no session shares one allowance per action, whatever the action', async () => {
    auth.mockResolvedValue({ userId: null })
    for (let i = 0; i <= AUDIT_ROWS_PER_WINDOW; i++) await selfServiceEvent(req(), new Response(null, { status: 500 }), spec)
    auth.mockRejectedValue(new Error('no session'))
    expect(await selfServiceEvent(req(), undefined, spec)).toBeNull()
  })

  it('starts again once the window has passed, and its first row counts what went unrecorded', () => {
    const t0 = 1_000_000
    for (let i = 0; i < AUDIT_ROWS_PER_WINDOW; i++) expect(auditBudget('user_2w', 'member.survey.save', t0).verdict).toBe('record')
    expect(auditBudget('user_2w', 'member.survey.save', t0 + 1).verdict).toBe('last')
    for (let i = 0; i < 7; i++) expect(auditBudget('user_2w', 'member.survey.save', t0 + 2).verdict).toBe('skip')
    expect(auditBudget('user_2w', 'member.survey.save', t0 + AUDIT_WINDOW_MS)).toEqual({ verdict: 'record', skippedBefore: 7 })
    expect(auditBudget('user_2w', 'member.survey.save', t0 + AUDIT_WINDOW_MS + 1)).toEqual({ verdict: 'record', skippedBefore: 0 })
  })

  it('a window with nothing skipped reports nothing', () => {
    const t0 = 2_000_000
    for (let i = 0; i <= AUDIT_ROWS_PER_WINDOW; i++) auditBudget('user_2q', 'member.survey.save', t0)
    expect(auditBudget('user_2q', 'member.survey.save', t0 + AUDIT_WINDOW_MS)).toEqual({ verdict: 'record', skippedBefore: 0 })
  })

  it('writes the skipped count on the next window\'s first row', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(10_000_000)
      for (let i = 0; i < AUDIT_ROWS_PER_WINDOW + 4; i++) await selfServiceEvent(req(), ok(), busy)
      vi.setSystemTime(10_000_000 + AUDIT_WINDOW_MS)
      expect((await selfServiceEvent(req(), ok(), busy))?.metadata).toEqual({ status: 200, skipped_before: 3 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds its own memory, and dropping a counter only lets rows through', () => {
    for (let i = 0; i < 6_000; i++) auditBudget(`user_2n${i}`, 'member.survey.save', 5)
    expect(auditBudget('user_2n0', 'member.survey.save', 6).verdict).toBe('record')
  })
})

describe('knownOperation', () => {
  it('passes a listed value and nothing else', () => {
    const ops = ['respond', 'notes'] as const
    expect(knownOperation('notes', ops)).toBe('notes')
    expect(knownOperation('Jane Doe', ops)).toBeNull()
    expect(knownOperation(undefined, ops)).toBeNull()
    expect(knownOperation({ toString: () => 'notes' }, ops)).toBeNull()
  })
})

describe('noteAudit', () => {
  it('never throws', () => {
    expect(() => noteAudit(null as unknown as Request, { targetId: 'x' })).not.toThrow()
  })
})
