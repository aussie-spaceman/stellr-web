// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// PATCH /api/admin/members/[id] — the admin profile save.
//
// TRACKER 20.2: the 28 Sept fix (the form sends cleared fields as '', and enum
// and date columns reject '') had no regression test. A successful save must
// reach .update() with those empties as null.
// TRACKER 20.5: a failed save said only "Update failed". It now says why, from
// the Postgres error code, and the raw error stays in the server log.

const MEMBER = '11111111-1111-4111-8111-111111111111'

type DbError = { code?: string; message?: string; details?: string | null }

const { state } = vi.hoisted(() => ({
  state: {
    before: null as Record<string, unknown> | null,
    updates: [] as Record<string, unknown>[],
    updateError: null as DbError | null,
    logs: [] as Record<string, unknown>[],
  },
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ sessionClaims: {} }) }))
vi.mock('@/lib/authz', () => ({ hasCapability: async () => true }))
vi.mock('@/lib/admin-auth', () => ({ isAdminClaims: () => true }))
vi.mock('@/lib/esign/retention', () => ({ startRetentionClock: async () => {} }))
vi.mock('@/lib/field-crypto-shadow', () => ({ shadowSyncFields: () => {} }))
vi.mock('@/lib/activity-log', () => ({
  actorFromAuth: async () => ({ actorMemberId: null, actorLabel: 'admin' }),
  logActivity: async (entry: Record<string, unknown>) => { state.logs.push(entry) },
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from(table: string) {
      let update: Record<string, unknown> | null = null
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        delete: () => chain,
        insert: async () => ({ error: null }),
        update: (u: Record<string, unknown>) => { update = u; return chain },
        maybeSingle: async () => ({ data: table === 'members' ? state.before : null, error: null }),
        single: async () => {
          if (table !== 'members' || !update) throw new Error(`unexpected single() on ${table}`)
          if (state.updateError) return { data: null, error: state.updateError }
          state.updates.push(update)
          return { data: { id: MEMBER, ...state.before, ...update }, error: null }
        },
        then: (f: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(f),
      }
      return chain
    },
  }),
}))

const { PATCH } = await import('./route')

const save = (body: Record<string, unknown>) =>
  PATCH(
    new Request(`https://app.test/api/admin/members/${MEMBER}`, { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: MEMBER }) },
  )

// What the admin profile form submits for an Adult with no grade or size.
const adultForm = {
  first_name: 'Alex', last_name: 'Adult', nickname: '', phone: '', email: 'alex@example.test',
  school_email: '', discord_handle: '', date_of_birth: '1990-01-01', gender: '',
  age_bracket: 'adult', event_role: 'mentor', grade: '', grade_auto_promote: true, tshirt_size: '',
  ec_first_name: '', ec_last_name: '', ec_email: '', ec_phone: '', ec_relationship: '',
  health_conditions: '', is_active: true,
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  state.before = {
    first_name: 'Alex', last_name: 'Adult', email: 'alex@example.test', date_of_birth: '1990-01-01',
    gender: 'male', age_bracket: 'adult', event_role: 'mentor', grade: null, tshirt_size: null,
    grade_auto_promote: true, is_active: true,
  }
  state.updates = []
  state.updateError = null
  state.logs = []
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  consoleError.mockRestore()
})

describe('PATCH /api/admin/members/[id] — a successful save (TRACKER 20.2)', () => {
  it("stores the form's empty enum and date fields as null and returns the member", async () => {
    const res = await save({ ...adultForm, date_of_birth: '' })
    expect(res.status).toBe(200)
    expect(state.updates).toHaveLength(1)
    const written = state.updates[0]
    for (const key of ['grade', 'tshirt_size', 'gender', 'date_of_birth']) {
      expect(written[key], key).toBeNull()
    }
    expect(written).toMatchObject({ first_name: 'Alex', email: 'alex@example.test', school_email: null })
    expect((await res.json()).member).toMatchObject({ id: MEMBER, first_name: 'Alex' })
  })

  it('records which fields changed in the member history', async () => {
    const res = await save({ ...adultForm, first_name: 'Alexis', gender: 'male' })
    expect(res.status).toBe(200)
    expect(state.logs).toHaveLength(1)
    expect(state.logs[0]).toMatchObject({ action: 'profile_updated', metadata: { fields: ['first_name'] } })
  })

  it('writes only the allowed columns', async () => {
    const res = await save({ ...adultForm, clerk_user_id: 'user_other_placeholder', membership_id: '0000001' })
    expect(res.status).toBe(200)
    expect(state.updates[0]).not.toHaveProperty('clerk_user_id')
    expect(state.updates[0]).not.toHaveProperty('membership_id')
  })
})

describe('PATCH /api/admin/members/[id] — a failed save says why (TRACKER 20.5)', () => {
  it.each<[string, DbError, number, string]>([
    [
      'a duplicate email',
      { code: '23505', message: 'duplicate key value violates unique constraint "members_email_lower_idx"', details: 'Key (lower(email))=(x) already exists.' },
      409,
      'Another member already uses that email address. Use a different one, or merge the two records.',
    ],
    [
      'an invalid grade',
      { code: '22P02', message: 'invalid input value for enum grade_type: "13"' },
      400,
      'That grade is not one of the options.',
    ],
    [
      'an invalid t-shirt size',
      { code: '22P02', message: 'invalid input value for enum tshirt_size_type: "XXXXL"' },
      400,
      'That t-shirt size is not one of the options.',
    ],
    [
      'a cleared required field',
      { code: '23502', message: 'null value in column "gender" of relation "members" violates not-null constraint' },
      400,
      'Gender is required.',
    ],
    [
      'an invalid date',
      { code: '22007', message: 'invalid input syntax for type date: "1990-13-45"' },
      400,
      'Date of birth is not a valid date.',
    ],
    [
      'a check violation',
      { code: '23514', message: 'new row for relation "members" violates check constraint "members_some_check"' },
      400,
      'One of the values is outside what a member record allows. Nothing was saved.',
    ],
    [
      'a member that no longer exists',
      { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
      404,
      'This member no longer exists.',
    ],
    [
      'an unrecognised database error',
      { code: '57014', message: 'canceling statement due to statement timeout' },
      500,
      'The save did not go through. Nothing was changed; try again.',
    ],
  ])('%s', async (_case, dbError, status, message) => {
    state.updateError = dbError
    const res = await save({ ...adultForm, grade: '13', tshirt_size: 'XXXXL' })
    expect(res.status).toBe(status)
    const body = await res.json()
    expect(body).toEqual({ error: message })
    // The raw database error is never sent to the browser...
    expect(JSON.stringify(body)).not.toContain(dbError.message!)
    // ...but is logged server-side.
    expect(consoleError).toHaveBeenCalledWith('Admin member update error:', dbError)
    expect(state.logs).toEqual([])
  })

  it('does not name a field the request did not send', async () => {
    state.updateError = { code: '23502', message: 'null value in column "membership_id" of relation "members" violates not-null constraint' }
    const res = await save({ first_name: 'Alex' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'A required field is empty. Nothing was saved.' })
  })

  it('still refuses a blank email before touching the database', async () => {
    const res = await save({ ...adultForm, email: '', school_email: '' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'An email address is required.' })
    expect(state.updates).toEqual([])
  })
})
