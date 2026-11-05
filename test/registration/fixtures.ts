// Shared fixtures for the register-route characterisation suites (S5 A1).
//
// The suites pin what app/api/register/{individual,group,group-join,pay} do
// TODAY, so the S5 handler split (A4-A6) can prove it is a pure refactor: same
// status, same `code`, same body, and the same order of database writes and
// side effects. Nothing here is production code.
//
// `rec` is one ordered log per test file (Vitest gives each file its own module
// graph). The fake Supabase client appends every query to it when the query
// RUNS (awaited, or .single()/.maybeSingle()), and the suites' module mocks
// append their side effects to it too ("shadow participants [p-1]",
// "hook recordEventParticipation", ...). A test then compares the whole
// sequence, so moving a write or a hook to another phase fails loudly.

import { appToday } from '@/lib/age'

export type DbOp = 'select' | 'insert' | 'upsert' | 'update' | 'delete'

export interface DbCall {
  table: string
  op: DbOp
  payload: unknown
  /** Every filter in call order, e.g. ['eq', 'email', 'a@b.co']. */
  filters: unknown[][]
  /** The terminal used: .single(), .maybeSingle(), or a bare await. */
  single: 'single' | 'maybe' | null
  /** select(..., { count: 'exact' }). */
  count: boolean
}

export interface DbResult {
  data: unknown
  error: unknown
  count?: number | null
}

/** Return a result to override the default for this call, or undefined to keep it. */
export type Responder = (call: DbCall) => DbResult | undefined

/** The defaults: every insert succeeds with predictable ids; every read finds nothing. */
function defaultResult(call: DbCall): DbResult {
  const { table, op, payload, single } = call
  if (call.count) return { data: null, error: null, count: 0 }
  if (op === 'insert' && table === 'registrations') return { data: { id: 'reg-1' }, error: null }
  if (op === 'insert' && table === 'participants') {
    if (Array.isArray(payload)) {
      return {
        data: payload.map((r: Record<string, unknown>, i: number) => ({ id: `p-${i}`, email: r.email })),
        error: null,
      }
    }
    return { data: { id: 'p-1' }, error: null }
  }
  if (op === 'upsert' && table === 'members') {
    if (Array.isArray(payload)) {
      return {
        data: payload.map((r: Record<string, unknown>) => ({ id: `m-${String(r.email)}`, email: r.email })),
        error: null,
      }
    }
    return { data: { id: 'm-1' }, error: null }
  }
  if (op === 'select') return { data: single ? null : [], error: null }
  return { data: null, error: null }
}

