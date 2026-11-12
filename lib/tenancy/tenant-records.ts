// The tenant tree's record checks (S5, slice B5b). A page in app/%5Ft reuses a Stellr
// flow page, and that page reads its record by slug or token alone. So the tenant page
// first passes the tenant from its URL param to one of these loaders, which answer 404
// unless the record is that tenant's.
//
// The answer is the same for another tenant's record, for no record, for a malformed
// token and for a failed read, so a tenant host can't be used to tell whether a slug
// or token exists elsewhere. That is stricter than Stellr's pages, which show "this
// link isn't valid". NULL tenant_id means a Stellr row the backfill hasn't reached, so
// it is never a match here: Stellr is never served from this tree (tenantFromParams).
//
// test/tenant-tree-pages.test.ts fails a tenant page that doesn't call one of these.
// Stellr's pages use only googleSheetParam from this file, through the shared
// confirmation body.

import { notFound } from 'next/navigation'
import { loadOpenCheckInsForTenant, type OpenCheckIn } from '@/lib/check-in-banner'
import { supabaseServer } from '@/lib/supabase'
import { hashToken, looksLikeToken } from '@/lib/survey/tokens'
import type { TenantHostEntry } from './host'
import type { ProfileSession } from '@/lib/team-profile/store'

interface ReadResult {
  data: unknown
  error: { message: string } | null
}

interface Owned {
  tenant_id: string | null
}

/** The row, or 404 on a miss or a failed read. */
function rowOr404<T>(where: string, { data, error }: ReadResult): T {
  if (error) console.error(`[tenant-records] ${where} read failed: ${error.message}`)
  if (error || !data) notFound()
  return data as T
}

function assertOwned(tenant: TenantHostEntry, row: Owned): void {
  if (row.tenant_id !== tenant.tenantId) notFound()
}

/** A page keyed on an event slug. Reads the mirror: an unmirrored event has no proven owner. */
export async function requireTenantEvent(tenant: TenantHostEntry, slug: string): Promise<void> {
  const res = await supabaseServer().from('events').select('tenant_id').eq('slug', slug).maybeSingle()
  assertOwned(tenant, rowOr404<Owned>('event', res))
}

/** An emailed survey link. The invitation's owner is its distribution's. */
export async function requireTenantSurveyInvitation(tenant: TenantHostEntry, token: string): Promise<void> {
  if (!looksLikeToken(token)) notFound()
  const db = supabaseServer()
  const invitation = rowOr404<{ distribution_id: string }>(
    'survey invitation',
    await db.from('survey_invitations').select('distribution_id').eq('token_hash', hashToken(token)).maybeSingle(),
  )
  const distribution = rowOr404<Owned>(
    'survey distribution',
    await db.from('survey_distributions').select('tenant_id').eq('id', invitation.distribution_id).maybeSingle(),
  )
  assertOwned(tenant, distribution)
}

/** An emailed team profile link. */
export async function requireTenantTeamProfile(tenant: TenantHostEntry, token: string): Promise<void> {
  if (!looksLikeToken(token)) notFound()
  const res = await supabaseServer().from('team_profiles').select('tenant_id').eq('token_hash', hashToken(token)).maybeSingle()
  assertOwned(tenant, rowOr404<Owned>('team profile', res))
}

/**
 * The session behind this tenant's team profile link, for the shared page body (S5
 * A10a). Stellr's page shows Stellr's links only, so the tenant page reads its own,
 * with the same check as above: a link of any other tenant, or a NULL (Stellr) row,
 * answers as one nobody holds. Call it after requireTenantTeamProfile.
 */
export async function tenantTeamProfileSession(tenant: TenantHostEntry, token: string): Promise<ProfileSession | null> {
  const { sessionByToken } = await import('@/lib/team-profile/store')
  return sessionByToken(supabaseServer(), token, { onHost: async (row) => row.tenant_id === tenant.tenantId })
}

/** A group's join link: the token, and the registration it opens, for this slug. */
export async function requireTenantJoinLink(tenant: TenantHostEntry, slug: string, token: string): Promise<void> {
  const db = supabaseServer()
  const link = rowOr404<Owned & { registration_id: string }>(
    'join link',
    await db.from('group_join_tokens').select('tenant_id, registration_id').eq('token', token).eq('event_slug', slug).maybeSingle(),
  )
  assertOwned(tenant, link)
  const registration = rowOr404<Owned>('registration', await db.from('registrations').select('tenant_id').eq('id', link.registration_id).maybeSingle())
  assertOwned(tenant, registration)
}

/** A registration's pay link, for this slug. */
export async function requireTenantRegistrationPayLink(tenant: TenantHostEntry, slug: string, token: string): Promise<void> {
  const res = await supabaseServer().from('registrations').select('tenant_id').eq('pay_token', token).eq('event_slug', slug).maybeSingle()
  assertOwned(tenant, rowOr404<Owned>('pay link', res))
}

/**
 * A seat's pay link. The reused page finds the seat by token alone and the price by the
 * URL's slug, so the seat's registration must be this tenant's and for this slug.
 */
export async function requireTenantSeatPayLink(tenant: TenantHostEntry, slug: string, token: string): Promise<void> {
  const db = supabaseServer()
  const seat = rowOr404<{ registration_id: string }>('seat', await db.from('participants').select('registration_id').eq('pay_token', token).maybeSingle())
  const registration = rowOr404<Owned & { event_slug: string }>(
    'registration',
    await db.from('registrations').select('tenant_id, event_slug').eq('id', seat.registration_id).maybeSingle(),
  )
  assertOwned(tenant, registration)
  if (registration.event_slug !== slug) notFound()
}

/** The tenant's own open check-ins, for its banner address. A failed read answers 404 too. */
export async function tenantOpenCheckIns(tenant: TenantHostEntry): Promise<OpenCheckIn[]> {
  try {
    return await loadOpenCheckInsForTenant(supabaseServer(), tenant.tenantId)
  } catch (err) {
    console.error(`[tenant-records] open check-ins read failed: ${(err as Error).message}`)
    notFound()
  }
}

/**
 * The confirmation page's `spreadsheet` value, passed on only if it decodes to a Google
 * Sheets link, which is all the group route ever sends (lib/google-sheets). The page
 * makes it a button, on the organiser's own host, so anything else is dropped.
 */
export function googleSheetParam(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  try {
    const url = new URL(decodeURIComponent(raw))
    return url.protocol === 'https:' && url.hostname === 'docs.google.com' && url.pathname.startsWith('/spreadsheets/') ? raw : undefined
  } catch {
    return undefined
  }
}
