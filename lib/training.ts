import { supabaseServer } from '@/lib/supabase'
import {
  type CommunityMember,
  memberCanAccess,
  signedDownloadUrl,
} from '@/lib/community'

// FR-COM-10 — Training section, gated by membership tier.
// Modules contain ordered items (video/document/google_doc/link). Progress is
// tracked per item so members see "1 of 4" and teachers/admins see completion.

export type MaterialKind = 'general' | 'event' | 'campaign' | 'cte' | 'curriculum'

/** How a course's content is paced/released (Circle-style course types). */
export type CourseType = 'self_paced' | 'structured' | 'scheduled'

export const COURSE_TYPE_LABELS: Record<CourseType, string> = {
  self_paced: 'Self-paced',
  structured: 'Structured',
  scheduled: 'Scheduled',
}

export interface TrainingItem {
  id: string
  title: string
  content_kind: 'video' | 'document' | 'google_doc' | 'link'
  external_url: string | null
  estimated_minutes: number | null
  display_order: number
  completed: boolean
}

/** A named, ordered group of lessons within a module. */
export interface TrainingSection {
  id: string
  title: string
  display_order: number
  items: TrainingItem[]
  /** Drip release: when this section unlocks (null = available now). */
  availableAt: string | null
  /** True when the section's content is not yet released to this member. */
  locked: boolean
}

export interface TrainingModuleSummary {
  id: string
  title: string
  description: string | null
  material_kind: MaterialKind
  course_type: CourseType
  event_ref: string | null
  sectionCount: number
  itemCount: number
  completedCount: number
  /** Set when surfaced via an event assignment. */
  isMandatory?: boolean
  dueAt?: string | null
  /** Whether the current member can access this module (entitlement-aware). */
  canAccess: boolean
}

/** Map of item_id → status for a member, for progress rollups. */
async function progressMap(memberId: string, itemIds: string[]): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set()
  const db = supabaseServer()
  const { data } = await db
    .from('training_progress')
    .select('item_id, status')
    .eq('member_id', memberId)
    .in('item_id', itemIds)
    .eq('status', 'completed')
  return new Set((data ?? []).map((r) => r.item_id as string))
}

/**
 * Published modules visible to the member, optionally filtered by material_kind.
 * Each carries item/completed counts and an entitlement-aware canAccess flag.
 */
export async function listModules(
  member: CommunityMember,
  filter?: { materialKind?: MaterialKind; eventRef?: string }
): Promise<TrainingModuleSummary[]> {
  const db = supabaseServer()
  let q = db
    .from('training_modules')
    .select(
      'id, title, description, material_kind, course_type, event_ref, min_tier_rank, training_items(id, status, section_id)'
    )
    .eq('is_published', true)
    .order('display_order', { ascending: true })

  if (filter?.materialKind) q = q.eq('material_kind', filter.materialKind)
  if (filter?.eventRef) q = q.eq('event_ref', filter.eventRef)

  const { data: modules } = await q
  if (!modules) return []

  type Row = {
    id: string
    title: string
    description: string | null
    material_kind: MaterialKind
    course_type: CourseType
    event_ref: string | null
    min_tier_rank: number
    training_items: { id: string; status: string; section_id: string | null }[]
  }

  const rows = modules as unknown as Row[]
  // Members only see published lessons — drafts don't count toward progress.
  const publishedItems = (m: Row) => m.training_items.filter((i) => i.status !== 'draft')
  const allItemIds = rows.flatMap((m) => publishedItems(m).map((i) => i.id))
  const completed = await progressMap(member.id, allItemIds)

  const out: TrainingModuleSummary[] = []
  for (const m of rows) {
    const items = publishedItems(m)
    const itemIds = items.map((i) => i.id)
    const sectionCount = new Set(
      items.map((i) => i.section_id).filter((s): s is string => !!s)
    ).size
    const canAccess = await memberCanAccess(
      member,
      'training_module',
      m.id,
      m.min_tier_rank,
      'view'
    )
    out.push({
      id: m.id,
      title: m.title,
      description: m.description,
      material_kind: m.material_kind,
      course_type: m.course_type ?? 'self_paced',
      event_ref: m.event_ref,
      sectionCount,
      itemCount: itemIds.length,
      completedCount: itemIds.filter((id) => completed.has(id)).length,
      canAccess,
    })
  }
  return out
}

