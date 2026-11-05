// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { pushDataLayer, trackLeadSubmitted, trackingAllowedHere, participationTypeFor, type LeadFormSource } from '@/lib/analytics'
import { importClosure, readRepoFile } from '@/test/import-closure'

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

describe('pushDataLayer by host', () => {
  const visit = (hostname: string) => vi.stubGlobal('location', new URL(`https://${hostname}/`))

  beforeEach(() => {
    window.dataLayer = []
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    window.dataLayer = []
  })

  for (const hostname of ['www.stellreducation.org', 'app.stellreducation.org', 'localhost', 'stellr-web-dev-x.vercel.app']) {
    it(`pushes on ${hostname}`, () => {
      visit(hostname)
      expect(trackingAllowedHere()).toBe(true)
      pushDataLayer({ event: 'page' })
      expect(pushed()).toEqual([{ event: 'page' }])
    })
  }

  for (const hostname of ['x.events.stellreducation.org', 'canary-academy.localhost', 'stellr.localhost', 'events.school.example']) {
    // The ConsentMode head script still creates a dataLayer until B5c moves it out
    // of the tenant root. This covers pushDataLayer only.
    it(`pushDataLayer pushes nothing on ${hostname} and creates no dataLayer itself`, () => {
      visit(hostname)
      // @ts-expect-error deliberately simulating the pre-GTM window
      delete window.dataLayer
      expect(trackingAllowedHere()).toBe(false)
      pushDataLayer({ event: 'page' })
      trackLeadSubmitted('newsletter')
      expect(window.dataLayer).toBeUndefined()
    })
  }

  it('gives the same answers with no tenant zone configured', () => {
    vi.stubEnv('TENANT_HOST_SUFFIX', '')
    vi.stubEnv('TENANT_ROUTING_ENABLED', '')
    visit('www.stellreducation.org')
    expect(trackingAllowedHere()).toBe(true)
    visit('x.events.stellreducation.org')
    expect(trackingAllowedHere()).toBe(false)
  })

  it('reaches only the pure host rules, never the host-map loader', () => {
    const closure = importClosure('lib/analytics.ts', readRepoFile)
    expect(closure.has('lib/tenancy/host-pure.ts')).toBe(true)
    expect(closure.has('lib/tenancy/host.ts')).toBe(false)
  })
})

describe('participationTypeFor', () => {
  it('maps campaigns and live events', () => {
    expect(participationTypeFor('campaign')).toBe('campaign')
    expect(participationTypeFor('live_event')).toBe('event')
    expect(participationTypeFor(undefined)).toBe('event')
  })
})
