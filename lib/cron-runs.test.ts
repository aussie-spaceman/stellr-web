import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { lastCronResult, startCronRun, startTenantRun, type CronRun } from '@/lib/cron-runs'

// lastCronResult is how a cron carries a cursor between runs (apollo-reconcile's
// nextOffset). It must read only FINISHED runs — a killed run has no result —
// and, like the rest of the ledger, never throw into the job it serves.

const MISSING_COLUMN = { code: '42703', message: 'column cron_runs.parent_id does not exist' }

type Outcome = { data?: unknown; error?: unknown; throws?: boolean }

/**
 * Answers the reads in order. With `withoutColumn`, it behaves like a database
 * that has not had cron_runs_tenant applied: any read that names parent_id
 * fails, exactly as PostgREST does.
 */
function fakeDb(first: Outcome, opts: { then?: Outcome; withoutColumn?: boolean } = {}) {
  const calls: string[] = []
  let read = 0
  let namesParent = false
  const builder = {
    select: (c: string) => {
      if (c.includes('parent_id')) namesParent = true
      return calls.push(`select ${c}`), builder
    },
    eq: (k: string, v: string) => (calls.push(`eq ${k}=${v}`), builder),
    not: (k: string, op: string, v: unknown) => (calls.push(`not ${k} ${op} ${String(v)}`), builder),
    is: (k: string, v: unknown) => {
      if (k === 'parent_id') namesParent = true
      return calls.push(`is ${k} ${String(v)}`), builder
    },
    order: (k: string, o: { ascending: boolean }) => (calls.push(`order ${k} ${o.ascending ? 'asc' : 'desc'}`), builder),
    limit: (n: number) => (calls.push(`limit ${n}`), builder),
    maybeSingle: async () => {
      if (opts.withoutColumn && namesParent) return { data: null, error: MISSING_COLUMN }
      const outcome = read++ === 0 ? first : (opts.then ?? first)
      if (outcome.throws) throw new Error('network down')
      return { data: outcome.data ?? null, error: outcome.error ?? null }
    },
  }
  const db = { from: (t: string) => (calls.push(`from ${t}`), builder) } as unknown as SupabaseClient
  return { db, calls, reads: () => read }
}

describe('lastCronResult', () => {
  it('reads the newest finished run for the job', async () => {
    const { db, calls } = fakeDb({ data: { result: { nextOffset: 70 }, parent_id: null } })
    expect(await lastCronResult(db, 'apollo-reconcile')).toEqual({ nextOffset: 70 })
    expect(calls).toEqual([
      'from cron_runs',
      'select *',
      'eq job=apollo-reconcile',
      'not finished_at is null',
      'order started_at desc',
      'limit 1',
    ])
  })

  it('keeps the cursor on a database without the migration: the row has no parent_id and nothing names it', async () => {
    const { db, calls, reads } = fakeDb({ data: { result: { nextOffset: 70 } } }, { withoutColumn: true })
    expect(await lastCronResult(db, 'apollo-reconcile')).toEqual({ nextOffset: 70 })
    expect(reads()).toBe(1)
    expect(calls.join(' ')).not.toContain('parent_id')
  })

  it('keeps the cursor with the migration applied, in one read, when the newest row is top-level', async () => {
    const { db, reads } = fakeDb({ data: { result: { nextOffset: 70 }, parent_id: null } })
    expect(await lastCronResult(db, 'apollo-reconcile')).toEqual({ nextOffset: 70 })
    expect(reads()).toBe(1)
  })

  it('ignores a per-tenant child row and reads the newest top-level run', async () => {
    const { db, calls } = fakeDb(
      { data: { result: { sent: 1 }, parent_id: 'parent-1' } },
      { then: { data: { result: { tenantCursor: 'abc' }, parent_id: null } } },
    )
    expect(await lastCronResult(db, 'event-emails')).toEqual({ tenantCursor: 'abc' })
    expect(calls).toContain('is parent_id null')
  })

  it('returns null when only child rows have finished', async () => {
    const { db } = fakeDb({ data: { result: { sent: 1 }, parent_id: 'parent-1' } }, { then: { data: null } })
    expect(await lastCronResult(db, 'event-emails')).toBeNull()
  })

  it('returns null when there is no finished run', async () => {
    expect(await lastCronResult(fakeDb({ data: null }).db, 'apollo-reconcile')).toBeNull()
  })

  it('returns null rather than throwing on an error or a thrown read', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await lastCronResult(fakeDb({ error: { message: 'boom' } }).db, 'apollo-reconcile')).toBeNull()
    expect(await lastCronResult(fakeDb({ throws: true }).db, 'apollo-reconcile')).toBeNull()
    expect(
      await lastCronResult(
        fakeDb({ data: { parent_id: 'p' } }, { then: { error: { message: 'boom' } } }).db,
        'apollo-reconcile',
      ),
    ).toBeNull()
    spy.mockRestore()
  })
})

function fakeWriteDb(outcome: { id?: string; error?: unknown; throws?: boolean } = { id: 'row-1' }) {
  const inserts: Record<string, unknown>[] = []
  const updates: { row: Record<string, unknown>; id: string }[] = []
  const db = {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push(row)
        return {
          select: () => ({
            single: async () => {
              if (outcome.throws) throw new Error('network down')
              return { data: outcome.id ? { id: outcome.id } : null, error: outcome.error ?? null }
            },
          }),
        }
      },
      update: (row: Record<string, unknown>) => ({
        eq: async (_: string, id: string) => {
          updates.push({ row, id })
          return { error: null }
        },
      }),
    }),
  } as unknown as SupabaseClient
  return { db, inserts, updates }
}

const parent = (id: string | null): CronRun => ({ id, fail: () => {}, finish: async () => {} })

describe('startCronRun', () => {
  it('writes only the job, so it runs the same with or without the new columns', async () => {
    const { db, inserts } = fakeWriteDb()
    const run = await startCronRun(db, 'surveys')
    expect(inserts).toEqual([{ job: 'surveys' }])
    expect(run.id).toBe('row-1')
  })
})

describe('startTenantRun', () => {
  it('writes a child row and closes it', async () => {
    const { db, inserts, updates } = fakeWriteDb({ id: 'child-1' })
    const child = await startTenantRun(db, parent('parent-1'), 'surveys', 'tenant-b')
    expect(inserts).toEqual([{ job: 'surveys', tenant_id: 'tenant-b', parent_id: 'parent-1' }])
    child.fail('item', new Error('bad'))
    await child.finish({ opened: 0 })
    expect(updates[0].id).toBe('child-1')
    expect(updates[0].row.ok).toBe(false)
  })

  it('writes nothing when the parent has no row: a NULL parent_id would pass as top-level', async () => {
    const { db, inserts, updates } = fakeWriteDb()
    const child = await startTenantRun(db, parent(null), 'surveys', 'tenant-b')
    await child.finish({})
    expect(child.id).toBeNull()
    expect(inserts).toEqual([])
    expect(updates).toEqual([])
  })

  it('never throws when the columns are missing or the write fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const missing = fakeWriteDb({ error: { code: 'PGRST204', message: 'no parent_id column' } })
    const child = await startTenantRun(missing.db, parent('p'), 'surveys', 'tenant-b')
    await child.finish({})
    expect(child.id).toBeNull()
    expect(missing.updates).toEqual([])
    const thrown = await startTenantRun(fakeWriteDb({ throws: true }).db, parent('p'), 'surveys', 'tenant-b')
    expect(thrown.id).toBeNull()
    spy.mockRestore()
  })
})
