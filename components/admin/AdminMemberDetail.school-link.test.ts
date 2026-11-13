import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The member page's School section links to the school record the same way as
// every other admin record link since #636: SchoolLink, in a new tab, admins
// only (components/admin/RecordLinks.tsx). Found on production on 13 Nov 2026:
// this one was a next/link that opened in the same tab.
const SRC = readFileSync('components/admin/AdminMemberDetail.tsx', 'utf8')

describe('AdminMemberDetail school link', () => {
  it('uses SchoolLink for the current school', () => {
    expect(SRC).toMatch(/<SchoolLink schoolId=\{currentSchool\.school_id\}/)
  })

  it('has no same-tab link to a school record', () => {
    expect(SRC).not.toMatch(/<Link[^>]*href=\{`\/admin\/schools\//)
  })
})