export interface ModuleDetail extends TrainingModuleSummary {
  /** Flat list of all published lessons, in curriculum order. */
  items: TrainingItem[]
  /** Lessons grouped into their sections, in display order. */
  sections: TrainingSection[]
  /** Published lessons not assigned to any section (rendered after sections). */
  ungrouped: TrainingItem[]
}

/**
 * Record (idempotently) that a member has opened a course, and return the
 * enrolment timestamp. This is the reference date 'structured' courses drip
 * their sections from. Safe to call on every module view.
 */
async function ensureEnrollment(memberId: string, moduleId: string): Promise<string> {
  const db = supabaseServer()
  // Insert-if-absent; ignore the unique-violation when already enrolled.
  await db
    .from('training_enrollments')
    .upsert(
      { member_id: memberId, module_id: moduleId },
      { onConflict: 'member_id,module_id', ignoreDuplicates: true }
    )
  const { data } = await db
    .from('training_enrollments')
    .select('enrolled_at')
    .eq('member_id', memberId)
    .eq('module_id', moduleId)
    .maybeSingle()
  return (data?.enrolled_at as string | undefined) ?? new Date().toISOString()
}

/**
 * The date a section unlocks for a member given the course type and drip offset.
 * Returns null when the content is available immediately (self_paced, or a 0-day
 * drip, or a scheduled course with no start_date set yet).
 */
function sectionUnlockAt(
  courseType: CourseType,
  dripDays: number,
  enrolledAt: string,
  startDate: string | null
): Date | null {
  if (courseType === 'self_paced') return null
  const ref = courseType === 'scheduled' ? startDate : enrolledAt
  if (!ref) return null
  const at = new Date(ref)
  at.setDate(at.getDate() + (Number.isFinite(dripDays) ? dripDays : 0))
  return at.getTime() <= Date.now() ? null : at
}

/** Full module with sectioned, ordered items + per-item completion for the member. */
export async function getModule(
  member: CommunityMember,
  moduleId: string
): Promise<ModuleDetail | null> {
  const db = supabaseServer()
  const { data: m } = await db
    .from('training_modules')
    .select(
      'id, title, description, material_kind, course_type, start_date, event_ref, min_tier_rank, is_published'
    )
    .eq('id', moduleId)
    .maybeSingle()
  if (!m || !m.is_published) return null

  const courseType = (m.course_type ?? 'self_paced') as CourseType
  const startDate = (m.start_date as string | null) ?? null

  const [{ data: sections }, { data: items }, enrolledAt] = await Promise.all([
    db
      .from('training_sections')
      .select('id, title, display_order, drip_days')
      .eq('module_id', moduleId)
      .order('display_order', { ascending: true }),
    db
      .from('training_items')
      .select('id, title, content_kind, external_url, estimated_minutes, display_order, section_id, status')
      .eq('module_id', moduleId)
      .eq('status', 'published') // members only see published lessons
      .order('display_order', { ascending: true }),
    // Drip is relative to enrolment; self_paced courses don't need a row but it's
    // harmless to record the first view either way.
    ensureEnrollment(member.id, moduleId),
  ])

  const itemRows = items ?? []
  const completed = await progressMap(member.id, itemRows.map((i) => i.id))
  const canAccess = await memberCanAccess(
    member,
    'training_module',
    m.id,
    m.min_tier_rank,
    'view'
  )

  const toItem = (i: (typeof itemRows)[number]): TrainingItem => ({
    id: i.id,
    title: i.title,
    content_kind: i.content_kind as TrainingItem['content_kind'],
    external_url: i.external_url,
    estimated_minutes: i.estimated_minutes,
    display_order: i.display_order,
    completed: completed.has(i.id),
  })

  const sectionRows = sections ?? []
  const grouped: TrainingSection[] = sectionRows.map((s) => {
    const unlockAt = sectionUnlockAt(
      courseType,
      (s as { drip_days?: number }).drip_days ?? 0,
      enrolledAt,
      startDate
    )
    return {
      id: s.id,
      title: s.title,
      display_order: s.display_order,
      items: itemRows
        .filter((i) => (i as { section_id: string | null }).section_id === s.id)
        .map(toItem),
      availableAt: unlockAt ? unlockAt.toISOString() : null,
      locked: unlockAt !== null,
    }
  })
  const ungrouped = itemRows
    .filter((i) => !(i as { section_id: string | null }).section_id)
    .map(toItem)

  return {
    id: m.id,
    title: m.title,
    description: m.description,
    material_kind: m.material_kind as MaterialKind,
    course_type: courseType,
    event_ref: m.event_ref,
    sectionCount: sectionRows.length,
    itemCount: itemRows.length,
    completedCount: itemRows.filter((i) => completed.has(i.id)).length,
    canAccess,
    items: itemRows.map(toItem),
    sections: grouped,
    ungrouped,
  }
}

