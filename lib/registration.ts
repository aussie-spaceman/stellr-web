import { registrationStatus } from './utils'

/**
 * The single answer to "can someone register for this right now?"
 *
 * Live events and campaigns answer it from different data, and before this the
 * three registration routes only ever asked the live-event question. Campaigns
 * carry no Open/Close dates, so `registrationStatus(undefined, undefined)`
 * returned 'open' for every one of them and the CMS toggle — described as a
 * "manual on/off switch for campaign registration" — gated nothing at all. A
 * campaign switched off read Closed on every screen while the API kept taking
 * registrations.
 *
 * Display code must agree with this: see `campaignStatus()` in lib/campaigns.ts.
 */
export interface RegistrationGateSource {
  activityType?: string | null
  registrationOpen?: boolean | null
  registrationOpenDate?: string
  registrationCloseDate?: string
}

export function registrationIsOpen(event: RegistrationGateSource): boolean {
  // Campaigns: the manual toggle is the whole answer. Anything other than an
  // explicit `true` is closed, so a campaign nobody switched on is not open.
  if (event.activityType === 'campaign') return event.registrationOpen === true
  // Live events: derived from the window, where "no dates set" means open.
  return registrationStatus(event.registrationOpenDate, event.registrationCloseDate) === 'open'
}
