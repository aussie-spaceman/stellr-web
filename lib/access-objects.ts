import { supabaseServer } from '@/lib/supabase'

// Object resolution for the unified admin/access console. Every "object" in the
// converged model (Space, Course, Workshop, Cohort, Event, Campaign, Resource)
// already has a storage home; this module maps a polymorphic ref (container
// uuid, space uuid, module uuid, resource uuid, or event/campaign slug) onto
// one canonical shape so /api/admin/access/objects/[id]/* can dispatch by type.

export type AccessObjectType =
  | 'space' | 'course' | 'workshop' | 'cohort' | 'event' | 'campaign' | 'resource'

export interface AccessObject {
  objectType: AccessObjectType
  /** Container/space/module/resource uuid, or the event/campaign slug. */
  ref: string
  label: string
  archived: boolean
  /** Set when the object is backed by a mentoring_cohorts container row. */
  containerId?: string
  /** Event/campaign slug when the object is (or shadows) a competition. */
  slug?: string
}

/** mentoring_cohorts.container_type → design object type. */
export const CONTAINER_TYPE_TO_OBJECT: Record<string, AccessObjectType> = {
  mentoring: 'cohort',
  coaching: 'workshop',
  training: 'course',
  space: 'space',
  event_participation: 'event',
  campaign_participation: 'campaign',
}

/** design object type → community_space_sources.object_type (migration 123). */
export const OBJECT_TO_SPACE_SOURCE_TYPE: Record<string, string> = {
  event: 'event',
  campaign: 'event',
  course: 'training',
  cohort: 'mentoring',
  workshop: 'coaching',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Resolve an access-object ref. Uuids are looked up across containers, spaces,
 * training modules and resources (in that order); anything else is treated as
 * an event/campaign slug. Returns null only for unknown uuids.
 */
export async function resolveAccessObject(ref: string): Promise<AccessObject | null> {
  const db = supabaseServer()

  if (!UUID_RE.test(ref)) {
    // Slug-keyed: an Event (or Campaign — same storage, Sanity's activityType
    // distinguishes them; access treats both identically).
    return { objectType: 'event', ref, label: ref, archived: false, slug: ref }
  }

  const { data: container } = await db
    .from('mentoring_cohorts')
    .select('id, name, container_type, campaign_ref, lifecycle')
    .eq('id', ref)
    .maybeSingle()
  if (container) {
    return {
      objectType: CONTAINER_TYPE_TO_OBJECT[container.container_type as string] ?? 'cohort',
      ref,
      label: container.name as string,
      archived: container.lifecycle === 'archived',
      containerId: container.id as string,
      slug: (container.campaign_ref as string | null) ?? undefined,
    }
  }

  const { data: space } = await db
    .from('community_spaces')
    .select('id, name, is_archived')
    .eq('id', ref)
    .maybeSingle()
  if (space) {
    return { objectType: 'space', ref, label: space.name as string, archived: !!space.is_archived }
  }

  const { data: module } = await db
    .from('training_modules')
    .select('id, title')
    .eq('id', ref)
    .maybeSingle()
  if (module) {
    return { objectType: 'course', ref, label: module.title as string, archived: false }
  }

  const { data: resource } = await db
    .from('community_resources')
    .select('id, title')
    .eq('id', ref)
    .maybeSingle()
  if (resource) {
    return { objectType: 'resource', ref, label: (resource.title as string | null) ?? ref, archived: false }
  }

  return null
}

/**
 * The relationship-matrix gate (object_type_relations, migration 125). Every
 * attach endpoint calls this before writing. Missing rows deny (closed by
 * default), matching the seeded 7×7 contract.
 */
export async function attachAllowed(
  fromType: AccessObjectType,
  toType: AccessObjectType,
): Promise<boolean> {
  const db = supabaseServer()
  const { data } = await db
    .from('object_type_relations')
    .select('allowed')
    .eq('from_type', fromType)
    .eq('to_type', toType)
    .maybeSingle()
  return data?.allowed === true
}
