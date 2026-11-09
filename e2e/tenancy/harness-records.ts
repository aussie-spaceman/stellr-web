import { createHash } from 'node:crypto'
import { STELLR_TENANT_ID } from '../../lib/tenancy/constants'
import { CANARY_TENANT } from '../../lib/testing/honeytokens'

/**
 * The tenants and records the tenant-host harness serves (S5, B10). The two-tenant seed
 * has one non-owner tenant, and checks (b) and (c) need two: Stellr is never rewritten
 * into the tenant tree, so alternating with a Stellr host would pass with no check at all.
 *
 * host-map-stub.ts serves these rows only to a request that names a row's own key, so a
 * page that lists a table still reads no rows, and check (a) is not moved by them. Nothing
 * here is real or personal. Each owner's private values carry its marker, so a response
 * that holds another owner's record shows it.
 */

/** A non-owner tenant the seed does not have, only in this harness. */
export const SECOND_TENANT = {
  id: '00000000-0000-4000-8000-0000000cb0b2',
  slug: 'canary-b',
  host: 'canary-b.localhost',
} as const

export interface RecordOwner {
  name: 'a' | 'b' | 'stellr'
  tenantId: string
  /** The host that serves this owner's records. */
  host: string
  /** Its tenant slug, the one a rewrite into the tree would carry. */
  tenantSlug: string
  /** In every private value of this owner's records. */
  marker: string
  eventSlug: string
  surveyToken: string
  profileToken: string
  joinToken: string
  payToken: string
  seatToken: string
  participantId: string
  /** In the format the credential pages accept: lib/credentials-core.ts. */
  credentialNumber: string
}

/** 43 characters, as a real token is: lib/survey/tokens.ts, looksLikeToken. */
const token = (prefix: string) => prefix.padEnd(43, 'x')

function owner(name: RecordOwner['name'], tenantId: string, host: string, tenantSlug: string, participantId: string): RecordOwner {
  const up = name.toUpperCase()
  return {
    name,
    tenantId,
    host,
    tenantSlug,
    marker: `HARNESS-PRIVATE-${up}`,
    eventSlug: `harness-event-${name}`,
    surveyToken: token(`harness${up}survey`),
    profileToken: token(`harness${up}profile`),
    joinToken: `harness-join-${name}`,
    payToken: `harness-pay-${name}`,
    seatToken: `harness-seat-${name}`,
    participantId,
    credentialNumber: `STL-2026-HARNESS${up[0]}`,
  }
}

export const OWNER_A = owner('a', CANARY_TENANT.id, CANARY_TENANT.host, CANARY_TENANT.slug, '00000000-0000-4000-8000-0000000d0a01')
export const OWNER_B = owner('b', SECOND_TENANT.id, SECOND_TENANT.host, SECOND_TENANT.slug, '00000000-0000-4000-8000-0000000d0b01')
export const OWNER_STELLR = owner('stellr', STELLR_TENANT_ID, 'stellr.localhost', 'stellr', '00000000-0000-4000-8000-0000000d0501')

export const OWNERS: readonly RecordOwner[] = [OWNER_A, OWNER_B, OWNER_STELLR]

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/** The closed survey's title is on the page, so the record's owner can be read from it. */
export const eventTitle = (o: RecordOwner) => `${o.marker} event`
export const personName = (o: RecordOwner) => `${o.marker}-person`
/** Withdrawn, so the page says who issued it and reads nothing else. */
export const credentialIssuer = (o: RecordOwner) => `${o.marker} issuer`

const DEFINITION_ID = '00000000-0000-4000-8000-0000000de001'

type Row = Record<string, unknown>

