// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from './constants'
import { enforcedTenantFilter, loadEventRecord, loadRecord, loadScopedRows, scopedRowWrite, type ShadowMismatch } from './load-scoped'
import { makeScope, tenantWideScope, type ScopeContext } from './scope-context'
import { TenantContextError } from './tenant-id'

// What C16's routes go through: today's query in off and shadow, the filters in enforce.

const OTHER = '11111111-1111-4111-8111-111111111111'
const ID = '22222222-2222-4222-8222-222222222222'
const stellr = tenantWideScope(STELLR_TENANT_ID, 'tenant_admin')
const canary = tenantWideScope(OTHER, 'tenant_admin')
const notFound = () => new Response('missing', { status: 404 })

type Call = [string, ...unknown[]]

/** Records every builder call, and answers each read with `answer`. */
function fakeDb(answer: { data: unknown; error?: unknown }) {
  const calls: Call[] = []
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'or', 'order', 'update', 'delete']) {
    chain[m] = (...args: unknown[]) => {
      calls.push([m, ...args])
      return chain
    }
  }
  const result = { data: answer.data, error: answer.error ?? null }
  chain.maybeSingle = async () => result
  chain.single = async () => result
  chain.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return { calls, db: { from: (t: string) => (calls.push(['from', t]), chain) } as never }
}

const filters = (calls: Call[]) => calls.filter(([m]) => m === 'eq' || m === 'or' || m === 'in')

describe('loadRecord', () => {
  it('off: today\'s query, with no scope filter', async () => {
    const { db, calls } = fakeDb({ data: { id: ID } })
    const got = await loadRecord(stellr, 'registrations', ID, { db, notFound, select: 'id', mode: 'off' })
    expect(got).toEqual({ ok: true, row: { id: ID } })
    expect(filters(calls)).toEqual([['eq', 'id', ID]])
  })

  it('a failed read answers as the route\'s notFound, in every mode', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const mode of ['off', 'shadow', 'enforce'] as const) {
      const { db } = fakeDb({ data: null, error: { code: 'XX000', message: 'down' } })
      const got = await loadRecord(stellr, 'registrations', ID, { db, notFound, select: 'id', mode, onMismatch: () => {} })
      expect(got.ok).toBe(false)
      if (!got.ok) expect(got.response.status).toBe(404)
    }
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('a malformed id under off answers notFound without reporting a failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db } = fakeDb({ data: null, error: { code: '22P02' } })
    const got = await loadRecord(stellr, 'registrations', 'nope', { db, notFound, select: 'id', mode: 'off' })
    expect(got.ok).toBe(false)
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('another tenant\'s scope is enforced, whatever the mode says', async () => {
    const { db, calls } = fakeDb({ data: null })
    await loadRecord(canary, 'registrations', ID, { db, notFound, select: 'id', mode: 'off' })
    expect(filters(calls)).toContainEqual(['eq', 'tenant_id', OTHER])
  })
})

describe('loadEventRecord', () => {
  const crew = (assigned: string[] | null) => ({
    scope: tenantWideScope(STELLR_TENANT_ID, assigned === null ? 'tenant_admin' : 'crew'),
    covers: (s: string | null | undefined) => assigned === null || (!!s && assigned.includes(s)),
  })
  const row = (event_slug: string | null) => fakeDb({ data: { event_slug } }).db

  it('hands over a row of a covered event', async () => {
    expect((await loadEventRecord(crew(['nv']), 'registrations', ID, { db: row('nv'), notFound, mode: 'off' })).ok).toBe(true)
  })

  it('answers any other row as notFound, in every mode', async () => {
    for (const mode of ['off', 'shadow', 'enforce'] as const) {
      const got = await loadEventRecord(crew(['co']), 'registrations', ID, { db: row('nv'), notFound, mode, onMismatch: () => {} })
      expect(got.ok).toBe(false)
      if (!got.ok) expect(got.response.status).toBe(404)
    }
  })

  it('a row with no event is for someone who reaches every event', async () => {
    expect((await loadEventRecord(crew(['nv']), 'credentials', ID, { db: row(null), notFound, mode: 'off' })).ok).toBe(false)
    expect((await loadEventRecord(crew(null), 'credentials', ID, { db: row(null), notFound, mode: 'off' })).ok).toBe(true)
  })
})

describe('loadScopedRows', () => {
  const match = { event_slug: 'nv' }

  it('off: today\'s query', async () => {
    const { db, calls } = fakeDb({ data: [{ a: 1 }] })
    expect(await loadScopedRows(stellr, 'registrations', { db, match, mode: 'off' })).toEqual({ data: [{ a: 1 }], error: null })
    expect(filters(calls)).toEqual([['eq', 'event_slug', 'nv']])
  })

  it('enforce: the tenant filter too, and a child table\'s embed comes off the rows', async () => {
    const { db, calls } = fakeDb({ data: [{ a: 1, stellr_scope_parent: { tenant_id: OTHER } }] })
    const got = await loadScopedRows(canary, 'agreement_recipients', { db, match: { envelope_row: ID }, order: { column: 'routing_order' }, mode: 'enforce' })
    expect(got.data).toEqual([{ a: 1 }])
    expect(filters(calls)).toContainEqual(['eq', 'stellr_scope_parent.tenant_id', OTHER])
    expect(calls).toContainEqual(['order', 'routing_order', { ascending: true }])
  })

  it('shadow: answers with today\'s rows, and reports a different count', async () => {
    const mismatches: ShadowMismatch[] = []
    const answers = [[{ a: 1 }, { a: 2 }], [{ a: 1 }]]
    const chainFor = (data: unknown) => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'or', 'in', 'order']) chain[m] = () => chain
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ data, error: null })
      return chain
    }
    const db = { from: () => chainFor(answers.shift()) } as never
    const got = await loadScopedRows(stellr, 'registrations', { db, match, mode: 'shadow', onMismatch: (m) => void mismatches.push(m) })
    expect(got.data).toHaveLength(2)
    expect(mismatches).toEqual([expect.objectContaining({ reason: 'row', table: 'public.registrations' })])
  })

  it('shadow: a scoped read that throws is reported, and today\'s rows still come back', async () => {
    const mismatches: ShadowMismatch[] = []
    const { db } = fakeDb({ data: [{ a: 1 }] })
    const got = await loadScopedRows(stellr, 'public.no_such_table', { db, match, mode: 'shadow', onMismatch: (m) => void mismatches.push(m) })
    expect(got.data).toEqual([{ a: 1 }])
    expect(mismatches[0].reason).toBe('scoped_error')
  })
})

