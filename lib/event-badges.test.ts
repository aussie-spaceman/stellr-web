import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadBadgeHolders } from './event-badges'

// Badge print order (Oct 2026): by surname, or by school so each group's
// packet comes off the printer together; and optional check-in codes.

const person = (id: string, first: string, last: string, school: string, extra: Record<string, unknown> = {}) => ({
  id,
  member_id: null,
  first_name: first,
  last_name: last,
  event_role: 'participant',
  school_name: school,
  company_id: null,
  event_companies: null,
  ...extra,
})

const REGS = [
  { id: 'r1', type: 'group', group_name: null, school_name: 'Westside High', participants: [person('11111111-1111-4111-8111-111111111111', 'Ann', 'Zed', 'westside hs'), person('22222222-2222-4222-8222-222222222222', 'Bo', 'Abel', 'Westside High')] },
  { id: 'r2', type: 'group', group_name: null, school_name: 'Lincoln MS', participants: [person('33333333-3333-4333-8333-333333333333', 'Cy', 'Moss', 'Lincoln MS')] },
  { id: 'r3', type: 'individual', group_name: null, school_name: null, participants: [person('44444444-4444-4444-8444-444444444444', 'Di', 'Bell', 'Academy Charter')] },
]

function fakeDb(): SupabaseClient {
  const tables: Record<string, unknown> = {
    registrations: { data: REGS },
    mentoring_cohorts: { data: { id: 'c1' } },
    cohort_members: { data: [{ member_id: 'm9', members: { first_name: 'Vic', last_name: 'Aaron' } }] },
  }
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'neq', 'is']) chain[m] = () => chain
      chain.maybeSingle = async () => tables[table]
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(tables[table]).then(resolve)
      return chain
    },
  } as unknown as SupabaseClient
}

beforeEach(() => vi.stubEnv('SURVEY_TOKEN_SECRET', 's'.repeat(40)))
afterEach(() => vi.unstubAllEnvs())

describe('loadBadgeHolders', () => {
  it('sorts by surname by default, volunteer mentors among everyone', async () => {
    const holders = await loadBadgeHolders(fakeDb(), 'nevada')
    expect(holders.map((h) => h.lastName)).toEqual(['Aaron', 'Abel', 'Bell', 'Moss', 'Zed'])
    expect(holders.every((h) => !h.qr)).toBe(true)
  })

  it('in school order keeps each group together under its registration’s school, mentors last', async () => {
    const holders = await loadBadgeHolders(fakeDb(), 'nevada', { order: 'school' })
    // Academy Charter (an individual's own school), Lincoln MS, Westside High
    // (both students, though one typed "westside hs"), then the mentor.
    expect(holders.map((h) => h.lastName)).toEqual(['Bell', 'Moss', 'Abel', 'Zed', 'Aaron'])
  })

  it('adds a check-in code link for registered people only', async () => {
    const holders = await loadBadgeHolders(fakeDb(), 'nevada', { codes: true })
    const byName = Object.fromEntries(holders.map((h) => [h.lastName, h.qr]))
    expect(byName.Moss).toMatch(/\/check-in\/nevada\/code\?c=p\.33333333-3333-4333-8333-333333333333\./)
    expect(byName.Aaron).toBeFalsy()
  })
})