function rowsFor(o: RecordOwner): Record<string, Row[]> {
  const distributionId = `${o.participantId.slice(0, -2)}d1`
  const registrationId = `${o.participantId.slice(0, -2)}e1`
  return {
    events: [{ slug: o.eventSlug, tenant_id: o.tenantId }],
    survey_invitations: [
      { id: `${o.participantId.slice(0, -2)}c1`, token_hash: sha256(o.surveyToken), distribution_id: distributionId, status: 'sent', member_id: null, participant_id: null },
    ],
    // Long closed, so the page says so with the title and needs no form.
    survey_distributions: [
      {
        id: distributionId,
        tenant_id: o.tenantId,
        definition_id: DEFINITION_ID,
        event_slug: o.eventSlug,
        event_title: eventTitle(o),
        status: 'closed',
        opens_at: '2020-01-01T00:00:00.000Z',
        closes_at: '2020-02-01T00:00:00.000Z',
      },
    ],
    team_profiles: [{ id: `${o.participantId.slice(0, -2)}f1`, token_hash: sha256(o.profileToken), tenant_id: o.tenantId, participant_id: o.participantId, event_slug: o.eventSlug }],
    // Expired, so the page needs no CMS to answer.
    group_join_tokens: [{ token: o.joinToken, event_slug: o.eventSlug, tenant_id: o.tenantId, registration_id: registrationId, expires_at: '2020-02-01T00:00:00.000Z' }],
    // Withdrawn, so the pay page says so with the title and needs no CMS or Stripe.
    registrations: [{ id: registrationId, pay_token: o.payToken, event_slug: o.eventSlug, event_title: eventTitle(o), tenant_id: o.tenantId, status: 'withdrawn', type: 'individual' }],
    participants: [
      { id: o.participantId, pay_token: o.seatToken, registration_id: registrationId, first_name: personName(o), last_name: 'Fixture', individual_payment_status: 'waived', registrations: { event_slug: o.eventSlug, status: 'confirmed' } },
    ],
    credentials: [
      {
        id: `${o.participantId.slice(0, -2)}a1`,
        number: o.credentialNumber,
        tenant_id: o.tenantId,
        issuer: credentialIssuer(o),
        title: 'Harness credential',
        recipient_name: '',
        visibility: 'private',
        status: 'active',
        issued_at: '2020-01-01T00:00:00.000Z',
        expires_at: null,
        tombstoned_at: '2020-02-01T00:00:00.000Z',
        theme: null,
        member_id: null,
        participant_id: null,
      },
    ],
  }
}

const DEFINITION_ROW: Row = {
  id: DEFINITION_ID,
  key: 'harness-survey',
  version: 1,
  title: 'Harness survey',
  status: 'published',
  definition: {
    key: 'harness-survey',
    version: 1,
    title: 'Harness survey',
    intro: { heading: 'Harness', body_student: 'Harness', body_adult: 'Harness' },
    branches: { student: [], mentor: [], adult: [] },
  },
}

/** The columns a request has to name for a table's rows to be served. */
const KEY_COLUMNS: Record<string, readonly string[]> = {
  events: ['slug'],
  survey_invitations: ['token_hash'],
  survey_distributions: ['id', 'event_slug'],
  survey_definitions: ['id'],
  team_profiles: ['token_hash'],
  group_join_tokens: ['token'],
  registrations: ['id', 'pay_token'],
  participants: ['id', 'pay_token'],
  credentials: ['number'],
}

const ALL_ROWS: Record<string, Row[]> = { survey_definitions: [DEFINITION_ROW] }
for (const o of OWNERS) {
  for (const [table, rows] of Object.entries(rowsFor(o))) (ALL_ROWS[table] ??= []).push(...rows)
}

/**
 * The rows a PostgREST read gets. None unless it filters a key column with `eq.`, and then
 * only rows matching each `eq.` filter on a column the row has. An embedded table's filter
 * (`registrations.event_slug`) and any other operator are ignored: the pages under test
 * narrow by key, and a real record check is what these rows exist to reach.
 */
export function matchRecords(table: string, params: URLSearchParams): Row[] {
  const filters = [...params.entries()].filter(([, value]) => value.startsWith('eq.')).map(([column, value]) => [column, value.slice(3)] as const)
  const keys = KEY_COLUMNS[table]
  if (!keys || !filters.some(([column]) => keys.includes(column))) return []
  return (ALL_ROWS[table] ?? []).filter((row) => filters.every(([column, value]) => !(column in row) || String(row[column]) === value))
}

export function isRecordTable(table: string): boolean {
  return table in KEY_COLUMNS
}
