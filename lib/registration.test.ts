import { describe, it, expect } from 'vitest'
import { registrationIsOpen } from './registration'

describe('registrationIsOpen', () => {
  describe('campaigns', () => {
    // The regression this function exists for: campaigns carry no Open/Close
    // dates, so the old date-only gate returned 'open' for every one of them and
    // the CMS toggle gated nothing. A campaign switched off read Closed on every
    // screen while the API kept accepting registrations.
    it('is closed when the toggle is off, even with no dates set', () => {
      expect(registrationIsOpen({ activityType: 'campaign', registrationOpen: false })).toBe(false)
    })

    it('is closed when the toggle has never been set', () => {
      expect(registrationIsOpen({ activityType: 'campaign' })).toBe(false)
      expect(registrationIsOpen({ activityType: 'campaign', registrationOpen: null })).toBe(false)
    })

    it('is open only on an explicit true', () => {
      expect(registrationIsOpen({ activityType: 'campaign', registrationOpen: true })).toBe(true)
    })

    it('ignores live-event dates entirely', () => {
      // A campaign should never be opened by stray dates on the document.
      expect(
        registrationIsOpen({
          activityType: 'campaign',
          registrationOpen: false,
          registrationOpenDate: '2020-01-01',
          registrationCloseDate: '2099-01-01',
        })
      ).toBe(false)
    })
  })

  describe('live events', () => {
    it('is open when no dates are set', () => {
      expect(registrationIsOpen({ activityType: 'live_event' })).toBe(true)
    })

    it('ignores the campaign toggle', () => {
      // registrationOpen is hidden for live events in the CMS; honouring it here
      // once made every live event read Closed.
      expect(registrationIsOpen({ activityType: 'live_event', registrationOpen: false })).toBe(true)
    })

    it('is closed once the close date has passed', () => {
      expect(
        registrationIsOpen({ activityType: 'live_event', registrationCloseDate: '2020-01-01' })
      ).toBe(false)
    })

    it('is closed before the open date', () => {
      expect(
        registrationIsOpen({ activityType: 'live_event', registrationOpenDate: '2099-01-01' })
      ).toBe(false)
    })

    it('treats a document with no activity type as a live event', () => {
      // Pre-migration documents have no activityType.
      expect(registrationIsOpen({})).toBe(true)
    })
  })
})
