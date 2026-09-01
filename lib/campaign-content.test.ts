import { describe, it, expect } from 'vitest'
import {
  campaignEligibilityCopy,
  CAMPAIGN_FAQS,
  CAMPAIGN_INCLUDED,
  CAMPAIGN_STEPS,
} from '@/lib/campaign-content'

describe('campaignEligibilityCopy', () => {
  it('derives the grade range from the campaign grade level', () => {
    expect(campaignEligibilityCopy('High School')).toContain('grades 9–12')
    expect(campaignEligibilityCopy('Middle School')).toContain('grades 6–8')
    expect(campaignEligibilityCopy('Both')).toContain('grades 6–12')
    expect(campaignEligibilityCopy(undefined)).toContain('grades 9–12')
  })

  // The two rules that differ from live events, and the reason this copy is not
  // shared with the event page: campaigns are group-only, and the group can be
  // registered by a student manager rather than a teacher.
  it('states that campaigns are group-only, not individual', () => {
    const copy = campaignEligibilityCopy('High School')
    expect(copy).toContain('as a group rather than by individual')
    expect(copy).not.toContain('register individually')
  })

  it('names the student manager as a registering role', () => {
    expect(campaignEligibilityCopy('High School')).toContain('student manager')
  })
})

describe('campaign page copy', () => {
  // FAQPage JSON-LD serialises `text`; the accordion renders `a`. Search engines
  // treat schema that disagrees with the visible answer as spam.
  it('keeps every FAQ answer and its plain-text twin identical', () => {
    for (const faq of CAMPAIGN_FAQS) expect(faq.text).toBe(faq.a)
  })

  it('has no duplicate FAQ questions', () => {
    expect(new Set(CAMPAIGN_FAQS.map((f) => f.q)).size).toBe(CAMPAIGN_FAQS.length)
  })

  // Campaigns have no venue, no event day, no merchandise, and no Congress
  // progression — the Educator tier's engagement is written judging feedback.
  // These strings are all carried over from the event page by accident if the
  // two copy sets are ever "unified".
  it('makes no venue, travel, meal, t-shirt or Congress promise', () => {
    const all = [
      ...CAMPAIGN_INCLUDED,
      ...CAMPAIGN_STEPS.map((s) => `${s.title} ${s.body}`),
      ...CAMPAIGN_FAQS.map((f) => `${f.q} ${f.a}`),
    ]
      .join(' ')
      .toLowerCase()
    for (const forbidden of ['t-shirt', 'meals', 'venue', 'chaperone', 'congress', 'nasa johnson']) {
      expect(all).not.toContain(forbidden)
    }
  })

  // Freemium, not free: membership is required and its entry tier costs $0.
  it('describes the cost as membership-based rather than simply free', () => {
    const cost = CAMPAIGN_FAQS.find((f) => f.q.includes('cost'))
    expect(cost?.a).toContain('membership')
  })
})
