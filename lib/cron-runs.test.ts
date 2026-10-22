import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { lastCronResult } from '@/lib/cron-runs'

// lastCronResult is how a cron carries a cursor between runs (apollo-reconcile's
// nextOffset). It must read only FINISHED runs — a killed run has no result —
// and, like the rest of the ledger, never throw into the job it serves.

function fakeDb(outcome: { data?: unknown; error?: unknown; throws?: boolean }) {
  const calls: string[] = []
  const builder = {
    select: (c: string) => (calls.push(`select ${c}`), builder),
    eq: (k: string, v: string) => (calls.push(`eq ${k}=${v}`), builder),
    not: (k: string, op: string, v: unknown) => (calls.push(`not ${k} ${op} ${String(v)}`), builder),
    order: (k: string, o: { ascending: boolean }) => (calls.push(`order ${k} ${o.ascending ? 'asc' : 'desc'}`), builder),
    limit: (n: number) => (calls.push(`limit ${n}`), builder),
    maybeSingle: async () => {
      if (outcome.throws) throw new Error('network down')
      return { data: outcome.data ?? null, error: outcome.error ?? null }
    },
  }
  const db = { from: (t: string) => (calls.push(`from ${t}`), builder) } as unknown as SupabaseClient
  return { db, calls }
}

describe('lastCronResult', () => {
  it('reads the newest finished run for the job', async () => {
    const { db, calls } = fakeDb({ data: { result: { nextOffset: 70 } } })
    expect(await lastCronResult(db, 'apollo-reconcile')).toEqual({ nextOffset: 70 })
    expect(calls).toEqual([
      'from cron_runs',
      'select result',
      'eq job=apollo-reconcile',
      'not finished_at is null',
      'order started_at desc',
      'limit 1',
    ])
  })

  it('returns null when there is no finished run', async () => {
    expect(await lastCronResult(fakeDb({ data: null }).db, 'apollo-reconcile')).toBeNull()
  })

  it('returns null rather than throwing on an error or a thrown read', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await lastCronResult(fakeDb({ error: { message: 'boom' } }).db, 'apollo-reconcile')).toBeNull()
    expect(await lastCronResult(fakeDb({ throws: true }).db, 'apollo-reconcile')).toBeNull()
    spy.mockRestore()
  })
})
