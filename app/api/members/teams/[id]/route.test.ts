// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// The team detail is assembled from one registrations query with participants
// embedded; the fake returns that shape directly and records nothing else.

const { state } = vi.hoisted(() => ({ state: { member: { id: 'student-1', email: 'kid@school.test' } } }))

const registration = {
  id: 'reg-1',
  event_slug: 'colorado',
  event_title: 'Colorado SDC',
  school_name: 'Lincoln High',
  status: 'confirmed',
  teacher_member_id: 'teacher-1',
  teacher_email: 't@school.test',
  teacher_poc_email: null,
  registrant_role: 'teacher',
  participants: [
    {
      id: 'p1', member_id: 'student-1', first_name: 'Kid', last_name: 'One', event_role: 'participant',
      date_of_birth: '2012-01-01', health_conditions: 'asthma', emergency_contact_email: 'parent1@home.test',
      email: 'kid@school.test', event_companies: null,
    },
    {
      id: 'p2', member_id: 'student-2', first_name: 'Kid', last_name: 'Two', event_role: 'participant',
      date_of_birth: '2011-06-06', health_conditions: 'epilepsy', emergency_contact_email: 'parent2@home.test',
      email: 'two@school.test', event_companies: { number: 3, name: 'Orbit' },
    },
  ],
}

vi.mock('@/lib/impersonation', () => ({
  resolveRequestMember: async () => ({ member: state.member, unauthorised: false }),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'order', 'limit']) chain[m] = () => chain
      chain.maybeSingle = async () => ({ data: table === 'registrations' ? registration : null, error: null })
      chain.insert = async () => ({ error: null })
      chain.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r)
      return chain
    },
  }),
}))

const { GET } = await import('./route')

const get = () =>
  GET(new NextRequest('https://app.test/api/members/teams/reg-1'), { params: Promise.resolve({ id: 'reg-1' }) })

beforeEach(() => {
  state.member = { id: 'student-1', email: 'kid@school.test' }
})

describe('GET /api/members/teams/[id] for a student on the team', () => {
  it('shows teammates by name only: no dates of birth, health or guardian details', async () => {
    const body = await (await get()).json()
    const teammate = body.registration.participants.find((p: { id: string }) => p.id === 'p2')
    expect(teammate).toEqual({
      id: 'p2', first_name: 'Kid', last_name: 'Two', event_role: 'participant',
      event_companies: { number: 3, name: 'Orbit' },
    })
    expect(JSON.stringify(body)).not.toMatch(/epilepsy|parent2@home\.test|2011-06-06/)
  })

  it('still shows the student their own row in full', async () => {
    const body = await (await get()).json()
    const self = body.registration.participants.find((p: { id: string }) => p.id === 'p1')
    expect(self.health_conditions).toBe('asthma')
  })

  it('exposes no join link and no agreements', async () => {
    const body = await (await get()).json()
    expect(body.registration.joinUrl).toBeNull()
    expect(body.registration.docusignEnvelopes).toEqual({})
  })
})

describe('GET /api/members/teams/[id] for the organiser', () => {
  it('returns the full roster', async () => {
    state.member = { id: 'teacher-1', email: 't@school.test' }
    const body = await (await get()).json()
    const teammate = body.registration.participants.find((p: { id: string }) => p.id === 'p2')
    expect(teammate.health_conditions).toBe('epilepsy')
  })
})

// deep review TEST-2: the route's only real authorisation is `owns || isParticipant`
// (route.ts:51-56). It was tested for a teammate and the organiser, but never for
// a member who is on neither — the 403 that stops any signed-in member pulling an
// arbitrary team's minors (DOB, health, guardian emails).
describe('GET /api/members/teams/[id] for someone not on the team', () => {
  it('403s and returns no roster', async () => {
    state.member = { id: 'stranger', email: 'someone@else.test' }
    const res = await get()
    expect(res.status).toBe(403)
    expect(JSON.stringify(await res.json())).not.toMatch(/Kid|asthma|epilepsy|2012-01-01/)
  })

  it('does not treat a null POC/teacher email as matching a member with no email', async () => {
    // Guards against norm() regressing so null === null reads as ownership.
    state.member = { id: 'stranger', email: null as unknown as string }
    expect((await get()).status).toBe(403)
  })
})
