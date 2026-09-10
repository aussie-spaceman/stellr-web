import { describe, it, expect } from 'vitest'
import {
  classify,
  findEmail,
  findString,
  hasUnresolvedTemplateTokens,
  normaliseEngagement,
} from './apollo-events'

describe('classify', () => {
  it('reads a click from whichever field carries the event type', () => {
    expect(classify({ event_type: 'email_clicked' })).toBe('clicked')
    expect(classify({ event: 'emailer_message.clicked' })).toBe('clicked')
    expect(classify({ email_status: 'Clicked' })).toBe('clicked')
    expect(classify({ data: { nested: { type: 'link_clicked' } } })).toBe('clicked')
  })

  it('reads a reply', () => {
    expect(classify({ event_type: 'email_replied' })).toBe('replied')
    expect(classify({ email_status: 'Replied' })).toBe('replied')
  })

  /**
   * Apollo rewrites every link in an outbound email into a click-tracking
   * redirect. A payload for an *open* therefore contains the substring
   * "click" — and matching it would open a Participant Pipeline deal for
   * someone who never clicked anything.
   */
  it('does not read a click out of click-tracking URLs on an open event', () => {
    expect(
      classify({
        event_type: 'email_opened',
        body_html: '<a href="https://apollo.io/click-tracking/abc123">Read more</a>',
      }),
    ).toBeUndefined()
  })

  it('declines to guess when no event field is present', () => {
    expect(classify({ contact: { email: 'a@b.com' } })).toBeUndefined()
    expect(classify({})).toBeUndefined()
    expect(classify(null)).toBeUndefined()
  })

  it('prefers reply over click when a reply payload carries both', () => {
    expect(classify({ type: 'replied', prior_status: 'clicked' })).toBe('replied')
  })
})

describe('findEmail', () => {
  it('finds an email at any depth and normalises it', () => {
    expect(findEmail({ contact: { email: '  Ada@Example.COM ' } })).toBe('ada@example.com')
  })

  it('ignores email-ish keys that hold no address', () => {
    expect(findEmail({ email_status: 'clicked' })).toBeUndefined()
  })

  it('returns undefined when there is nothing to find', () => {
    expect(findEmail({ id: 1 })).toBeUndefined()
    expect(findEmail(null)).toBeUndefined()
  })

  it('survives a circular payload', () => {
    const node: Record<string, unknown> = { email: 'x@y.com' }
    node.self = node
    expect(findEmail(node)).toBe('x@y.com')
  })
})

describe('findString', () => {
  it('matches keys case-insensitively', () => {
    expect(findString({ Sequence_Name: 'Q4 push' }, ['sequence_name'])).toBe('Q4 push')
  })

  it('skips empty strings', () => {
    expect(findString({ first_name: '   ' }, ['first_name'])).toBeUndefined()
  })
})

/**
 * The signal that actually distinguishes the two Apollo workflows. Their
 * "Send webhook" action posts the contact record and says nothing about which
 * trigger fired, so each workflow is pointed at its own `?event=` URL.
 */
describe('normaliseEngagement', () => {
  it('reads the value each workflow URL carries', () => {
    expect(normaliseEngagement('clicked')).toBe('clicked')
    expect(normaliseEngagement('replied')).toBe('replied')
  })

  it('tolerates casing, padding and Apollo trigger phrasing', () => {
    expect(normaliseEngagement('  Clicked ')).toBe('clicked')
    expect(normaliseEngagement('Email clicked')).toBe('clicked')
    expect(normaliseEngagement('Email replied')).toBe('replied')
  })

  it('returns undefined for a missing or unrelated value', () => {
    expect(normaliseEngagement(null)).toBeUndefined()
    expect(normaliseEngagement('')).toBeUndefined()
    expect(normaliseEngagement('opened')).toBeUndefined()
  })
})

/**
 * Apollo's "Test connection" posts the webhook Body verbatim, without resolving
 * any dynamic variable — verified in production, where it sent
 * `{"email":"{{contact.email}}"}` literally. A Body that references the contact
 * therefore can never produce a passing test, so this distinguishes "the
 * operator is testing the connection" from "a real event arrived without an
 * email", which is a genuine fault.
 */
describe('hasUnresolvedTemplateTokens', () => {
  it('spots Apollo template tokens that were never substituted', () => {
    expect(
      hasUnresolvedTemplateTokens({
        email: '{{contact.email}}',
        first_name: '{{contact.first_name}}',
      }),
    ).toBe(true)
  })

  it('spots a half-filled body, where only some fields were replaced', () => {
    expect(
      hasUnresolvedTemplateTokens({ email: '{{contact.email}}', first_name: '' }),
    ).toBe(true)
  })

  it('spots guillemet placeholders left in from setup instructions', () => {
    expect(hasUnresolvedTemplateTokens({ last_name: '«insert Last Name»' })).toBe(true)
  })

  it('is false for a real payload, so a genuine fault still fails loudly', () => {
    expect(
      hasUnresolvedTemplateTokens({ email: 'head@ccsd.net', first_name: 'Ada' }),
    ).toBe(false)
    expect(hasUnresolvedTemplateTokens({})).toBe(false)
    expect(hasUnresolvedTemplateTokens(null)).toBe(false)
  })

  it('survives a circular payload', () => {
    const node: Record<string, unknown> = { email: '{{contact.email}}' }
    node.self = node
    expect(hasUnresolvedTemplateTokens(node)).toBe(true)
  })
})
