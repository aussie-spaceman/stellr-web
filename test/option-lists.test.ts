// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { DIETARY } from '@/lib/registration-constants'

// deep review QUAL-2: the form option lists were copied into 8+ files and had
// already diverged — the group roster-sheet builder's dietary list omitted Halal
// and Kosher, and two member forms submitted the baseline '3XL_plus' spelling.
// These guards keep the copies from creeping back.

describe('option lists (QUAL-2)', () => {
  it('the canonical dietary list includes Halal and Kosher', () => {
    expect(DIETARY).toContain('Halal')
    expect(DIETARY).toContain('Kosher')
  })

  // The two roster-sheet builders must import the single source, not re-inline a
  // (drift-prone) dietary list of their own.
  for (const f of ['lib/google-sheets.ts', 'app/api/registrations/[id]/spreadsheet/route.ts']) {
    it(`${f} imports the canonical option lists instead of re-declaring them`, () => {
      const src = readFileSync(f, 'utf8')
      expect(src).toMatch(/from '@\/lib\/registration-constants'/)
      expect(src, 'a re-inlined dietary list has crept back').not.toMatch(
        /\[\s*'None',\s*'Dairy \/ Lactose Free',\s*'Gluten Free',\s*'Vegetarian'/,
      )
    })
  }

  // The admin + onboarding forms must offer the canonical sizes, never the
  // baseline '3XL_plus' option value.
  for (const f of ['components/admin/AdminAddMember.tsx', 'components/member/OnboardingForm.tsx']) {
    it(`${f} offers the canonical t-shirt sizes, not the '3XL_plus' option`, () => {
      const src = readFileSync(f, 'utf8')
      expect(src).toMatch(/T_SHIRT_SIZES/)
      expect(src, "the '3XL_plus' option value is back").not.toMatch(/'2XL',\s*'3XL_plus'/)
    })
  }
})
