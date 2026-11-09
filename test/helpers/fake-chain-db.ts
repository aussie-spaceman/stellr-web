import type { SupabaseClient } from '@supabase/supabase-js'

// A stand-in Supabase client for cron tests (S5 B13). Every builder method chains;
// awaiting the chain, or calling single() / maybeSingle(), asks `answer` for the
// result. Each call is logged, so a test can see which tables were read and
// which rows were written.

export type Row = Record<string, unknown>

export interface ChainCall {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert'
  columns: string
  /** insert / update / upsert payload. */
  payload?: unknown
  filters: { method: string; args: unknown[] }[]
  single: boolean
}

export type Answer = (call: ChainCall) => { data: unknown; error: { message: string; code?: string } | null }

const FILTERS = ['eq', 'neq', 'in', 'not', 'is', 'or', 'order', 'limit', 'range', 'lte', 'gte', 'lt', 'gt', 'match', 'filter']

export type RpcAnswer = (fn: string, args: Row) => { data: unknown; error: { message: string } | null }

export function fakeChainDb(answer: Answer, rpcAnswer: RpcAnswer = () => ({ data: null, error: null })) {
  const calls: ChainCall[] = []
  const rpcCalls: { fn: string; args: unknown }[] = []
  const db = {
    from(table: string) {
      const call: ChainCall = { table, op: 'select', columns: '', filters: [], single: false }
      let logged = false
      const log = () => {
        if (!logged) calls.push(call)
        logged = true
      }
      const settle = () => {
        log()
        return Promise.resolve(answer(call))
      }
      const q: Record<string, unknown> = {
        select(columns = '*') {
          // insert(...).select() keeps the insert as the operation.
          if (call.op === 'select') call.columns = columns
          else call.columns = call.columns || columns
          return q
        },
        insert(payload: unknown) {
          call.op = 'insert'
          call.payload = payload
          return q
        },
        update(payload: unknown) {
          call.op = 'update'
          call.payload = payload
          return q
        },
        upsert(payload: unknown) {
          call.op = 'upsert'
          call.payload = payload
          return q
        },
        delete() {
          call.op = 'delete'
          return q
        },
        single() {
          call.single = true
          return settle()
        },
        maybeSingle() {
          call.single = true
          return settle()
        },
        then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) {
          return settle().then(ok, bad)
        },
      }
      for (const method of FILTERS) {
        q[method] = (...args: unknown[]) => {
          call.filters.push({ method, args })
          return q
        }
      }
      return q
    },
    async rpc(fn: string, args: Row) {
      rpcCalls.push({ fn, args })
      return rpcAnswer(fn, args)
    },
  }
  return { db: db as unknown as SupabaseClient, calls, rpcCalls }
}

/** Answers for the tables the per-tenant runner itself touches: tenants and cron_runs. */
export function runnerAnswer(call: ChainCall, tenants: Row[]): ReturnType<Answer> | null {
  if (call.table === 'tenants') {
    const inFilter = call.filters.find((f) => f.method === 'in')
    const ids = (inFilter?.args[1] as string[] | undefined) ?? null
    return { data: ids ? tenants.filter((t) => ids.includes(t.id as string)) : tenants, error: null }
  }
  if (call.table === 'cron_runs') {
    if (call.op === 'insert') return { data: { id: `child-${(call.payload as Row).tenant_id}` }, error: null }
    return { data: null, error: null }
  }
  return null
}
