import { describe, it, expect } from 'vitest'
import { STRICT_REGIONS, isStrictRegion } from './consent'

/**
 * This list decides whether the HubSpot tracking script is withheld until
 * consent. It used to exist only inside ConsentMode.tsx, where Google enforced
 * it; HubSpot has no equivalent mechanism, so the same list now gates our own
 * render. A country present for one and missing for the other is a silent
 * compliance gap, which is why there is exactly one copy.
 */
describe('isStrictRegion', () => {
  it('treats EEA, UK and Switzerland as strict', () => {
    for (const country of ['DE', 'FR', 'IE', 'GB', 'CH', 'NO', 'IS']) {
      expect(isStrictRegion(country), country).toBe(true)
    }
  })

  it('treats the US and other non-EEA countries as non-strict', () => {
    for (const country of ['US', 'CA', 'AU', 'NZ', 'JP', 'BR']) {
      expect(isStrictRegion(country), country).toBe(false)
    }
  })

  it('is case-insensitive, since header casing is not guaranteed', () => {
    expect(isStrictRegion('gb')).toBe(true)
    expect(isStrictRegion('De')).toBe(true)
  })

  /**
   * Vercel's geo header is absent in local dev and on other hosts. Failing
   * "strict" there would disable tracking everywhere geo cannot be resolved;
   * failing "non-strict" matches the Consent Mode default that applies when no
   * region matches.
   */
  it('treats unknown geo as non-strict, matching the Consent Mode default', () => {
    expect(isStrictRegion(null)).toBe(false)
    expect(isStrictRegion(undefined)).toBe(false)
    expect(isStrictRegion('')).toBe(false)
  })

  it('covers the EU27 plus EEA/UK/CH without duplicates', () => {
    expect(new Set(STRICT_REGIONS).size).toBe(STRICT_REGIONS.length)
    // EU27 members must all be present.
    for (const country of ['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE']) {
      expect(STRICT_REGIONS, country).toContain(country)
    }
  })
})
