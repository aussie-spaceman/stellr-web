import { describe, it, expect } from 'vitest'
import { classify, findEmail, findString, normaliseEngagement } from './apollo-events'

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
