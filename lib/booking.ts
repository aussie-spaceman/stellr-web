// ── The 15-minute intro call ─────────────────────────────────────────────────
// The secondary action on /events, /membership, /contact, /educators and
// /network: a Motion booking page. An env var, because the link lives in
// someone else's product and changes without a deploy being welcome. Until the
// 15-minute page has its own variable it falls back to the landing pages'
// booking link.
//
// Bookings are matched back to HubSpot by the motion-bookings cron, which
// reads Google Calendar for events whose title contains MOTION_BOOKING_TITLE
// ("Stellr" by default) — so the Motion page's event title must contain it.

export const INTRO_CALL_URL =
  process.env.NEXT_PUBLIC_INTRO_CALL_URL ||
  process.env.NEXT_PUBLIC_BOOKING_URL ||
  'https://app.usemotion.com/meet/david-m-shaw/welcome'

/** Where a booking button sits, for the `booking_click` dataLayer event. */
export type BookingLocation =
  | 'events_hero'
  | 'events_board'
  | 'membership_explorer'
  | 'contact_sidebar'
  | 'educators_hero'
  | 'educators_cta'
  | 'network_hero'
