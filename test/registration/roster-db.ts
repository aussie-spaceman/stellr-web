import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// A database for the roster writers' tests (S5 A8): Stellr's group, a tenant's group with
// its mirrored event and tenant row, and a second tenant. The participants table can play
// the A3 eligibility trigger's refusal (SQLSTATE 23514) on the writes a test names, and
// every table a query touches is recorded, so a test can show Stellr's path made no read.

export const TENANT = '11111111-1111-4111-8111-111111111111'
export const OTHER_TENANT = '44444444-4444-4444-8444-444444444444'
export const STELLR_GROUP = '22222222-2222-4222-8222-222222222222'
export const TENANT_GROUP = '33333333-3333-4333-8333-333333333333'

const DAY = 24 * 60 * 60 * 1000

/** YYYY-MM-DD for a date of birth `years` before today, less `days`. */
export function bornYearsAgo(years: number, days = 0): string {
  const d = new Date(Date.now() - days * DAY)
  d.setUTCFullYear(d.getUTCFullYear() - years)
  return d.toISOString().slice(0, 10)
}

export const ADULT = bornYearsAgo(40)
/** 13 today and still 13 on the tenant event's day, 30 days out. */
export const THIRTEEN = bornYearsAgo(13, 60)
/** 15 today and on the day. */
export const FIFTEEN = bornYearsAgo(15, 60)

const MONEYLESS = { invoice_requested: false, stripe_payment_intent_id: null, amount_due_cents: 0, late_joiner_payer: null, share_estimate: null }

export const stellrGroup = {
  id: STELLR_GROUP, type: 'group', tenant_id: STELLR_TENANT_ID, event_slug: 'colorado', event_title: 'Colorado',
  school_name: 'Rocket High', school_address_state: 'CO', spreadsheet_id: 'sheet-s',
  teacher_member_id: 'member-org', teacher_email: 'org@example.com', teacher_poc_email: null, teacher_first_name: 'Org',
  registrant_role: 'teacher', ...MONEYLESS,
}

export const tenantGroup = {
  id: TENANT_GROUP, type: 'group', tenant_id: TENANT, event_slug: 'acme-day', event_title: 'Acme Day',
  school_name: 'Acme School', school_address_state: 'CO', spreadsheet_id: 'sheet-t',
  // The tenant's organiser typed the same address a Stellr member signs in with.
  teacher_member_id: null, teacher_email: 'org@example.com', teacher_poc_email: null, teacher_first_name: 'Org',
  registrant_role: 'teacher', ...MONEYLESS,
}

export interface RosterDb {
  fake: FakeDb
  client: never
  /** Every table a query was built on, in order. */
  reads: string[]
  /**
   * Participants writes the "trigger" refuses: op and payload. true plays the
   * eligibility refusal (23514); an object is returned as the error instead.
   */
  refuse: (op: 'insert' | 'update', payload: Record<string, unknown>) => boolean | Record<string, unknown>
}

export function rosterDb(extra: Record<string, object[]> = {}): RosterDb {
  const startsAt = new Date(Date.now() + 30 * DAY).toISOString()
  const fake = fakeSupabase({
    registrations: [stellrGroup, tenantGroup],
    events: [
      { slug: 'acme-day', tenant_id: TENANT, activity_type: 'live_event', starts_at: startsAt, time_zone: 'America/Denver', min_participant_age: null },
    ],
    tenants: [
      { id: STELLR_TENANT_ID, is_platform_owner: true, min_participant_age: null },
      { id: TENANT, is_platform_owner: false, min_participant_age: 14 },
      { id: OTHER_TENANT, is_platform_owner: false, min_participant_age: 14 },
    ],
    members: [{ id: 'member-org', email: 'org@example.com', clerk_user_id: 'user_org', is_active: true }],
    participants: [],
    ...extra,
  })
  const db: RosterDb = { fake, client: null as never, reads: [], refuse: () => false }
  const base = fake.client as unknown as { from(t: string): Record<string, (...a: unknown[]) => unknown> }
  db.client = {
    from(table: string) {
      db.reads.push(table)
      const b = base.from(table)
      if (table !== 'participants') return b
      for (const op of ['insert', 'update'] as const) {
        const orig = b[op].bind(b)
        b[op] = (payload: unknown) => {
          const refused = db.refuse(op, payload as Record<string, unknown>)
          return refused ? refusedChain(refused === true ? undefined : refused) : orig(payload)
        }
      }
      return b
    },
    rpc: async () => ({ data: null, error: null }),
  } as never
  return db
}

/** What PostgREST answers when the participants eligibility trigger raises. */
function refusedChain(error: Record<string, unknown> = { code: '23514', message: 'participant eligibility: under_minimum_age' }) {
  const answer = { data: null, error }
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'single', 'maybeSingle']) c[m] = () => c
  c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(answer).then(res, rej)
  return c
}
