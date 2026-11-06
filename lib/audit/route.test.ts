// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// lib/audit/route.ts: who and whose chain an event names, and that nothing here
// can fail a live request.

const capture = vi.fn()
vi.mock('@/lib/app-errors', async () => {
  const real = await vi.importActual<typeof import('@/lib/app-errors')>('@/lib/app-errors')
  return { scrubMessage: real.scrubMessage, captureRequestError: (...a: unknown[]) => capture(...a) }
})
const serverClient = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => serverClient() }))
const auth = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({ auth: () => auth() }))
const after = vi.fn()
vi.mock('next/server', () => ({ after: (task: () => unknown) => after(task) }))

const { auditMutation, isStorableTargetId, resolveActor, resolveTenant, withAudit } = await import('./route')
const { AUDIT_FLAG, RECORD_FAILURE_TIMEOUT_MS } = await import('./platform')
const nextNavigation = await import('next/navigation')

const row = { id: 1, chain_seq: 1 }
const TENANT_B = 'bbbbbbbb-0000-4000-8000-00000000000b'
const RECORD_ID = 'cccccccc-0000-4000-8000-00000000000c'
/** An audit rpc, and the events mirror the real lib/events/mirror reads through the same client. */
const fakeDb = (answer: () => unknown = () => Promise.resolve({ data: row, error: null }), mirror: () => unknown = () => Promise.resolve({ data: null, error: null })) => {
  const rpc = vi.fn(answer)
  const from = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: mirror }) }) }))
  return { rpc, from, db: { rpc, from } as never }
}
const SPEC = { action: 'support.impersonate.start', actor: { system: true }, tenant: { stellr: true } } as const