export function createRecorder() {
  const log: string[] = []
  const calls: DbCall[] = []
  let responder: Responder = () => undefined

  function run(call: DbCall): DbResult {
    calls.push(call)
    log.push(`${call.op} ${call.table}`)
    return responder(call) ?? defaultResult(call)
  }

  function from(table: string) {
    const call: DbCall = { table, op: 'select', payload: null, filters: [], single: null, count: false }
    const filter = (name: string) => (...args: unknown[]) => { call.filters.push([name, ...args]); return chain }
    const chain: Record<string, unknown> = {
      select: (_cols?: string, o?: { count?: string }) => {
        if (call.op === 'select' && o?.count === 'exact') call.count = true
        return chain
      },
      insert: (p: unknown) => { call.op = 'insert'; call.payload = p; return chain },
      upsert: (p: unknown) => { call.op = 'upsert'; call.payload = p; return chain },
      update: (p: unknown) => { call.op = 'update'; call.payload = p; return chain },
      delete: () => { call.op = 'delete'; return chain },
      eq: filter('eq'), neq: filter('neq'), in: filter('in'), is: filter('is'), not: filter('not'),
      gt: filter('gt'), gte: filter('gte'), lt: filter('lt'), lte: filter('lte'), or: filter('or'),
      order: () => chain, limit: () => chain, range: () => chain,
      single: async () => { call.single = 'single'; return run(call) },
      maybeSingle: async () => { call.single = 'maybe'; return run(call) },
      then: (onF: (v: DbResult) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve().then(() => run(call)).then(onF, onR),
    }
    return chain
  }

  return {
    log,
    calls,
    /** A fake Supabase client that records into this log. */
    client: () => ({ from }) as never,
    /** Record a side effect (a mocked hook, shadowSyncFields, an email). */
    event: (label: string) => { log.push(label) },
    /** Override results for this test. */
    respond: (fn: Responder) => { responder = fn },
    /** The log without plain reads: writes, shadow syncs and hooks, in order. */
    writes: () => log.filter((l) => !l.startsWith('select ')),
    /** Payloads written to `table` by `op`, in order. */
    payloads: (op: DbOp, table: string) => calls.filter((c) => c.op === op && c.table === table).map((c) => c.payload),
    reset: () => { log.length = 0; calls.length = 0; responder = () => undefined },
  }
}

export type Recorder = ReturnType<typeof createRecorder>

/** The one recorder a characterisation file shares between its mocks and its tests. */
export const rec = createRecorder()

// ── Dates ─────────────────────────────────────────────────────────────────────

/** The app's today (America/Denver) as YYYY-MM-DD. Events in these suites run today. */
export const TODAY = appToday().toISOString().slice(0, 10)

/** A date `years` years and `days` days before the app's today, as YYYY-MM-DD. */
export function dateBefore(years: number, days = 0): string {
  const d = appToday()
  const month = d.getUTCMonth()
  d.setUTCFullYear(d.getUTCFullYear() - years)
  // 29 Feb in a non-leap year rolled to 1 March: step back to the 28th, so the
  // ages below stay on their boundary when the suite runs on a leap day.
  if (d.getUTCMonth() !== month) d.setUTCDate(0)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

/**
 * The DOB boundary cases every suite runs, for an event held today. Each age is
 * its boundary: "12" turns 13 tomorrow, "13" turned 13 today, and so on, so a
 * gate that moved by a day either way would change an answer.
 */
export const AGE_CASES = [
  { age: 12, dob: dateBefore(13, -1), minor: true, under13: true },
  { age: 13, dob: dateBefore(13), minor: true, under13: false },
  { age: 14, dob: dateBefore(14), minor: true, under13: false },
  { age: 17, dob: dateBefore(18, -1), minor: true, under13: false },
  { age: 18, dob: dateBefore(18), minor: false, under13: false },
] as const

/** The refusal copy checkRegistrationAge returns today (lib/registration-eligibility). */
export const DOB_MISSING_SELF = 'Please add your date of birth.'
export const DOB_INVALID_SELF = "That date of birth doesn't look right. Please check it and try again."
export const dobMissingFor = (name: string) => `Please add a date of birth for ${name}.`
export const dobInvalidFor = (name: string) =>
  `The date of birth for ${name} doesn't look right. Please check it and try again.`

/** A live event held today, with its window open. */
export const OPEN_EVENT = { title: 'Colorado', activityType: 'live_event', date: TODAY }
/** The same event after its registration window closed. */
export const CLOSED_EVENT = {
  ...OPEN_EVENT,
  registrationOpenDate: '2020-01-01',
  registrationCloseDate: '2020-02-01',
}

// The two events on which age today and age at the event differ. Each suite runs
// them because `isMinor` is under 18 on EITHER date, and an event held today
// cannot tell which date a route used.
/**
 * A multi-day event that started two days ago and is still open: age at the event
 * is behind. Two days, not one: on a leap day nobody turned 18 that day alone, so
 * DOB_18_TODAY steps back to the 28th and a one-day-old start would not reach it.
 */
export const EVENT_UNDER_WAY = { ...OPEN_EVENT, date: dateBefore(0, 2), endDate: dateBefore(0, -1) }
/** An event a year out: age at the event is a year ahead. */
export const EVENT_A_YEAR_OUT = { ...OPEN_EVENT, date: dateBefore(-1) }
/** Turned 18 today: an adult today, but 17 on the first day of EVENT_UNDER_WAY. */
export const DOB_18_TODAY = dateBefore(18)
/** Turns 18 tomorrow: 17 today, but an adult by EVENT_A_YEAR_OUT. */
export const DOB_18_TOMORROW = dateBefore(18, -1)
/** Turns 13 tomorrow: under 13 today, but 13 by EVENT_A_YEAR_OUT. The login guard goes on today. */
export const DOB_13_TOMORROW = dateBefore(13, -1)

/** Does this query filter `column` for equality with `value`? */
export const eqFilter = (c: DbCall, column: string, value: unknown) =>
  c.filters.some((f) => f[0] === 'eq' && f[1] === column && f[2] === value)

/** Does this query filter `column` with an IN list that includes `value`? */
export const inFilter = (c: DbCall, column: string, value: unknown) =>
  c.filters.some((f) => f[0] === 'in' && f[1] === column && Array.isArray(f[2]) && f[2].includes(value))

/** A view-as refusal, standing in for what assertNotImpersonating returns. */
export const viewAsRefusal = () =>
  new Response(JSON.stringify({ error: 'Read-only while viewing as a member. Exit view-as to make changes.', impersonating: true }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
export const VIEW_AS_REFUSED = {
  status: 403,
  body: { error: 'Read-only while viewing as a member. Exit view-as to make changes.', impersonating: true },
}

/** A JSON POST to a register route. */
export function jsonRequest(path: string, body: unknown): never {
  return new Request(`https://www.stellreducation.org${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

/** Status and parsed body, for one exact comparison. */
export async function settle(res: Response): Promise<{ status: number; body: unknown }> {
  return { status: res.status, body: await res.json() }
}
