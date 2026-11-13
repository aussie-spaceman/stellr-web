import { signCheckInCode } from '../../lib/check-in-codes'
import { HARNESS_BUILD_ENV } from './harness-env.mjs'
import { type RecordOwner, eventTitle } from './harness-records'

/**
 * The URLs in the tenant-host allow-list that name a record, for check (c), S5 B10.
 * harness.test.ts holds this table to allowedTenantFiles(), so a new page that takes an
 * id joins it or fails.
 *
 * `ownHost` is what a record's own host answers:
 *   - `shows`: 200 with this text. That is the positive control: a 404 for the foreign
 *     record then means the record check said no, not that the page can't answer.
 *   - `noCms`: 404 here too, because the page needs an event from the CMS and the harness
 *     has none. So on these pages this check proves only that nothing leaks. Which tenant
 *     a record belongs to is held by test/tenant-tree-page-records.test.ts.
 *   - `noPage`: the tree has no such page yet, so every tenant host answers 404.
 *
 * `onStellrHost` is the answer on Stellr's hosts today, with the slice that owns the row.
 * docs/TENANCY-S5.md's gate row says what each must become. A green run says only that
 * the answers still match this table, not that the gate is met.
 *   - `answers`: 200 with this text.
 *   - `sameAsUnknown`: the same answer as for a record nobody has.
 *   - `noCms`: 404, because the harness has no CMS, so this says nothing about a real
 *     deployment. The owning slice's two-tenant test has to prove it.
 */

export type StellrHostOutcome =
  | { kind: 'answers'; owner: string; text: (o: RecordOwner) => string }
  | { kind: 'sameAsUnknown'; owner: string }
  | { kind: 'noCms'; owner: string }

export interface RecordPageCase {
  /** The manifest file this URL serves. */
  file: string
  /** The URL for an owner's record. */
  path: (o: RecordOwner, code: (o: RecordOwner) => string) => string
  /** The same URL for a record nobody has. */
  missing: string
  ownHost: { kind: 'shows'; text: (o: RecordOwner) => string } | { kind: 'noCms' } | { kind: 'noPage' }
  onStellrHost: StellrHostOutcome
}

const MISSING_TOKEN = 'harnessnobody'.padEnd(43, 'x')
const MISSING_SLUG = 'harness-event-nobody'
export const MISSING_CREDENTIAL = 'STL-2026-NOBODY00'

