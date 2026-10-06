import { describe, expect, it } from 'vitest'
import { certificateGate, type GateDistribution, type GateInvitation } from './certificate-gate'

const NOW = new Date('2026-11-10T12:00:00Z')

const dist = (over: Partial<GateDistribution> = {}): GateDistribution => ({
  id: 'd1',
  event_slug: 'co-sdc-2026',
  event_title: 'Colorado SDC 2026',
  gate_certificate: true,
  status: 'open',
  opens_at: '2026-11-01T06:00:00Z',
  closes_at: '2026-12-01T06:00:00Z',
  ...over,
})
const inv = (over: Partial<GateInvitation> = {}): GateInvitation => ({ id: 'i1', distribution_id: 'd1', status: 'sent', ...over })

describe('certificate gate (D1)', () => {
  it('holds the certificate while the survey is open and the invitation is unsubmitted', () => {
    const g = certificateGate('co-sdc-2026', [dist()], [inv()], NOW)
    expect(g).toEqual({
      gated: true,
      invitationId: 'i1',
      eventTitle: 'Colorado SDC 2026',
      closesAt: '2026-12-01T06:00:00Z',
      surveyUrl: '/community/surveys/open/i1',
    })
    for (const status of ['queued', 'opened', 'started', 'bounced', 'opted_out']) {
      expect(certificateGate('co-sdc-2026', [dist()], [inv({ status })], NOW).gated).toBe(true)
    }
  })

  it('is off unless the event turned it on', () => {
    expect(certificateGate('co-sdc-2026', [dist({ gate_certificate: false })], [inv()], NOW).gated).toBe(false)
  })

  it('never gates someone who was not invited', () => {
    expect(certificateGate('co-sdc-2026', [dist()], [], NOW).gated).toBe(false)
    expect(certificateGate('co-sdc-2026', [dist()], [inv({ distribution_id: 'other' })], NOW).gated).toBe(false)
  })

  it('lifts once submitted', () => {
    expect(certificateGate('co-sdc-2026', [dist()], [inv({ status: 'submitted' })], NOW).gated).toBe(false)
    expect(certificateGate('co-sdc-2026', [dist()], [inv({ status: 'expired' })], NOW).gated).toBe(false)
  })

  it('never gates once the survey has closed, by the clock or early', () => {
    expect(certificateGate('co-sdc-2026', [dist()], [inv()], new Date('2026-12-01T06:00:00Z')).gated).toBe(false)
    expect(certificateGate('co-sdc-2026', [dist({ status: 'closed' })], [inv()], NOW).gated).toBe(false)
  })

  it('does not gate before go-live or while paused', () => {
    const scheduled = dist({ status: 'scheduled', opens_at: '2026-11-20T06:00:00Z', closes_at: '2026-12-20T06:00:00Z' })
    expect(certificateGate('co-sdc-2026', [scheduled], [inv()], NOW).gated).toBe(false)
    expect(certificateGate('co-sdc-2026', [dist({ status: 'paused' })], [inv()], NOW).gated).toBe(false)
  })

  it('treats a scheduled survey past its go-live as open (before the cron flips it)', () => {
    expect(certificateGate('co-sdc-2026', [dist({ status: 'scheduled' })], [inv()], NOW).gated).toBe(true)
  })

  it('only applies to the credential’s own event', () => {
    expect(certificateGate('ne-sdc-2026', [dist()], [inv()], NOW).gated).toBe(false)
    expect(certificateGate(null, [dist()], [inv()], NOW).gated).toBe(false)
  })
})