describe('scopedRowWrite', () => {
  const write = (scope: ScopeContext, mode: 'off' | 'shadow' | 'enforce') => {
    const { db, calls } = fakeDb({ data: null })
    void scopedRowWrite(scope, 'agreements', ID, { db, mode }).update({ a: 1 })
    return filters(calls)
  }

  it('off and shadow write as today, by id', () => {
    expect(write(stellr, 'off')).toEqual([['eq', 'id', ID]])
    expect(write(stellr, 'shadow')).toEqual([['eq', 'id', ID]])
  })

  it('enforced, the write carries the tenant filter, and another tenant is always enforced', () => {
    expect(write(stellr, 'enforce')).toEqual([['eq', 'id', ID], ['or', `tenant_id.eq.${STELLR_TENANT_ID},tenant_id.is.null`]])
    expect(write(canary, 'off')).toEqual([['eq', 'id', ID], ['eq', 'tenant_id', OTHER]])
  })

  it('refuses a child table', () => {
    const { db } = fakeDb({ data: null })
    expect(() => scopedRowWrite(stellr, 'participants', ID, { db })).toThrow(TenantContextError)
  })
})

describe('enforcedTenantFilter', () => {
  it('is null where the mode leaves today\'s query alone', () => {
    expect(enforcedTenantFilter(stellr, 'registrations', { mode: 'off' })).toBeNull()
    expect(enforcedTenantFilter(stellr, 'registrations', { mode: 'shadow' })).toBeNull()
  })

  it('names the filter otherwise', () => {
    expect(enforcedTenantFilter(stellr, 'registrations', { mode: 'enforce' })).toEqual({ column: 'tenant_id', value: STELLR_TENANT_ID, includeNull: true })
    expect(enforcedTenantFilter(canary, 'registrations', { mode: 'off' })).toEqual({ column: 'tenant_id', value: OTHER, includeNull: false })
  })
})

describe('tenantWideScope', () => {
  it('reaches every event, and never under the event_manager kind', () => {
    expect(tenantWideScope(STELLR_TENANT_ID, 'crew').eventSlugs).toBeNull()
    expect(() => makeScope({ tenantId: STELLR_TENANT_ID, eventSlugs: null, actor: { kind: 'event_manager' } })).toThrow(TenantContextError)
  })
})
