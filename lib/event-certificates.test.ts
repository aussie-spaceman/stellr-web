import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseServer: vi.fn() }))

const { recipientsFor, placementFromParams, fullName } = await import('./event-certificates')
import type { AssignmentRow, EventCompany, EventStudent } from './event-certificates'
import { DEFAULT_NAME_PLACEMENT } from './event-pdf'

const student = (id: string, first: string, last: string, company_id: string | null): EventStudent => ({
  id, first_name: first, last_name: last, company_id, member_id: null, email: `${id}@x.org`, date_of_birth: '2011-01-01',
  event_role: 'participant', checked_in_at: null, emergency_contact_first_name: null, emergency_contact_email: null,
})

const companies: EventCompany[] = [
  { id: 'co-2', number: 2, name: null },
  { id: 'co-1', number: 1, name: 'Orbital' },
]
const students = [
  student('s1', 'Leon', 'Buk', 'co-2'),
  student('s2', 'Daniel', 'Ahaiwe', 'co-1'),
  student('s3', 'Ava', 'Zed', null),
  student('s4', 'Ben', 'Carr', 'co-1'),
]
const assignments: AssignmentRow[] = [
  { id: 'a1', award_type: 'anita_gale', participant_id: 's1', company_id: 'co-2', assigned_at: '' },
  { id: 'a2', award_type: 'anita_gale', participant_id: 's4', company_id: 'co-1', assigned_at: '' },
]

describe('recipientsFor', () => {
  it('gives participation to every student, sorted by company then surname', () => {
    expect(recipientsFor('participation', students, [], companies).map((s) => s.id)).toEqual(['s2', 's4', 's1', 's3'])
  })

  it('gives a judged award only to its assignees', () => {
    expect(recipientsFor('anita_gale', students, assignments, companies).map((s) => s.id)).toEqual(['s4', 's1'])
    expect(recipientsFor('dick_edwards', students, assignments, companies)).toEqual([])
  })
})

describe('placementFromParams', () => {
  it('overrides with in-range values and ignores the rest', () => {
    const p = placementFromParams(DEFAULT_NAME_PLACEMENT, new URLSearchParams({ name_y: '0.6', name_size: '500', name_max_width: 'x' }))
    expect(p).toEqual({ ...DEFAULT_NAME_PLACEMENT, nameY: 0.6 })
  })
})

describe('fullName', () => {
  it('collapses stray spaces (the "Daniel  Ahaiwe" on the old print)', () => {
    expect(fullName({ first_name: 'Daniel ', last_name: 'Ahaiwe' })).toBe('Daniel Ahaiwe')
  })
})
