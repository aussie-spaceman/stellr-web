import { describe, expect, it } from 'vitest'
import { findStaffWords, STAFF_ROLE_FILES } from './lint-staff-word.mjs'

const hits = (src: string, file = 'lib/x.ts') => (findStaffWords(file, src) as { what: string; value: string }[]).map((h) => `${h.what}:${h.value}`)

describe('lint:staff-word', () => {
  it('flags identifiers, strings, template text and regexes', () => {
    expect(hits("const isStaffTarget = 1\nconst t = 'staff_roles'\nconst u = `to ${t} staff`\nconst r = /staff/")).toEqual([
      'identifier:isStaffTarget',
      'string:staff_roles',
      'string:staff',
      'regex:/staff/',
    ])
  })

  it('flags JSX text', () => {
    expect(hits('export const A = () => <p>Staff roles</p>', 'components/A.tsx')).toEqual(['jsx-text:Staff roles'])
  })

  it('skips comments', () => {
    expect(hits('// staff need to know\n/** What staff see. */\nconst crew = 1')).toEqual([])
  })

  it('honours a same-line opt-out that gives a reason', () => {
    expect(hits("const a = 'staff_undo' // staff-word-ok: legacy queued tap name")).toEqual([])
    expect(hits("const a = 'staff_undo' // staff-word-ok:")).toEqual(['string:staff_undo'])
  })

  it('gives every allowlisted file a reason', () => {
    for (const reason of Object.values(STAFF_ROLE_FILES as Record<string, string>)) expect(reason.length).toBeGreaterThan(5)
  })
})