/**
 * Modules assigned to the member for events they're registered for, resolved by
 * their event_role against training_assignments. Surfaces mandatory items + due
 * dates for the "what must I complete before my event" view.
 */
export async function getAssignedModules(
  member: CommunityMember,
  opts: { eventRefs: string[]; eventRoles: string[] }
): Promise<TrainingModuleSummary[]> {
  if (opts.eventRefs.length === 0) return []
  const db = supabaseServer()

  const { data: assignments } = await db
    .from('training_assignments')
    .select('module_id, event_ref, event_role, is_mandatory, due_at')
    .in('event_ref', opts.eventRefs)
    .in('event_role', [...opts.eventRoles, 'all'])

  if (!assignments || assignments.length === 0) return []

  const moduleIds = [...new Set(assignments.map((a) => a.module_id as string))]
  const allModules = await listModules(member)
  const byId = new Map(allModules.map((m) => [m.id, m]))

  return assignments
    .map((a): TrainingModuleSummary | null => {
      const base = byId.get(a.module_id as string)
      if (!base) return null
      return { ...base, isMandatory: a.is_mandatory as boolean, dueAt: a.due_at as string | null }
    })
    .filter((m): m is TrainingModuleSummary => m !== null)
}

/** Whether a lesson's section is still drip-locked for this member. */
async function sectionLockFor(
  memberId: string,
  moduleId: string,
  sectionId: string | null
): Promise<{ locked: boolean; availableAt: string | null }> {
  if (!sectionId) return { locked: false, availableAt: null }
  const db = supabaseServer()
  const [{ data: mod }, { data: sec }, { data: enr }] = await Promise.all([
    db.from('training_modules').select('course_type, start_date').eq('id', moduleId).maybeSingle(),
    db.from('training_sections').select('drip_days').eq('id', sectionId).maybeSingle(),
    db
      .from('training_enrollments')
      .select('enrolled_at')
      .eq('member_id', memberId)
      .eq('module_id', moduleId)
      .maybeSingle(),
  ])
  const ct = (mod?.course_type ?? 'self_paced') as CourseType
  const enrolledAt = (enr?.enrolled_at as string | undefined) ?? new Date().toISOString()
  const unlock = sectionUnlockAt(
    ct,
    (sec as { drip_days?: number } | null)?.drip_days ?? 0,
    enrolledAt,
    (mod?.start_date as string | null) ?? null
  )
  return { locked: unlock !== null, availableAt: unlock ? unlock.toISOString() : null }
}