beforeEach(() => {
  vi.clearAllMocks()
  after.mockImplementation(() => {
    throw new Error('outside a request')
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('resolveActor', () => {
  it('names a verified user, a cron job, a webhook provider and the system', async () => {
    expect(await resolveActor({ userId: 'user_2abc' })).toEqual({ actor: 'user_2abc', metadata: {} })
    expect(await resolveActor({ cron: 'apollo-reconcile' })).toEqual({ actor: 'cron:apollo-reconcile', metadata: {} })
    expect(await resolveActor({ webhook: 'stripe' })).toEqual({ actor: 'webhook:stripe', metadata: {} })
    expect(await resolveActor({ system: true })).toEqual({ actor: 'system', metadata: {} })
  })

  it('reads the signed-in user only when asked', async () => {
    auth.mockResolvedValue({ userId: 'user_session1' })
    expect(await resolveActor({ session: true })).toEqual({ actor: 'user_session1', metadata: {} })
    auth.mockResolvedValue({ userId: null })
    expect(await resolveActor({ session: true })).toEqual({ actor: 'system', metadata: { actor_anonymous: true } })
  })

  it('marks an actor it cannot name, rather than failing or storing it', async () => {
    auth.mockRejectedValue(new Error('clerk down'))
    expect(await resolveActor({ session: true })).toEqual({ actor: 'system', metadata: { actor_unresolved: true } })
    for (const a of [{ webhook: 'Not Valid' }, { webhook: 'a'.repeat(33) }, { cron: 'Bad Job' }, { userId: 'someone@example.test' }]) {
      expect(await resolveActor(a), JSON.stringify(a)).toEqual({ actor: 'system', metadata: { actor_unresolved: true } })
    }
  })
})

describe('resolveTenant', () => {
  it('takes Stellr, a resolved id, the platform chain, or an event from the mirror', async () => {
    expect(await resolveTenant({ stellr: true })).toEqual({ tenantId: STELLR_TENANT_ID, metadata: {} })
    expect(await resolveTenant({ tenantId: 'aaaaaaaa-0000-4000-8000-00000000000a' })).toEqual({ tenantId: 'aaaaaaaa-0000-4000-8000-00000000000a', metadata: {} })
    expect(await resolveTenant({ tenantId: null })).toEqual({ tenantId: null, metadata: {} })
    const { db } = fakeDb(undefined, () => Promise.resolve({ data: { tenant_id: TENANT_B }, error: null }))
    expect(await resolveTenant({ eventSlug: 'nevada' }, { db })).toEqual({ tenantId: TENANT_B, metadata: {} })
  })

  // The real mirror read, not a mock: a row on the wrong tenant's chain can never be moved.
  it('goes to the platform chain, marked, when the mirror misses or the read fails', async () => {
    const unresolved = { tenantId: null, metadata: { tenant_unresolved: true } }
    expect(await resolveTenant({ eventSlug: 'nevada' }, { db: fakeDb().db })).toEqual(unresolved)
    const failing = fakeDb(undefined, () => Promise.resolve({ data: null, error: { message: 'down' } }))
    expect(await resolveTenant({ eventSlug: 'nevada' }, { db: failing.db })).toEqual(unresolved)
    const throwing = fakeDb(undefined, () => Promise.reject(new Error('connection reset')))
    expect(await resolveTenant({ eventSlug: 'nevada' }, { db: throwing.db })).toEqual(unresolved)
  })
})

describe('isStorableTargetId', () => {
  it('takes a uuid or an id a provider issued', () => {
    for (const id of [RECORD_ID, 'user_2abc', 'org_2abc', 'cs_test_1', 'pi_3AbC', 'evt_1']) expect(isStorableTargetId(id), id).toBe(true)
  })

  it('refuses what the table CHECK would let through, because the row can never be erased', () => {
    const notIds = [
      'someone@example.test',
      '2010-03-04',
      '03/04/2010',
      '555-123-4567',
      '+15551234567',
      'jane-smith',
      'jane_smith',
      'nevada-2026',
      'STL-2026-00012',
      'r-1',
      'a'.repeat(64),
      'k1MxZq8nVtY3pLw0sRf7Ue2bHd9GaCj4',
      '',
    ]
    for (const id of notIds) expect(isStorableTargetId(id), id).toBe(false)
  })
})

describe('auditMutation', () => {
  it('with the flag off does nothing at all: no session, no lookup, no query, nothing scheduled', async () => {
    const { db, rpc, from } = fakeDb()
    const res = await auditMutation({ ...SPEC, actor: { session: true }, tenant: { eventSlug: 'nevada' } }, { db, afterResponse: true })
    expect(res).toEqual({ ok: false, skipped: 'disabled' })
    for (const fn of [auth, from, rpc, after, serverClient]) expect(fn).not.toHaveBeenCalled()
  })

  it('is off unless the flag is exactly true', async () => {
    const { db, rpc } = fakeDb()
    for (const v of ['false', '1', 'TRUE', '']) {
      vi.stubEnv(AUDIT_FLAG, v)
      expect(await auditMutation(SPEC, { db })).toEqual({ ok: false, skipped: 'disabled' })
    }
    expect(rpc).not.toHaveBeenCalled()
    vi.stubEnv(AUDIT_FLAG, 'true')
    expect(await auditMutation(SPEC, { db })).toEqual({ ok: true, id: 1, seq: 1 })
  })

  it('writes the resolved actor, chain and target', async () => {
    const { db, rpc } = fakeDb()
    const res = await auditMutation(
      { action: 'webhook.event.process', actor: { webhook: 'stripe' }, tenant: { stellr: true }, target: { table: 'registrations', id: RECORD_ID }, metadata: { attempt: 2 } },
      { db, enabled: true },
    )
    expect(res).toEqual({ ok: true, id: 1, seq: 1 })
    expect(rpc).toHaveBeenCalledWith('platform_audit_append', {
      p_tenant: STELLR_TENANT_ID,
      p_actor: 'webhook:stripe',
      p_actor_kind: 'webhook',
      p_action: 'webhook.event.process',
      p_target_table: 'registrations',
      p_target_id: RECORD_ID,
      p_reason: null,
      p_metadata: { attempt: 2 },
    })
  })

  it('keeps the event, without the id, when a target id is not one it may store', async () => {
    for (const id of ['someone@example.test', '2010-03-04', '555-123-4567', 'k1MxZq8nVtY3pLw0sRf7Ue2bHd9GaCj4']) {
      const { db, rpc } = fakeDb()
      await auditMutation({ ...SPEC, target: { table: 'members', id } }, { db, enabled: true })
      expect(rpc, id).toHaveBeenCalledWith('platform_audit_append', expect.objectContaining({ p_target_table: 'members', p_target_id: null, p_metadata: { target_id_dropped: true } }))
    }
  })

  it('files an event the mirror cannot place on the platform chain, marked, not on Stellr', async () => {
    const { db, rpc } = fakeDb()
    await auditMutation({ ...SPEC, tenant: { eventSlug: 'unmirrored' } }, { db, enabled: true })
    expect(rpc).toHaveBeenCalledWith('platform_audit_append', expect.objectContaining({ p_tenant: null, p_metadata: { tenant_unresolved: true } }))
  })

  it('a hung Clerk or mirror read cannot hold the caller past the budget, and the event is still written, marked', async () => {
    auth.mockReturnValue(new Promise(() => {}))
    const { db, rpc } = fakeDb(undefined, () => new Promise(() => {}))
    const started = Date.now()
    const res = await Promise.race([
      auditMutation({ ...SPEC, actor: { session: true }, tenant: { eventSlug: 'nevada' } }, { db, enabled: true, timeoutMs: 20 }),
      new Promise((r) => setTimeout(() => r('still waiting'), 500)),
    ])
    expect(res).toEqual({ ok: true, id: 1, seq: 1 })
    expect(Date.now() - started).toBeLessThan(500)
    expect(rpc).toHaveBeenCalledWith('platform_audit_append', expect.objectContaining({ p_tenant: null, p_actor: 'system', p_metadata: { actor_unresolved: true, tenant_unresolved: true } }))
  })

  it('a hung lookup and a hung write together stay inside the budget', async () => {
    auth.mockReturnValue(new Promise(() => {}))
    const { db } = fakeDb(() => new Promise(() => {}))
    const started = Date.now()
    const res = await auditMutation({ ...SPEC, actor: { session: true } }, { db, enabled: true, timeoutMs: 40 })
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining('timed out') })
    expect(Date.now() - started).toBeLessThan(RECORD_FAILURE_TIMEOUT_MS)
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('recording the failure cannot hold the caller either, when that database hangs too', async () => {
    capture.mockReturnValue(new Promise(() => {}))
    const { db } = fakeDb(() => new Promise(() => {}))
    const res = await Promise.race([
      auditMutation(SPEC, { db, enabled: true, timeoutMs: 5 }),
      new Promise((r) => setTimeout(() => r('still waiting'), RECORD_FAILURE_TIMEOUT_MS + 500)),
    ])
    expect(res).toMatchObject({ ok: false, error: expect.any(String) })
    capture.mockReset()
  })

  it('never throws, and records the failure, when the database refuses, is down, or hangs', async () => {
    const answers = [
      () => Promise.resolve({ data: null, error: { message: 'check violation' } }),
      () => Promise.reject(new Error('connection reset')),
      () => {
        throw new Error('sync failure')
      },
      () => new Promise(() => {}),
    ]
    for (const answer of answers) {
      capture.mockClear()
      const res = await auditMutation(SPEC, { db: fakeDb(answer).db, enabled: true, timeoutMs: 5 })
      expect(res).toMatchObject({ ok: false, error: expect.any(String) })
      expect(capture).toHaveBeenCalledTimes(1)
    }
  })

  it('never throws on input nothing should send', async () => {
    await expect(auditMutation(null as never, { enabled: true })).resolves.toMatchObject({ ok: false, error: expect.any(String) })
  })

  it('afterResponse adds no awaited latency: it answers while the write is still hanging', async () => {
    const { db, rpc } = fakeDb(() => new Promise(() => {}))
    const started = Date.now()
    const res = await Promise.race([
      auditMutation(SPEC, { db, enabled: true, afterResponse: true, timeoutMs: 60_000 }),
      new Promise((r) => setTimeout(() => r('still waiting'), 50)),
    ])
    expect(res).toEqual({ ok: false, skipped: 'deferred' })
    expect(Date.now() - started).toBeLessThan(50)
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1))
  })

  it('afterResponse registers with after() inside a request, so the instance stays up for it', async () => {
    let task: (() => Promise<unknown>) | undefined
    after.mockImplementation((t: () => Promise<unknown>) => {
      task = t
    })
    const { db, rpc } = fakeDb()
    await auditMutation(SPEC, { db, enabled: true, afterResponse: true })
    expect(rpc).not.toHaveBeenCalled()
    await task?.()
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})

describe('withAudit', () => {
  const on = { enabled: true, afterResponse: false }

  it('records one event for a success, on any path through the handler', async () => {
    const { db, rpc } = fakeDb()
    const POST = withAudit(SPEC, async (fast: boolean) => (fast ? new Response('early') : new Response('late', { status: 201 })), { ...on, db })
    expect((await POST(true)).status).toBe(200)
    expect((await POST(false)).status).toBe(201)
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[1]).toEqual(['platform_audit_append', expect.objectContaining({ p_metadata: { status: 201 } })])
  })

  it('records nothing for a refusal, and records a 5xx, which may have done part of the work', async () => {
    const { db, rpc } = fakeDb()
    const handler = withAudit(SPEC, async (status: number) => new Response(null, { status }), { ...on, db })
    for (const status of [400, 401, 403, 404, 409, 422, 429]) await handler(status)
    expect(rpc).not.toHaveBeenCalled()
    await handler(500)
    expect(rpc.mock.calls[0]).toEqual(['platform_audit_append', expect.objectContaining({ p_metadata: { status: 500 } })])
  })

  it('records a throw and rethrows the same error', async () => {
    const { db, rpc } = fakeDb()
    const boom = new Error('boom')
    const handler = withAudit(SPEC, async () => {
      throw boom
    }, { ...on, db })
    await expect(handler()).rejects.toBe(boom)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('returns the same response object, whatever happens to the audit', async () => {
    const res = new Response('body')
    for (const answer of [() => Promise.reject(new Error('down')), () => new Promise(() => {})]) {
      const handler = withAudit(SPEC, async () => res, { ...on, db: fakeDb(answer).db, timeoutMs: 5 })
      expect(await handler()).toBe(res)
    }
  })

  it('a spec that answers with nothing is a recorded failure, not a silent skip', async () => {
    const { db, rpc } = fakeDb()
    const res = new Response('ok')
    expect(await withAudit((() => null) as never, async () => res, { ...on, db })()).toBe(res)
    expect(rpc).not.toHaveBeenCalled()
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('a spec function sees the request and the answer, and one that throws costs only the event', async () => {
    const { db, rpc } = fakeDb()
    const seen = vi.fn()
    const handler = withAudit(
      (o: { args: [string]; response: Response | null }) => {
        seen(o.args[0], o.response?.status)
        return SPEC
      },
      async (_id: string) => new Response(null, { status: 202 }),
      { ...on, db },
    )
    await handler('r-1')
    expect(seen).toHaveBeenCalledWith('r-1', 202)
    const res = new Response('ok')
    const broken = withAudit(() => {
      throw new Error('spec bug')
    }, async () => res, { ...on, db })
    expect(await broken()).toBe(res)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('with the flag off runs the spec never and queries nothing', async () => {
    const { db, rpc } = fakeDb()
    const spec = vi.fn(() => SPEC)
    const res = new Response('ok')
    expect(await withAudit(spec, async () => res, { db })()).toBe(res)
    expect(spec).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('by default answers before the write finishes', async () => {
    vi.stubEnv(AUDIT_FLAG, 'true')
    const hanging = vi.fn(() => new Promise(() => {}))
    serverClient.mockReturnValue({ rpc: hanging })
    const res = await Promise.race([
      withAudit(SPEC, async () => new Response('ok'))(),
      new Promise((r) => setTimeout(() => r('still waiting'), 50)),
    ])
    expect(res).toBeInstanceOf(Response)
    await vi.waitFor(() => expect(hanging).toHaveBeenCalledTimes(1))
  })

  it('still answers before the write finishes when the caller passes other options', async () => {
    const { db, rpc } = fakeDb(() => new Promise(() => {}))
    const res = await Promise.race([
      withAudit(SPEC, async () => new Response('ok'), { db, enabled: true })(),
      new Promise((r) => setTimeout(() => r('still waiting'), 50)),
    ])
    expect(res).toBeInstanceOf(Response)
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1))
  })

  describe("Next's control-flow throws", () => {
    // The real functions, so a change to the digest they carry fails here.
    const { notFound, redirect } = nextNavigation
    // forbidden() and unauthorized() are behind a Next experiment this repo does not turn on.
    const refusals = [notFound, () => {
      throw Object.assign(new Error('x'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;403' })
    }]

    it('a notFound() or a forbidden() is a refusal: no event, and the same error goes on', async () => {
      const { db, rpc } = fakeDb()
      for (const refuse of refusals) {
        let thrown: unknown
        try {
          refuse()
        } catch (e) {
          thrown = e
        }
        const handler = withAudit(SPEC, async () => {
          throw thrown
        }, { ...on, db })
        await expect(handler()).rejects.toBe(thrown)
      }
      expect(rpc).not.toHaveBeenCalled()
    })

    it('a redirect() did the work: one event, with its status, and the same error goes on', async () => {
      const { db, rpc } = fakeDb()
      let thrown: unknown
      try {
        redirect('/next;step')
      } catch (e) {
        thrown = e
      }
      const handler = withAudit(SPEC, async () => {
        throw thrown
      }, { ...on, db })
      await expect(handler()).rejects.toBe(thrown)
      expect(rpc).toHaveBeenCalledTimes(1)
      expect(rpc.mock.calls[0]).toEqual(['platform_audit_append', expect.objectContaining({ p_metadata: { status: 307 } })])
    })

    it('an error with some other digest is a 500', async () => {
      const { db, rpc } = fakeDb()
      const handler = withAudit(SPEC, async () => {
        throw Object.assign(new Error('x'), { digest: 'NEXT_REDIRECT;nonsense' })
      }, { ...on, db })
      await expect(handler()).rejects.toThrow('x')
      expect(rpc.mock.calls[0]).toEqual(['platform_audit_append', expect.objectContaining({ p_metadata: { status: 500 } })])
    })
  })
})
