// The account confirmation is email 1 of the welcome sequence and is the only
// one of the four that isn't authored in the DB, so it has no admin Test button
// behind it. These lock down the two things a copy edit can silently break:
// the tier→family routing, and HTML/text staying in sync.

import { describe, it, expect } from 'vitest'
import { renderAccountConfirmation, confirmationCopyFor } from '@/lib/registration-notify'

const render = (tierName: string | null, spaceNames: string[] = []) =>
  renderAccountConfirmation({ first_name: 'Jordan' }, { tierName, spaceNames })

describe('confirmationCopyFor — tier → family routing', () => {
  it('routes every tier of a family to that family’s copy', () => {
    const hs = confirmationCopyFor('Explorer')
    expect(confirmationCopyFor('Pathfinder')).toEqual(hs)
    expect(confirmationCopyFor('Scholar')).toEqual(hs)

    const college = confirmationCopyFor('Alumni')
    expect(confirmationCopyFor('Contributor')).toEqual(college)
    expect(confirmationCopyFor('Counselor')).toEqual(college)

    const teacher = confirmationCopyFor('Educator')
    expect(confirmationCopyFor('Trailblazer')).toEqual(teacher)
  })

  it('gives the three families distinct copy', () => {
    const [hs, college, teacher] = ['Explorer', 'Alumni', 'Educator'].map(confirmationCopyFor)
    expect(new Set([hs.spaceContents, college.spaceContents, teacher.spaceContents]).size).toBe(3)
  })

  it('falls back to neutral copy for a family-less or unknown tier', () => {
    // Subscriber and Parent/Guardian are real tiers with no TIER_GROUPS entry —
    // they must not inherit teacher copy about lesson plans.
    const neutral = confirmationCopyFor(null)
    expect(confirmationCopyFor('Subscriber')).toEqual(neutral)
    expect(confirmationCopyFor('Parent/Guardian')).toEqual(neutral)
    expect(neutral.spaceContents).not.toMatch(/lesson plans/)
  })
})

describe('renderAccountConfirmation', () => {
  it('uses the family copy in both the HTML and the text part', () => {
    for (const tier of ['Explorer', 'Alumni', 'Educator', 'Subscriber', null]) {
      const copy = confirmationCopyFor(tier)
      const { html, text } = render(tier)
      expect(html).toContain(copy.spaceContents)
      expect(html).toContain(copy.community)
      expect(text).toContain(copy.spaceContents)
      expect(text).toContain(copy.community)
    }
  })

  it('names the tier and prefers the real Space name', () => {
    const { html, text } = render('Explorer', ['Explorer Tier Space'])
    expect(html).toContain('Explorer membership')
    expect(html).toContain('Explorer Tier Space')
    expect(text).toContain('Explorer Tier Space')
  })

  it('never reads "Your  membership" when the tier did not resolve', () => {
    const { html, text } = render(null)
    expect(html).toContain('<strong>membership</strong> is now active')
    expect(text).toContain('Your membership is now active')
    expect(html).not.toMatch(/Your\s{2,}membership/)
  })

  it('sends no unsubscribe footer — it is transactional, not marketing', () => {
    expect(render('Explorer').html).not.toMatch(/unsubscribe/i)
  })
})
