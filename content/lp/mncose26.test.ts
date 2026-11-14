import { describe, expect, it } from 'vitest'
import { getCurriculumLandingPage } from './index'
import { mncose26 } from './mncose26'

// Pins the V2 handover's binding rules (§0, §1) to the page's copy, so a later
// edit cannot quietly break one.
const allText = JSON.stringify(mncose26)

describe('/lp/mncose26 content', () => {
  it('is registered under its own slug', () => {
    expect(getCurriculumLandingPage('mncose26')).toBe(mncose26)
  })

  it('never says "campaign" in public copy', () => {
    expect(allText.toLowerCase()).not.toContain('campaign')
  })

  it('uses American spelling', () => {
    for (const british of ['programme', 'colour', 'centre', 'organis', 'oxidis', 'fertilis', 'autumn', 'licence']) {
      expect(allText.toLowerCase()).not.toContain(british)
    }
  })

  it('carries the deadline on the primary CTA', () => {
    expect(mncose26.hero.primaryCta).toBe('Get the free curriculum — due 1/31/27')
  })

  it('uses the verified stats and nothing else', () => {
    expect(mncose26.proof.stats.map((s) => `${s.value} ${s.label}`)).toEqual([
      '46% female',
      'More than 50% race other than White',
      '33% repeat participants',
      'Nearly 90% go on to pursue STEM or medicine',
      '1,000+ students in 10 states',
    ])
  })

  it('keeps the fixed facts', () => {
    expect(allText).toContain('2–12 students per team')
    expect(allText).toContain('10–20 page')
    expect(allText).toContain('1/1/27–5/14/27')
    expect(allText).toContain('5/31/27')
    expect(allText).toContain('100% money-back guarantee within 45 days')
    // The camp fee is always stated.
    expect(mncose26.steps.items.at(-1)?.body).toMatch(/fee applies/)
  })

  it('has 6–8 FAQ items and one form', () => {
    expect(mncose26.faq.items.length).toBeGreaterThanOrEqual(6)
    expect(mncose26.faq.items.length).toBeLessThanOrEqual(8)
  })

  it('does not mention Solar Commons', () => {
    expect(allText).not.toMatch(/solar commons/i)
  })
})