/** Build an embeddable iframe src for a known provider, else null. */
function embedSrc(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'youtube.com' && u.searchParams.get('v')) {
      return `https://www.youtube.com/embed/${u.searchParams.get('v')}`
    }
    if (host === 'youtu.be') return `https://www.youtube.com/embed${u.pathname}`
    if (host === 'vimeo.com') return `https://player.vimeo.com/video${u.pathname}`
    if (host.endsWith('wistia.com') || host.endsWith('wistia.net')) return url
    if (host.endsWith('typeform.com')) return url
    if (host === 'docs.google.com' || host === 'drive.google.com') {
      return url.replace(/\/(edit|view)(\?[^#]*)?(#.*)?$/, '/preview')
    }
    return null
  } catch {
    return null
  }
}

export type LessonMedia =
  | { type: 'video'; url: string }
  | { type: 'document'; url: string }
  | { type: 'embed'; src: string }
  | { type: 'link'; url: string }
  | null

export interface LessonDetail {
  id: string
  moduleId: string
  moduleTitle: string
  title: string
  body: string | null
  content_kind: TrainingItem['content_kind']
  completed: boolean
  media: LessonMedia
  prevId: string | null
  nextId: string | null
  index: number // 1-based position within the published curriculum
  total: number
  locked: boolean
  availableAt: string | null
}

/**
 * A single lesson rendered in the focused player: featured media (inline video,
 * embed, or link), lesson notes, completion state, and prev/next navigation in
 * curriculum order. Respects tier access and drip release.
 */
export async function getLesson(
  member: CommunityMember,
  moduleId: string,
  itemId: string
): Promise<LessonDetail | null> {
  const mod = await getModule(member, moduleId)
  if (!mod || !mod.canAccess) return null

  // Curriculum order: sections (in display order) then ungrouped.
  const ordered = [
    ...mod.sections.flatMap((s) => s.items.map((it) => ({ it, locked: s.locked, availableAt: s.availableAt }))),
    ...mod.ungrouped.map((it) => ({ it, locked: false, availableAt: null as string | null })),
  ]
  const idx = ordered.findIndex((o) => o.it.id === itemId)
  if (idx === -1) return null
  const here = ordered[idx]

  // Pull the media-bearing fields for this lesson.
  const db = supabaseServer()
  const { data: row } = await db
    .from('training_items')
    .select('storage_path, external_url, body, content_kind')
    .eq('id', itemId)
    .maybeSingle()

  let media: LessonMedia = null
  if (!here.locked && row) {
    const kind = row.content_kind as TrainingItem['content_kind']
    if ((kind === 'video' || kind === 'document') && row.storage_path) {
      const url = await signedDownloadUrl(row.storage_path as string)
      if (url) media = { type: kind, url }
    } else if (row.external_url) {
      const embed = embedSrc(row.external_url as string)
      media = embed ? { type: 'embed', src: embed } : { type: 'link', url: row.external_url as string }
    }
  }

  return {
    id: here.it.id,
    moduleId,
    moduleTitle: mod.title,
    title: here.it.title,
    body: (row?.body as string | null) ?? null,
    content_kind: here.it.content_kind,
    completed: here.it.completed,
    media,
    prevId: idx > 0 ? ordered[idx - 1].it.id : null,
    nextId: idx < ordered.length - 1 ? ordered[idx + 1].it.id : null,
    index: idx + 1,
    total: ordered.length,
    locked: here.locked,
    availableAt: here.availableAt,
  }
}

/** Resolve an item to a signed download URL after an access + drip check. */
export async function getItemDownload(
  member: CommunityMember,
  itemId: string
): Promise<{ url: string; title: string } | { error: string; status: number }> {
  const db = supabaseServer()
  const { data: item } = await db
    .from('training_items')
    .select('id, title, storage_path, content_kind, module_id, section_id, training_modules(min_tier_rank)')
    .eq('id', itemId)
    .maybeSingle()

  if (!item || !item.storage_path) return { error: 'Not found', status: 404 }

  const mod = Array.isArray(item.training_modules) ? item.training_modules[0] : item.training_modules
  const minRank = (mod as { min_tier_rank?: number } | null)?.min_tier_rank ?? 0

  const ok = await memberCanAccess(
    member,
    'training_module',
    item.module_id as string,
    minRank,
    'view'
  )
  if (!ok) return { error: 'Upgrade required', status: 403 }

  // Drip release — a section that hasn't unlocked yet can't be downloaded.
  const { locked } = await sectionLockFor(
    member.id,
    item.module_id as string,
    (item as { section_id: string | null }).section_id
  )
  if (locked) return { error: 'Not yet available', status: 403 }

  const url = await signedDownloadUrl(item.storage_path)
  if (!url) return { error: 'Could not generate link', status: 500 }
  return { url, title: item.title }
}
