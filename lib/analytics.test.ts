import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { trackLeadSubmitted, participationTypeFor, type LeadFormSource } from '@/lib/analytics'

/**
 * These tests guard two things that are cheap to break and expensive to notice:
 * the audience split (an ad tag keyed on it silently targets the wrong people)
 * and the no-PII rule (a leak here reaches Google, Meta and LinkedIn at once).
 */

function pushed(): Record<string, unknown>[] {
  return (window.dataLayer ?? []) as Record<string, unknown>[]
}

describe('trackLeadSubmitted', () => {
  beforeEach(() => {
    window.dataLayer = []
  })

  afterEach(() => {
    window.dataLayer = []
  })

  it('pushes a lead_submitted event naming the route', () => {
    trackLeadSubmitted('newsletter')
    expect(pushed()).toHaveLength(1)
    expect(pushed()[0]).toMatchObject({ event: 'lead_submitted', lead_source: 'newsletter' })
  })

  it('classifies professional routes as b2b', () => {
    for (const source of ['white_paper', 'asset_request', 'host_event', 'join_network', 'contact'] as LeadFormSource[]) {
      window.dataLayer = []
      trackLeadSubmitted(source)
      expect(pushed()[0].audience, `${source} should be b2b`).toBe('b2b')
    }
  })

  it('classifies student and parent routes as b2c', () => {
    for (const source of ['newsletter', 'event_notify', 'scholarship'] as LeadFormSource[]) {
      window.dataLayer = []
      trackLeadSubmitted(source)
      expect(pushed()[0].audience, `${source} should be b2c`).toBe('b2c')
    }
  })

  it('every source resolves to an audience', () => {
    const all: LeadFormSource[] = [
      'newsletter', 'event_notify', 'white_paper', 'asset_request',
      'scholarship', 'host_event', 'contact', 'join_network',
    ]
    for (const source of all) {
      window.dataLayer = []
      trackLeadSubmitted(source)
      expect(pushed()[0].audience, `${source} has no audience`).toMatch(/^(b2b|b2c)$/)
    }
  })

  it('merges non-identifying detail', () => {
    trackLeadSubmitted('event_notify', { competition_id: 'nevada-2027', registration_interest: 'group' })
    expect(pushed()[0]).toMatchObject({
      lead_source: 'event_notify',
      competition_id: 'nevada-2027',
      registration_interest: 'group',
    })
  })

  it('drops undefined detail rather than pushing empty keys', () => {
    trackLeadSubmitted('event_notify', { competition_id: undefined })
    expect(pushed()[0]).not.toHaveProperty('competition_id')
  })

  it('carries no PII — the signature takes a route name, not the submitted values', () => {
    trackLeadSubmitted('scholarship')
    const payload = JSON.stringify(pushed()[0])
    for (const forbidden of ['@', 'email', 'firstname', 'lastname', 'phone', 'name']) {
      expect(payload.toLowerCase(), `payload leaked "${forbidden}"`).not.toContain(forbidden)
    }
  })

  it('queues safely before GTM has created the dataLayer', () => {
    // @ts-expect-error deliberately simulating the pre-GTM window
    delete window.dataLayer
    expect(() => trackLeadSubmitted('newsletter')).not.toThrow()
    expect(pushed()).toHaveLength(1)
  })
})

describe('participationTypeFor', () => {
  it('maps campaigns and live events', () => {
    expect(participationTypeFor('campaign')).toBe('campaign')
    expect(participationTypeFor('live_event')).toBe('event')
    expect(participationTypeFor(undefined)).toBe('event')
  })
})
