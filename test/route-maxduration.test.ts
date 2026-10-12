// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// deep review QUAL-7: the three money/minors handlers run long, sequential
// fan-outs (per-participant consent dispatch, Google Sheets, Stripe). Each must
// pin an explicit maxDuration so a large registration or a slow webhook is not
// cut off by the lower platform default mid-flow (envelopes issued, invoice
// unsent). NB: this is the SAFE part of QUAL-7 — extracting the 500–1000-line
// handlers is deliberately NOT done here (regression risk on just-shipped fixes)
// and is flagged as a follow-up.
describe('long route handlers declare maxDuration (QUAL-7)', () => {
  for (const f of [
    'app/api/register/group/route.ts',
    'app/api/register/individual/route.ts',
    'app/api/stripe/webhook/route.ts',
  ]) {
    it(`${f} exports a maxDuration`, () => {
      expect(readFileSync(f, 'utf8')).toMatch(/export const maxDuration = \d+/)
    })
  }
})
