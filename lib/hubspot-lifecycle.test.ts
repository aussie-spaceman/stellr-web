import { describe, it, expect } from 'vitest'
import {
  LEAD_SOURCE_LIFECYCLE,
  LEAD_SOURCES,
  SUBSCRIBER_LEAD_SOURCES,
  type LeadSource,
} from '@/lib/hubspot-fields'

/**
 * The lifecycle map is now the single source of truth for two things that must
 * agree: what the capture routes ask for, and what the reconciliation cron puts
 * back. A drift between them is silent — contacts just sit on the wrong stage —
 * so it is worth pinning here.
 */

describe('LEAD_SOURCE_LIFECYCLE', () => {
  it('covers every lead source', () => {
    const sources = Object.keys(LEAD_SOURCES) as LeadSource[]
    for (const source of sources) {
      expect(LEAD_SOURCE_LIFECYCLE[source], `${source} has no lifecycle intent`).toBeDefined()
    }
    expect(Object.keys(LEAD_SOURCE_LIFECYCLE).sort()).toEqual(sources.sort())
  })

  it('treats information signups as subscribers', () => {
    expect(LEAD_SOURCE_LIFECYCLE.newsletter).toBe('subscriber')
    expect(LEAD_SOURCE_LIFECYCLE.event_notify).toBe('subscriber')
    expect(LEAD_SOURCE_LIFECYCLE.white_paper).toBe('subscriber')
    expect(LEAD_SOURCE_LIFECYCLE.asset_request).toBe('subscriber')
  })

  it('treats requests needing a human response as leads', () => {
    expect(LEAD_SOURCE_LIFECYCLE.scholarship).toBe('lead')
    expect(LEAD_SOURCE_LIFECYCLE.host_event).toBe('lead')
  })

  it('only uses stages HubSpot actually defines', () => {
    for (const stage of Object.values(LEAD_SOURCE_LIFECYCLE)) {
      expect(['subscriber', 'lead']).toContain(stage)
    }
  })
})

describe('SUBSCRIBER_LEAD_SOURCES', () => {
  it('is exactly the sources the cron needs to correct', () => {
    expect([...SUBSCRIBER_LEAD_SOURCES].sort()).toEqual(
      ['asset_request', 'event_notify', 'newsletter', 'white_paper'].sort(),
    )
  })

  it('derives from the map rather than being hand-maintained', () => {
    const derived = (Object.keys(LEAD_SOURCE_LIFECYCLE) as LeadSource[]).filter(
      (s) => LEAD_SOURCE_LIFECYCLE[s] === 'subscriber',
    )
    expect([...SUBSCRIBER_LEAD_SOURCES].sort()).toEqual(derived.sort())
  })

  it('excludes the lead-intent sources, which HubSpot already gets right', () => {
    expect(SUBSCRIBER_LEAD_SOURCES).not.toContain('scholarship')
    expect(SUBSCRIBER_LEAD_SOURCES).not.toContain('host_event')
  })

  it('maps to portal-facing labels the search filter can use', () => {
    for (const source of SUBSCRIBER_LEAD_SOURCES) {
      expect(typeof LEAD_SOURCES[source]).toBe('string')
      expect(LEAD_SOURCES[source].length).toBeGreaterThan(0)
    }
  })
})
