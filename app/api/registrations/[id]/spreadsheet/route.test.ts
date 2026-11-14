// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// roster-grade-display.4: the team spreadsheet writes each grade through
// displayGrade, so a group's sheet shows "10" whether the participant row holds
// "10" (individual form) or "grade_10" (group paths), and a college grade as
// its form label. Those are the values the sheet's Grade dropdown offers.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  written: [] as unknown[][][],
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'user_placeholder' }) }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => h.db.client }))
vi.mock('@/lib/google-sheets', () => ({ isGoogleSheetsConfigured: () => true }))
vi.mock('@/lib/team-access', () => ({ ownsTeam: () => true }))
vi.mock('@/lib/impersonation', () => ({ impersonatedMemberId: async () => null }))
vi.mock('google-auth-library', () => ({ JWT: class {} }))
vi.mock('@googleapis/drive', () => ({ drive: () => ({ permissions: { create: async () => ({}) } }) }))
vi.mock('@googleapis/sheets', () => ({
  sheets: () => ({
    spreadsheets: {
      create: async () => ({ data: { spreadsheetId: 'sheet-1', sheets: [{ properties: { sheetId: 0 } }] } }),
      batchUpdate: async () => ({}),
      values: {
        batchUpdate: async ({ requestBody }: { requestBody: { data: { values: unknown[][] }[] } }) => {
          // data[0] is the header row; data[1], when present, the participants.
          h.written.push(requestBody.data[1]?.values ?? [])
          return {}
        },
      },
    },
  }),
}))

const { GET } = await import('./route')

const GRADE_COL = 9
const REG = 'reg-1'

const participant = (membership_id: string, grade: string | null, event_role = 'student') => ({
  registration_id: REG,
  membership_id,
  event_role,
  first_name: 'P',
  last_name: membership_id,
  grade,
  dietary_requirements: [],
})

async function gradesWritten(participants: object[]): Promise<unknown[]> {
  h.db = fakeSupabase({
    registrations: [{ id: REG, event_title: 'The Event', school_name: 'A School', type: 'group', spreadsheet_id: null }],
    members: [{ id: 'mem-1', clerk_user_id: 'user_placeholder', email: null }],
    participants,
  })
  const res = await GET(new NextRequest(`http://localhost/api/registrations/${REG}/spreadsheet`), {
    params: Promise.resolve({ id: REG }),
  })
  expect(res.status).toBe(302)
  return (h.written.at(-1) ?? []).map((row) => row[GRADE_COL])
}

beforeEach(() => {
  h.written = []
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', 'placeholder@example.invalid')
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', 'placeholder-key')
})

describe('team spreadsheet Grade column', () => {
  it('writes both stored shapes of a school grade the same way', async () => {
    expect(await gradesWritten([participant('S1', '10'), participant('S2', 'grade_10')])).toEqual(['10', '10'])
  })

  it('writes a college grade as its form label', async () => {
    expect(await gradesWritten([participant('S1', 'college_freshman'), participant('S2', 'grad_phd')])).toEqual([
      'College Freshman',
      'Grad / PhD',
    ])
  })

  it('leaves the cell empty when there is no grade', async () => {
    expect(await gradesWritten([participant('T1', null, 'teacher'), participant('S1', '  ')])).toEqual(['', ''])
  })

  it('passes an unrecognised value through unchanged', async () => {
    expect(await gradesWritten([participant('S1', 'Homeschool')])).toEqual(['Homeschool'])
  })
})