export const RECORD_PAGES: RecordPageCase[] = [
  {
    file: 'app/(stellr)/(flow)/register/[slug]/page.tsx',
    path: (o) => `/register/${o.eventSlug}`,
    missing: `/register/${MISSING_SLUG}`,
    ownHost: { kind: 'noCms' },
    onStellrHost: { kind: 'noCms', owner: 'A7' },
  },
  {
    file: 'app/(stellr)/(flow)/register/[slug]/individual/page.tsx',
    path: (o) => `/register/${o.eventSlug}/individual`,
    missing: `/register/${MISSING_SLUG}/individual`,
    ownHost: { kind: 'noCms' },
    onStellrHost: { kind: 'noCms', owner: 'A7' },
  },
  {
    file: 'app/(stellr)/(flow)/register/[slug]/group/page.tsx',
    path: (o) => `/register/${o.eventSlug}/group`,
    missing: `/register/${MISSING_SLUG}/group`,
    ownHost: { kind: 'noCms' },
    onStellrHost: { kind: 'noCms', owner: 'A7' },
  },
  {
    file: 'app/(stellr)/(flow)/register/[slug]/confirmation/page.tsx',
    path: (o) => `/register/${o.eventSlug}/confirmation`,
    missing: `/register/${MISSING_SLUG}/confirmation`,
    ownHost: { kind: 'shows', text: () => 'Registration Submitted!' },
    onStellrHost: { kind: 'sameAsUnknown', owner: 'A7' },
  },
  {
    file: 'app/(stellr)/(flow)/register/[slug]/join/[token]/page.tsx',
    path: (o) => `/register/${o.eventSlug}/join/${o.joinToken}`,
    missing: `/register/${MISSING_SLUG}/join/harness-join-nobody`,
    ownHost: { kind: 'shows', text: () => 'Link Expired' },
    onStellrHost: { kind: 'sameAsUnknown', owner: 'A7' },
  },
  {
    file: 'app/(stellr)/(flow)/register/[slug]/pay/[token]/page.tsx',
    path: (o) => `/register/${o.eventSlug}/pay/${o.payToken}`,
    missing: `/register/${MISSING_SLUG}/pay/harness-pay-nobody`,
    ownHost: { kind: 'shows', text: eventTitle },
    onStellrHost: { kind: 'sameAsUnknown', owner: 'A7' },
  },
  {
    file: 'app/(stellr)/(flow)/register/[slug]/pay-seat/[token]/page.tsx',
    path: (o) => `/register/${o.eventSlug}/pay-seat/${o.seatToken}`,
    missing: `/register/${MISSING_SLUG}/pay-seat/harness-seat-nobody`,
    ownHost: { kind: 'shows', text: () => 'all set' },
    onStellrHost: { kind: 'sameAsUnknown', owner: 'A7' },
  },
  {
    file: 'app/(stellr)/(flow)/check-in/[slug]/page.tsx',
    path: (o) => `/check-in/${o.eventSlug}`,
    missing: `/check-in/${MISSING_SLUG}`,
    ownHost: { kind: 'noCms' },
    onStellrHost: { kind: 'noCms', owner: 'A12' },
  },
  {
    file: 'app/(stellr)/(flow)/check-in/[slug]/code/page.tsx',
    path: (o, code) => `/check-in/${o.eventSlug}/code?c=${code(o)}`,
    missing: `/check-in/${MISSING_SLUG}/code?c=p.00000000-0000-4000-8000-000000000000.nope`,
    ownHost: { kind: 'shows', text: (o) => `${o.marker}-person` },
    onStellrHost: { kind: 'answers', owner: 'A12', text: (o) => `${o.marker}-person` },
  },
  {
    file: 'app/(stellr)/(flow)/survey/[token]/page.tsx',
    path: (o) => `/survey/${o.surveyToken}`,
    missing: `/survey/${MISSING_TOKEN}`,
    ownHost: { kind: 'shows', text: eventTitle },
    // Stellr's page answers another tenant's link as unknown straight after the invitation
    // is read (A10b); survey-body.test.ts runs it with an open survey.
    onStellrHost: { kind: 'sameAsUnknown', owner: 'A10' },
  },
  {
    file: 'app/(stellr)/(flow)/survey/[token]/stop-reminders/page.tsx',
    path: (o) => `/survey/${o.surveyToken}/stop-reminders`,
    missing: `/survey/${MISSING_TOKEN}/stop-reminders`,
    ownHost: { kind: 'shows', text: () => 'Stop survey reminders' },
    // The page reads nothing and shows the same button for any link; the stop it posts
    // refuses another host's link (A10b).
    onStellrHost: { kind: 'sameAsUnknown', owner: 'A10' },
  },
  {
    file: 'app/(stellr)/(flow)/survey/event/[slug]/page.tsx',
    path: (o) => `/survey/event/${o.eventSlug}`,
    missing: `/survey/event/${MISSING_SLUG}`,
    ownHost: { kind: 'shows', text: eventTitle },
    // Stellr's page answers another tenant's event as one with no survey (A10b).
    onStellrHost: { kind: 'sameAsUnknown', owner: 'A10' },
  },
  {
    file: 'app/(stellr)/(flow)/team-profile/[token]/page.tsx',
    path: (o) => `/team-profile/${o.profileToken}`,
    missing: `/team-profile/${MISSING_TOKEN}`,
    // Past the record check the page needs the event from the CMS, so it says invalid.
    ownHost: { kind: 'shows', text: () => 'link isn’t valid' },
    // Stellr's page answers another tenant's link as unknown straight after the row is
    // read, before the CMS is asked (A10a); team-profile-body.test.ts runs it with a
    // loadable event.
    onStellrHost: { kind: 'sameAsUnknown', owner: 'A10' },
  },
  {
    file: 'app/(stellr)/(public)/credentials/[number]/page.tsx',
    path: (o) => `/credentials/${o.credentialNumber}`,
    missing: `/credentials/${MISSING_CREDENTIAL}`,
    ownHost: { kind: 'noPage' },
    // Stellr's credentials only (A10a, decision W7-10).
    onStellrHost: { kind: 'sameAsUnknown', owner: 'A10' },
  },
  // The harness's row is withdrawn, which is the generic image for any number, so for these
  // two "the same" says the row was read and nothing more. Past a public, live row is A10's.
  {
    file: 'app/(stellr)/(public)/credentials/[number]/badge/route.tsx',
    path: (o) => `/credentials/${o.credentialNumber}/badge`,
    missing: `/credentials/${MISSING_CREDENTIAL}/badge`,
    ownHost: { kind: 'noPage' },
    onStellrHost: { kind: 'sameAsUnknown', owner: 'A10' },
  },
  {
    file: 'app/(stellr)/(public)/credentials/[number]/opengraph-image.tsx',
    // Next adds a suffix from the file's route, so a moved file fails "the rows are read".
    path: (o) => `/credentials/${o.credentialNumber}/opengraph-image-bboc2v`,
    missing: `/credentials/${MISSING_CREDENTIAL}/opengraph-image-bboc2v`,
    ownHost: { kind: 'noPage' },
    onStellrHost: { kind: 'sameAsUnknown', owner: 'A10' },
  },
]

/** A real signed code for the owner's person at the owner's event. */
export function harnessCheckInCode(o: RecordOwner): string {
  process.env.CREDENTIAL_LINK_SECRET = HARNESS_BUILD_ENV.CREDENTIAL_LINK_SECRET
  return signCheckInCode(o.eventSlug, 'p', o.participantId) as string
}

/** Every URL that renders a real body on the owner's own host, so a new page joins by itself. */
export function ownRecordUrls(o: RecordOwner): string[] {
  return RECORD_PAGES.filter((page) => page.ownHost.kind === 'shows').map((page) => page.path(o, harnessCheckInCode))
}

/** How many Stellr-host rows are not yet `sameAsUnknown`, for the job's log. Totals only. */
export function stellrHostTally(): string {
  const open = RECORD_PAGES.map((page) => page.onStellrHost).filter((outcome) => outcome.kind !== 'sameAsUnknown')
  const count = (pick: (outcome: StellrHostOutcome) => string) => {
    const totals = new Map<string, number>()
    for (const outcome of open) totals.set(pick(outcome), (totals.get(pick(outcome)) ?? 0) + 1)
    return [...totals].sort().map(([name, total]) => `${name} ${total}`).join(', ')
  }
  return `Stellr-host rows still with their owning slice: ${open.length} of ${RECORD_PAGES.length} (${count((o) => o.kind)}; ${count((o) => o.owner)}). B10(c) is not met until this is 0 or each is approved by route.`
}
