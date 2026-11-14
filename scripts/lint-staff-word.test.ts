import { describe, expect, it } from 'vitest'
import { findStaffWords, RETIRED, STAFF_ROLE_FILES } from './lint-staff-word.mjs'

const hits = (src: string, file = 'lib/x.ts') => (findStaffWords(file, src) as { what: string; retired: string }[]).map((h) => `${h.what}:${h.retired}`)

describe('lint:staff-word', () => {
  it('lets the Staff role itself through', () => {
    expect(hits("const isStellrStaff = 1\nconst r = 'staff'\nconst c = STAFF_CAPABILITIES\nexport const t = 'Staff agreement'")).toEqual([])
  })
  it('refuses the retired names in identifiers, strings, template text and regexes', () => {
    expect(hits("const isStaffTargetOrUnknown = 1\nconst t = 'public.staff_roles'\nconst u = `go to /admin/staff now`\nconst r = /requireEventStaff/")).toEqual([
      'identifier:isStaffTarget',
      'string:staff_roles',
      'string:/admin/staff',
      'regex:requireEventStaff',
    ])
  })
  it('refuses retired UI words in JSX', () => {
    expect(hits('export const A = () => <p>Staff roles</p>', 'components/A.tsx')).toEqual(['jsx-text:Staff roles'])
  })
  it('treats /admin/staff as a whole path only', () => {
    expect(hits("const a = '/admin/staffing'")).toEqual([])
    expect(hits("const a = '/api/admin/staff-settings'")).toEqual([])
  })
  it('skips comments', () => {
    expect(hits('// staff_roles was renamed\n/** isStaffTarget is now isCrewTarget. */\nconst crew = 1')).toEqual([])
  })
  it('honours a same-line opt-out that gives a reason', () => {
    expect(hits("const a = 'staff_undo' // staff-word-ok: legacy queued tap name")).toEqual([])
    expect(hits("const a = 'staff_undo' // staff-word-ok:")).toEqual(['string:staff_undo'])
  })
  it('names a replacement for every retired word, and a reason for every allowlisted file', () => {
    for (const [, now] of RETIRED as [string, string][]) expect(now.length).toBeGreaterThan(3)
    for (const reason of Object.values(STAFF_ROLE_FILES as Record<string, string>)) expect(reason.length).toBeGreaterThan(5)
  })
})
