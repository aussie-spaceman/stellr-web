import type { SupabaseClient } from '@supabase/supabase-js'

// Runtime equivalent of the migration-062 backfill. Keeps the competition
// container model in sync as registrations happen — one event-level container
// per competition (campaign_ref = event_slug) and one group sub-container per
// registration, with a roster row per participant — so the member event portal,
// which resolves access through the roster (lib/event-portal.ts), sees new
// registrants immediately. Idempotent + non-fatal: registration must never fail
// because of this.

const EVENT_CONTAINER = 'event_participation'

/** Get-or-create the event-level container for a competition. Exported so the
 *  admin direct-grant route can attach a member to the event roster (P3). */
export async function ensureEventContainer(
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
 * Get-or-create the coaching workshop container for a (coachee, coach) pair —
 * mentoring_cohorts(container_type='coaching', mentor_member_id=coach) with the
 * coachee on the roster. Mirrors migration 064; called when a coaching session is
 * booked and by the admin direct-grant. Returns the container id. Non-fatal.
 */
export async function ensureCoachingContainer(
  db: SupabaseClient,
  coacheeId: string,
  coachId: string,
): Promise<string | null> {
  try {
    const find = () =>
      db
        .from('cohort_members')
        .select('cohort_id, mentoring_cohorts!inner(container_type, mentor_member_id)')
        .eq('member_id', coacheeId)
        .eq('mentoring_cohorts.container_type', 'coaching')
        .eq('mentoring_cohorts.mentor_member_id', coachId)
        .maybeSingle()

    const { data: existing } = await find()
    if (existing) return existing.cohort_id as string

    const { data: m } = await db
      .from('members')
      .select('first_name, last_name')
      .eq('id', coacheeId)
      .maybeSingle()
    const nm = [m?.first_name, m?.last_name].filter(Boolean).join(' ') || 'coachee'

    const { data: created, error } = await db
      .from('mentoring_cohorts')
      .insert({ name: `Coaching — ${nm}`, container_type: 'coaching', mentor_member_id: coachId, lifecycle: 'active' })
      .select('id')
      .maybeSingle()
    if (error || !created) {
      const { data: again } = await find()
      return (again?.cohort_id as string) ?? null
    }

    await db.from('cohort_members').upsert(
      { cohort_id: created.id, member_id: coacheeId, relationship: 'participant', status: 'active' },
      { onConflict: 'cohort_id,member_id', ignoreDuplicates: true },
    )
    return created.id as string
  } catch (e) {
    console.error('[container-sync] ensureCoachingContainer failed (non-fatal):', e)
    return null
  }
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

    const eventContainerId = await ensureEventContainer(db, slug, title)
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
