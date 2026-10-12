import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  decideDealAction,
  PARTICIPANT_PIPELINE_ID,
  PARTICIPANT_STAGE,
  type DealSnapshot,
} from './hubspot-deals'

const inPipeline = (stage: string, id = '1'): DealSnapshot => ({
  id,
  pipeline: PARTICIPANT_PIPELINE_ID,
  stage,
})

describe('decideDealAction', () => {
  it('opens a deal at Initial Interest on a first click', () => {
    expect(decideDealAction('clicked', [])).toEqual({
      action: 'create',
      stage: PARTICIPANT_STAGE.initialInterest,
    })
  })

  it('opens a deal at Initial Engagement on a first reply', () => {
    expect(decideDealAction('replied', [])).toEqual({
      action: 'create',
      stage: PARTICIPANT_STAGE.initialEngagement,
    })
  })

  /**
   * The reason this module exists. A tracking redirect can fire repeatedly for
   * one prospect — an inbox scanner prefetching links, or the mail being
   * forwarded — and a deal per event would bury the pipeline inside one
   * sequence.
   */
  it('does not open a second deal when the same prospect clicks again', () => {
    const decision = decideDealAction('clicked', [
      inPipeline(PARTICIPANT_STAGE.initialInterest),
    ])
    expect(decision.action).toBe('none')
  })

  it('advances the existing deal rather than duplicating it when a click is followed by a reply', () => {
    expect(
      decideDealAction('replied', [inPipeline(PARTICIPANT_STAGE.initialInterest, '77')]),
    ).toEqual({
      action: 'advance',
      dealId: '77',
      stage: PARTICIPANT_STAGE.initialEngagement,
      from: PARTICIPANT_STAGE.initialInterest,
    })
  })

  /**
   * Apollo keeps firing opens and clicks for the life of a thread, so a click
   * routinely arrives after a reply. Acting on it would drag an engaged
   * prospect back down the pipeline.
   */
  it('never moves a deal backwards', () => {
    const decision = decideDealAction('clicked', [
      inPipeline(PARTICIPANT_STAGE.initialEngagement),
    ])
    expect(decision.action).toBe('none')
  })

  it('leaves deals that are already further along untouched', () => {
    expect(
      decideDealAction('replied', [inPipeline(PARTICIPANT_STAGE.decisionMakerBoughtIn)])
        .action,
    ).toBe('none')
  })

  /**
   * A prospect closed lost months ago who engages with a new sequence is a
   * fresh opportunity. Reopening the old deal would rewrite closed history and
   * corrupt win/loss reporting.
   */
  it('opens a new deal rather than reopening a closed one', () => {
    expect(decideDealAction('clicked', [inPipeline(PARTICIPANT_STAGE.closedLost)])).toEqual({
      action: 'create',
      stage: PARTICIPANT_STAGE.initialInterest,
    })
    expect(decideDealAction('replied', [inPipeline(PARTICIPANT_STAGE.closedWon)]).action).toBe(
      'create',
    )
  })

  it('ignores deals belonging to another pipeline', () => {
    const eventPipelineDeal: DealSnapshot = {
      id: '9',
      pipeline: 'default',
      stage: 'appointmentscheduled',
    }
    expect(decideDealAction('clicked', [eventPipelineDeal]).action).toBe('create')
  })

  it('advances the furthest-along deal when a contact somehow has two open', () => {
    const decision = decideDealAction('replied', [
      inPipeline(PARTICIPANT_STAGE.initialInterest, 'older'),
      inPipeline(PARTICIPANT_STAGE.initialInterest, 'newer'),
    ])
    expect(decision.action).toBe('advance')
  })
})

/**
 * deep review INT-7: a read that FAILS must be distinguishable from a contact
 * with no deals. Returning [] on an error made decideDealAction return `create`,
 * duplicating a deal on any HubSpot 429/5xx. These pin the tri-state contract:
 * null on a non-OK read, [] only on a successful empty read.
 */
describe('dealsForContact — a read error is not "no deals"', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.HUBSPOT_ACCESS_TOKEN = 'test-token'
  })
  afterEach(() => {
    delete process.env.HUBSPOT_ACCESS_TOKEN
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('returns null (not []) when the associations read is rate-limited', async () => {
    vi.doMock('@/lib/hubspot', () => ({
      hubspotFetch: vi.fn(async () => ({ ok: false, status: 429 }) as unknown as Response),
    }))
    const { dealsForContact } = await import('./hubspot-deals')
    expect(await dealsForContact('c1')).toBeNull()
  })

  it('returns null when the batch-read of the associated deals fails', async () => {
    const hubspotFetch = vi
      .fn()
      // associations read OK, one associated deal id
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ results: [{ toObjectId: '42' }] }) })
      // batch read 500s
      .mockResolvedValueOnce({ ok: false, status: 500 })
    vi.doMock('@/lib/hubspot', () => ({ hubspotFetch }))
    const { dealsForContact } = await import('./hubspot-deals')
    expect(await dealsForContact('c1')).toBeNull()
  })

  it('returns [] when the read succeeds with no associated deals', async () => {
    vi.doMock('@/lib/hubspot', () => ({
      hubspotFetch: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }) as unknown as Response),
    }))
    const { dealsForContact } = await import('./hubspot-deals')
    expect(await dealsForContact('c1')).toEqual([])
  })
})
