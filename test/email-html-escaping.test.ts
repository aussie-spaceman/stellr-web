// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// deep review INTPUB-N1 (completes INT-5): the de37fc85 escaping sweep fixed the
// lib/email.ts templates + notify/mentions, but missed the callers that build
// their OWN `email.html` string and pass it to notify/sendEmail pre-built —
// notify only escapes its plain-body fallback, so a caller-supplied html is sent
// verbatim. Each member-controlled value interpolated into one of those strings
// must be wrapped in escapeHtml. This is a static regression guard: for each
// file, the escaped form must be present and the known RAW form must be gone, so
// unwrapping any one of them (the mutation) turns this red.
//
// Mail clients strip <script>, so the risk is spoofed links/layout in trusted
// first-party mail aimed at staff (admin sessions) and minors — Medium, matching
// INT-5's original rating. A generic lint (flag a `${}` inside an `html:`
// template literal that is not escapeHtml'd) is the longer-term guard; this
// pins the specific call sites the sweep missed.

interface Case {
  file: string
  mustImportEscape: boolean
  escaped: string[] // substrings that MUST be present after the fix
  rawGone: string[]  // raw interpolations that must NO LONGER appear
}

const CASES: Case[] = [
  {
    file: 'app/api/community/training/[itemId]/flag/route.ts',
    mustImportEscape: true,
    escaped: ['escapeHtml(memberName)', 'escapeHtml(lessonTitle)', 'escapeHtml(moduleTitle)'],
    rawGone: ['<strong>${memberName}</strong>'],
  },
  {
    file: 'app/api/community/training/group-nudge/route.ts',
    mustImportEscape: true,
    escaped: ['escapeHtml(label)'],
    rawGone: ['<strong>${label}</strong>'],
  },
  {
    file: 'app/api/admin/training/bulk-notify/route.ts',
    mustImportEscape: true,
    escaped: ['escapeHtml(label)'],
    rawGone: ['<strong>${label}</strong>'],
  },
  {
    file: 'lib/coaching-requests.ts',
    mustImportEscape: true,
    escaped: ['escapeHtml(memberName)', 'escapeHtml(topic)', 'escapeHtml(member.first_name'],
    rawGone: ['<strong>Member:</strong> ${memberName}'],
  },
  {
    file: 'app/api/admin/community/spaces/[id]/route.ts',
    mustImportEscape: true,
    escaped: ['escapeHtml(spaceName)', 'escapeHtml(sp.name)'],
    rawGone: ['<strong>${spaceName}</strong>', '<strong>${sp.name}</strong>'],
  },
]

describe('self-built email.html callers escape member-controlled values (INTPUB-N1)', () => {
  for (const c of CASES) {
    it(`${c.file} escapes its interpolated member-controlled fields`, () => {
      const src = readFileSync(c.file, 'utf8')
      if (c.mustImportEscape) {
        expect(src, `${c.file} must import escapeHtml`).toMatch(
          /import\s*\{[^}]*\bescapeHtml\b[^}]*\}\s*from\s*'@\/lib\/email-layout'/,
        )
      }
      for (const needle of c.escaped) {
        expect(src.includes(needle), `${c.file} should contain ${needle}`).toBe(true)
      }
      for (const raw of c.rawGone) {
        expect(src.includes(raw), `${c.file} should NOT contain the un-escaped ${raw}`).toBe(false)
      }
    })
  }
})
