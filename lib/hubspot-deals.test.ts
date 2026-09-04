import { describe, it, expect } from 'vitest'
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
