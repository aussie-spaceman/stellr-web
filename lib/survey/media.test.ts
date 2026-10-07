import { describe, expect, it } from 'vitest'
import { isNyCo, mediaPermission, mediaReasonDetail, type MediaFacts } from './media'

const signed = { exists: true, restricted: false, optOut: false, optOutKnown: true }
const facts = (over: Partial<MediaFacts> = {}): MediaFacts => ({
  isMinor: true,
  age: 15,
  states: ['NE'],
  agreement: signed,
  studentAllowMedia: null,
  ...over,
})

describe('media permission resolver', () => {
  it('a minor whose form was read with the box unticked is yes, and says so', () => {
    expect(mediaPermission(facts())).toEqual({ status: 'yes', reason: 'agreement_no_opt_out' })
  })

  it('a guardian opt-out on the agreement wins over the student turning media on', () => {
    expect(mediaPermission(facts({ agreement: { ...signed, optOut: true }, studentAllowMedia: true }))).toEqual({ status: 'no', reason: 'opted_out_on_agreement' })
  })

  it('a withdrawn consent is always no', () => {
    expect(mediaPermission(facts({ agreement: { ...signed, restricted: true }, studentAllowMedia: true })).reason).toBe('consent_withdrawn')
  })

  it('the student switch turned off is no, even with a clean form', () => {
    expect(mediaPermission(facts({ studentAllowMedia: false }))).toEqual({ status: 'no', reason: 'student_off' })
    expect(mediaPermission(facts({ isMinor: false, age: 20, agreement: { exists: false, restricted: false, optOut: false, optOutKnown: false }, studentAllowMedia: false })).reason).toBe('student_off')
  })

  it('NY/CO 13–17 are off by default and on once they opt in', () => {
    expect(mediaPermission(facts({ states: ['New York'] }))).toEqual({ status: 'no', reason: 'ny_co_default' })
    expect(mediaPermission(facts({ states: ['NE', 'CO'] })).reason).toBe('ny_co_default')
    expect(mediaPermission(facts({ states: ['CO'], studentAllowMedia: true }))).toEqual({ status: 'yes', reason: 'opted_in' })
  })

  it('the NY/CO default is 13–17 only, and covers a minor of unknown age', () => {
    expect(mediaPermission(facts({ states: ['CO'], age: 12 })).status).toBe('yes')
    expect(mediaPermission(facts({ states: ['CO'], age: 18, isMinor: false })).status).toBe('yes')
    expect(mediaPermission(facts({ states: ['CO'], age: null })).reason).toBe('ny_co_default')
  })

  it('a minor with no signed agreement is no; one whose form cannot be read is check', () => {
    expect(mediaPermission(facts({ agreement: { exists: false, restricted: false, optOut: false, optOutKnown: false } }))).toEqual({ status: 'no', reason: 'no_agreement' })
    expect(mediaPermission(facts({ agreement: { ...signed, optOutKnown: false } }))).toEqual({ status: 'check', reason: 'form_unread' })
  })

  it('a ticked box is honoured even when the rest of the form is unreadable', () => {
    expect(mediaPermission(facts({ agreement: { exists: true, restricted: false, optOut: true, optOutKnown: false } })).status).toBe('no')
  })

  it('adults need no minor agreement', () => {
    expect(mediaPermission(facts({ isMinor: false, age: 34, states: ['CO'], agreement: { exists: false, restricted: false, optOut: false, optOutKnown: false } }))).toEqual({ status: 'yes', reason: 'default' })
  })

  it('says who answered and on which form', () => {
    const minor = { isMinor: true, signedAt: '2026-10-02T15:04:00Z' }
    expect(mediaReasonDetail({ ...minor, decision: { status: 'no', reason: 'opted_out_on_agreement' } }))
      .toBe('Parent/guardian ticked “I do NOT consent” to photo and media use on the agreement signed Oct 2, 2026')
    expect(mediaReasonDetail({ ...minor, decision: { status: 'yes', reason: 'agreement_no_opt_out' } }))
      .toBe('Parent/guardian left “I do NOT consent” to photo and media use unticked on the agreement signed Oct 2, 2026')
    expect(mediaReasonDetail({ isMinor: false, signedAt: null, decision: { status: 'no', reason: 'opted_out_on_agreement' } }))
      .toBe('Ticked “I do NOT consent” to photo and media use on the signed agreement')
    expect(mediaReasonDetail({ ...minor, decision: { status: 'check', reason: 'form_unread' } }))
      .toBe('Photo and media answer not read from the agreement signed Oct 2, 2026 yet: open it under Consent forms')
  })

  it('reads state names and codes', () => {
    expect(isNyCo(['Colorado'])).toBe(true)
    expect(isNyCo(['ny'])).toBe(true)
    expect(isNyCo([null, 'Nebraska'])).toBe(false)
  })
})
