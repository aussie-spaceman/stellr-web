import type { SupabaseClient } from '@supabase/supabase-js'

// Runtime equivalent of the migration-062 backfill. Keeps the competition
// container model in sync as registrations happen — one event-level container
// per competition (campaign_ref = event_slug) and one group sub-container per
// registration, with a roster row per participant — so the member event portal,
// which resolves access through the roster (lib/event-portal.ts), sees new
// registrants immediately. Idempotent + non-fatal: registration must never fail
// because of this.

const EVENT_CONTAINER = 'event_participation'

/** Get-or-create the event-level container for a competition. */
async function getOrCreateEventContainer(
  db: SupabaseClient,
  eventSlug: string,
  eventTitle: string | null,
): Promise<string | null> {
  const find = () =>
    db
      .from('mentoring_cohorts')
      .select('id')
      .eq('container_type', EVENT_CONTAINER)
      .is('parent_container_id', null)
      .eq('campaign_ref', eventSlug)
      .maybeSingle()

  const { data: existing } = await find()
  if (existing) return existing.id as string

  const { data: created, error } = await db
    .from('mentoring_cohorts')
    .insert({ name: eventTitle || eventSlug, container_type: EVENT_CONTAINER, campaign_ref: eventSlug, lifecycle: 'active' })
    .select('id')
    .maybeSingle()
  if (error) {
    const { data: again } = await find() // lost a create race → re-read
    return (again?.id as string) ?? null
  }
  return (created?.id as string) ?? null
}

/** Get-or-create the per-registration group sub-container. */
async function getOrCreateGroupContainer(
  db: SupabaseClient,
  registrationId: string,
  eventSlug: string,
  eventTitle: string | null,
  label: string,
  parentId: string,
): Promise<string | null> {
  const find = () =>
    db.from('mentoring_cohorts').select('id').eq('registration_id', registrationId).maybeSingle()

  const { data: existing } = await find()
  if (existing) return existing.id as string

  const { data: created, error } = await db
    .from('mentoring_cohorts')
    .insert({
      name: `${eventTitle || eventSlug} — ${label || 'group'}`,
      container_type: EVENT_CONTAINER,
      campaign_ref: eventSlug,
      registration_id: registrationId,
      parent_container_id: parentId,
      lifecycle: 'active',
    })
    .select('id')
    .maybeSingle()
  if (error) {
    const { data: again } = await find()
    return (again?.id as string) ?? null
  }
  return (created?.id as string) ?? null
}

/**
 * Ensure `memberId` is on the roster of the group sub-container for
 * `registrationId`, creating the event + group containers on demand.
 */
export async function ensureRosterMembership(
  db: SupabaseClient,
  registrationId: string,
  memberId: string,
): Promise<void> {
  try {
    const { data: reg } = await db
      .from('registrations')
      .select('event_slug, event_title, school_name, teacher_email')
      .eq('id', registrationId)
      .maybeSingle()
    if (!reg?.event_slug) return
    const slug = reg.event_slug as string
    const title = (reg.event_title as string | null) ?? null

    const eventContainerId = await getOrCreateEventContainer(db, slug, title)
    if (!eventContainerId) return

    const label = (reg.school_name as string | null) || (reg.teacher_email as string | null) || 'group'
    const groupContainerId = await getOrCreateGroupContainer(db, registrationId, slug, title, label, eventContainerId)
    if (!groupContainerId) return

    await db.from('cohort_members').upsert(
      { cohort_id: groupContainerId, member_id: memberId, relationship: 'participant', status: 'active' },
      { onConflict: 'cohort_id,member_id', ignoreDuplicates: true },
    )
  } catch (e) {
    console.error('[container-sync] ensureRosterMembership failed (non-fatal):', e)
  }
}
