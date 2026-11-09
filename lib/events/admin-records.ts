// The queries behind the events admin routes that test/route-manifest.test.ts holds off
// a direct .from() (S5 C17), moved here as they were. Every caller has first placed the event
// or record in its scope: lib/authz requireEventRoute, then loadEventRecord. The ones the routes
// reach only in Stellr's scope (refuseOutsideStellr) touch shared `members` or Stellr's
// mentoring tables, and the routes say so. Those take a StellrOnlyDb, which only
// stellrOnlyDb hands out, so a route that stops refusing other tenants cannot reach them
// without the type check, or the call, stopping it.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EventEmailRow } from '@/lib/event-emails/types'
import { isStellrScope, type ScopeContext } from '@/lib/tenancy/scope-context'

declare const STELLR_ONLY: unique symbol
/** A client for queries that hold no tenant filter, handed out only in Stellr's scope. */
export type StellrOnlyDb = SupabaseClient & { readonly [STELLR_ONLY]: true }

/** The client, for the helpers below that read or write without a tenant filter. Throws outside Stellr's scope. */
export function stellrOnlyDb(scope: Pick<ScopeContext, 'tenantId'>, db: SupabaseClient): StellrOnlyDb {
  if (!isStellrScope(scope)) throw new Error('Unfiltered event records are Stellr-only')
  return db as StellrOnlyDb
}

/** A draft copied from another email of the event. Attachments stay with the original. */
export async function insertEventEmailCopy(db: SupabaseClient, slug: string, src: EventEmailRow, createdBy: string | null) {
  return db
    .from('event_emails')
    .insert({
      event_slug: slug,
      name: `${src.name} (copy)`,
      template_key: src.template_key,
      audiences: src.audiences,
      subject: src.subject,
      body_json: src.body_json,
      attachments: [],
      resend_docusign: src.resend_docusign,
      schedule_days_before: src.schedule_days_before,
      status: 'draft',
      created_by: createdBy,
    })
    .select('*')
    .single()
}

/** Any participant of a registration who has a member record: who a billing note is about. */
export async function firstLinkedMemberId(db: StellrOnlyDb, registrationId: string): Promise<string | null> {
  const { data } = await db
    .from('participants')
    .select('member_id')
    .eq('registration_id', registrationId)
    .not('member_id', 'is', null)
    .limit(1)
    .maybeSingle()
  return (data as { member_id?: string } | null)?.member_id ?? null
}

/** A title stored on the event's registrations, for an event Sanity has no document for. */
export async function eventTitleFromRegistrations(db: StellrOnlyDb, slug: string): Promise<string | null> {
  const { data } = await db
    .from('registrations')
    .select('event_title')
    .eq('event_slug', slug)
    .not('event_title', 'is', null)
    .limit(1)
    .maybeSingle()
  return (data?.event_title as string | undefined) ?? null
}

/** The participant's form that is out for signing, if any. */
export async function liveAgreementForParticipant(db: StellrOnlyDb, participantId: string, liveStatuses: readonly string[]) {
  const { data } = await db
    .from('agreements')
    .select('id, status')
    .eq('participant_id', participantId)
    .in('status', [...liveStatuses])
    .not('envelope_id', 'like', 'failed:%')
    .limit(1)
    .maybeSingle()
  return data
}

/** The event-level container that carries its volunteers. */
export async function eventContainerId(db: StellrOnlyDb, slug: string): Promise<string | null> {
  const { data } = await db
    .from('mentoring_cohorts')
    .select('id')
    .eq('container_type', 'event_participation')
    .is('parent_container_id', null)
    .eq('campaign_ref', slug)
    .maybeSingle()
  return (data?.id as string) ?? null
}

const VOLUNTEER_MEMBER = 'members(id, first_name, last_name, email, date_of_birth)'

/** Who has raised interest in this event, and who is assigned to its container. */
export async function loadEventVolunteers(db: StellrOnlyDb, slug: string, containerId: string | null) {
  const [{ data: interestRows }, { data: assignedRows }] = await Promise.all([
    db
      .from('volunteer_event_interest')
      .select(`member_id, created_at, ${VOLUNTEER_MEMBER}`)
      .eq('event_slug', slug)
      .eq('status', 'interested')
      .order('created_at', { ascending: true }),
    containerId
      ? db
          .from('cohort_members')
          .select(`member_id, added_at, ${VOLUNTEER_MEMBER}`)
          .eq('cohort_id', containerId)
          .eq('relationship', 'volunteer')
          .eq('status', 'active')
          .order('added_at', { ascending: true })
      : Promise.resolve({ data: [] as never[] }),
  ])
  return { interestRows, assignedRows }
}

/**
 * The assignment, and a history row for the member's Volunteering list. A member with a
 * participation row for this event already (they attended as a competitor, say) keeps it
 * as it is: the roster row still carries the assignment.
 */
export async function assignEventVolunteer(
  db: StellrOnlyDb,
  a: { containerId: string; memberId: string; slug: string; title: string | null },
): Promise<{ error: unknown }> {
  const { error } = await db.from('cohort_members').upsert(
    { cohort_id: a.containerId, member_id: a.memberId, relationship: 'volunteer', status: 'active' },
    { onConflict: 'cohort_id,member_id', ignoreDuplicates: true },
  )
  if (error) return { error }
  const { data: existing } = await db
    .from('event_participations')
    .select('id')
    .eq('member_id', a.memberId)
    .eq('event_slug', a.slug)
    .maybeSingle()
  if (!existing) {
    await db.from('event_participations').insert({
      member_id: a.memberId,
      event_slug: a.slug,
      event_title: a.title,
      event_year: new Date().getFullYear(),
      status: 'approved',
      role: 'volunteer',
    })
  }
  return { error: null }
}

/** Take the assignment away, and only the history row an assignment made: never a competitor's. */
export async function removeEventVolunteer(db: StellrOnlyDb, r: { containerId: string | null; memberId: string; slug: string }): Promise<void> {
  if (r.containerId) {
    await db
      .from('cohort_members')
      .delete()
      .eq('cohort_id', r.containerId)
      .eq('member_id', r.memberId)
      .eq('relationship', 'volunteer')
  }
  await db
    .from('event_participations')
    .delete()
    .eq('member_id', r.memberId)
    .eq('event_slug', r.slug)
    .eq('role', 'volunteer')
}
