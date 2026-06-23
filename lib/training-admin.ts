import { supabaseServer } from '@/lib/supabase'
import { getAllEvents, getAllCampaigns, getEventsBySlugs } from '@/lib/sanity'
import type { ObjectType } from '@/lib/training-portal'
export type { ObjectType }

// Admin-side Training data: the trainable-Object catalogue, completion tracking
// for an Object, and the overview rollups. Event/campaign Objects are keyed by
// their slug (stable, and what registrations + member matching use); cohorts /
// workshops / spaces by their mentoring_cohorts id.

export interface TrainableObject {
  type: ObjectType
  ref: string
  label: string
}

const COHORT_TYPE: Record<string, ObjectType> = {
  mentoring: 'cohort',
  coaching: 'cohort',
  space: 'space',
  community: 'space',
  training: 'space',
}

/** Every Object a course can be assigned to (scope 'all') or only those that
 *  already have a course assigned (scope 'assigned', for the tracking picker). */
export async function listTrainableObjects(
  scope: 'all' | 'assigned' = 'all'
): Promise<TrainableObject[]> {
  const db = supabaseServer()
  const [events, campaigns, { data: cohorts }] = await Promise.all([
    getAllEvents(),
    getAllCampaigns(),
    db.from('mentoring_cohorts').select('id, name, container_type'),
  ])

  const all: TrainableObject[] = []
  for (const e of (events ?? []) as { title: string; slug?: { current?: string } }[]) {
    if (e.slug?.current) all.push({ type: 'competition', ref: e.slug.current, label: e.title })
  }
  for (const c of (campaigns ?? []) as { title: string; slug?: { current?: string } }[]) {
    if (c.slug?.current) all.push({ type: 'campaign', ref: c.slug.current, label: c.title })
  }
  for (const c of cohorts ?? []) {
    const type = COHORT_TYPE[(c.container_type as string) ?? ''] ?? 'cohort'
    all.push({ type, ref: c.id as string, label: (c.name as string) ?? 'Cohort' })
  }

  if (scope === 'all') return all

  // Assigned-only: refs that appear in either assignment table.
  const [{ data: legacy }, { data: rich }] = await Promise.all([
    db.from('training_assignments').select('event_ref'),
    db.from('course_object_assignments').select('object_ref'),
  ])
  const assignedRefs = new Set<string>()
  for (const r of legacy ?? []) assignedRefs.add(r.event_ref as string)
  for (const r of rich ?? []) assignedRefs.add(r.object_ref as string)
  // Legacy rows may key off the Sanity _id instead of the slug — map those over
  // so the matching object (which we key by slug) is still included.
  for (const e of (events ?? []) as { _id: string; slug?: { current?: string } }[]) {
    if (e.slug?.current && assignedRefs.has(e._id)) assignedRefs.add(e.slug.current)
  }
  return all.filter((o) => assignedRefs.has(o.ref))
}

/* ─── Event completion tracking ──────────────────────────────────────────── */

export type TrackStatus = 'complete' | 'in_progress' | 'overdue' | 'not_started'

export interface TrackingRow {
  memberId: string
  name: string
  ageBracket: string | null
  group: string
  status: TrackStatus
  lastActivity: string | null
}

export interface EventTracking {
  courses: { moduleId: string; title: string; dueAt: string | null }[]
  rows: TrackingRow[]
  summary: { complete: number; in_progress: number; not_started: number; overdue: number }
}

/** Mandatory courses assigned to an Object (across both assignment tables). */
async function mandatoryCoursesFor(refs: string[]) {
  if (refs.length === 0) return [] as { moduleId: string; title: string; dueAt: string | null }[]
  const db = supabaseServer()
  const cols = new Map<string, { moduleId: string; title: string; dueAt: string | null }>()
  const [{ data: legacy }, { data: rich }] = await Promise.all([
    db
      .from('training_assignments')
      .select('module_id, due_at, training_modules(title)')
      .in('event_ref', refs)
      .eq('is_mandatory', true),
    db
      .from('course_object_assignments')
      .select('module_id, due_at, default_requirement, tier_requirements, training_modules(title)')
      .in('object_ref', refs),
  ])
  const title = (row: { training_modules?: unknown }) => {
    const m = Array.isArray(row.training_modules) ? row.training_modules[0] : row.training_modules
    return (m as { title?: string } | null)?.title ?? 'Course'
  }
  for (const a of legacy ?? [])
    cols.set(a.module_id as string, { moduleId: a.module_id as string, title: title(a), dueAt: (a.due_at as string | null) ?? null })
  for (const a of rich ?? []) {
    const tr = (a.tier_requirements as Record<string, string> | null) ?? {}
    if (a.default_requirement !== 'mandatory' && !Object.values(tr).includes('mandatory')) continue
    cols.set(a.module_id as string, { moduleId: a.module_id as string, title: title(a), dueAt: (a.due_at as string | null) ?? null })
  }
  return [...cols.values()]
}

/**
 * Per-participant completion of an event Object's mandatory training. Each
 * participant gets one aggregate status. Supports age-bracket + outstanding-only
 * filtering. (Cohort/space Objects use cohort_members in a later pass.)
 */
export async function getEventTracking(
  objectRef: string,
  opts: { bracket?: string; outstanding?: boolean } = {}
): Promise<EventTracking> {
  const db = supabaseServer()
  // Resolve the Sanity _id too — legacy assignments may key off it.
  const meta = await getEventsBySlugs([objectRef])
  const refs = [objectRef, ...meta.map((m) => m._id)]
  const courses = await mandatoryCoursesFor(refs)
  const empty = { courses, rows: [], summary: { complete: 0, in_progress: 0, not_started: 0, overdue: 0 } }
  if (courses.length === 0) return empty

  const { data: regs } = await db
    .from('registrations')
    .select('id, school_name')
    .eq('event_slug', objectRef)
  const regIds = (regs ?? []).map((r) => r.id as string)
  const groupByReg = new Map((regs ?? []).map((r) => [r.id as string, (r.school_name as string) ?? 'Group']))
  if (regIds.length === 0) return empty

  const { data: parts } = await db
    .from('participants')
    .select('member_id, first_name, last_name, registration_id, members(age_bracket)')
    .in('registration_id', regIds)
    .not('member_id', 'is', null)

  const moduleIds = courses.map((c) => c.moduleId)
  const { data: items } = await db
    .from('training_items')
    .select('id, module_id')
    .in('module_id', moduleIds)
    .eq('status', 'published')
  const itemsByModule = new Map<string, string[]>()
  for (const it of items ?? []) {
    const arr = itemsByModule.get(it.module_id as string) ?? []
    arr.push(it.id as string)
    itemsByModule.set(it.module_id as string, arr)
  }
  const allItemIds = (items ?? []).map((i) => i.id as string)

  const memberIds = [...new Set((parts ?? []).map((p) => p.member_id as string))]
  const completedByMember = new Map<string, Set<string>>()
  const lastByMember = new Map<string, string>()
  if (memberIds.length > 0 && allItemIds.length > 0) {
    const { data: prog } = await db
      .from('training_progress')
      .select('member_id, item_id, status, updated_at')
      .in('member_id', memberIds)
      .in('item_id', allItemIds)
    for (const p of prog ?? []) {
      if (p.status === 'completed') {
        const set = completedByMember.get(p.member_id as string) ?? new Set<string>()
        set.add(p.item_id as string)
        completedByMember.set(p.member_id as string, set)
      }
      const prev = lastByMember.get(p.member_id as string)
      const ua = p.updated_at as string
      if (!prev || new Date(ua) > new Date(prev)) lastByMember.set(p.member_id as string, ua)
    }
  }

  const now = Date.now()
  let rows: TrackingRow[] = (parts ?? []).map((p) => {
    const mid = p.member_id as string
    const completed = completedByMember.get(mid) ?? new Set<string>()
    const m = Array.isArray(p.members) ? p.members[0] : p.members
    // Aggregate status across all mandatory courses.
    let anyOverdue = false
    let anyStarted = false
    let allComplete = true
    for (const c of courses) {
      const ids = itemsByModule.get(c.moduleId) ?? []
      const done = ids.filter((id) => completed.has(id)).length
      const complete = ids.length > 0 && done >= ids.length
      if (!complete) {
        allComplete = false
        if (c.dueAt && new Date(c.dueAt).getTime() < now) anyOverdue = true
        if (done > 0) anyStarted = true
      } else {
        anyStarted = true
      }
    }
    const status: TrackStatus = allComplete
      ? 'complete'
      : anyOverdue
        ? 'overdue'
        : anyStarted
          ? 'in_progress'
          : 'not_started'
    return {
      memberId: mid,
      name: [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Participant',
      ageBracket: (m as { age_bracket?: string } | null)?.age_bracket ?? null,
      group: groupByReg.get(p.registration_id as string) ?? 'Group',
      status,
      lastActivity: lastByMember.get(mid) ?? null,
    }
  })

  if (opts.bracket && opts.bracket !== 'all') rows = rows.filter((r) => r.ageBracket === opts.bracket)

  const summary = {
    complete: rows.filter((r) => r.status === 'complete').length,
    in_progress: rows.filter((r) => r.status === 'in_progress').length,
    not_started: rows.filter((r) => r.status === 'not_started').length,
    overdue: rows.filter((r) => r.status === 'overdue').length,
  }
  if (opts.outstanding) rows = rows.filter((r) => r.status !== 'complete')

  return { courses, rows, summary }
}

/* ─── Overview ───────────────────────────────────────────────────────────── */

export interface ObjectReadiness {
  ref: string
  label: string
  type: ObjectType
  pct: number
  hasOverdue: boolean
}
export interface AdminOverview {
  publishedCourses: number
  enrolledMembers: number
  avgCompletion: number
  needsAttention: number
  readiness: ObjectReadiness[]
  recentlyEdited: { id: string; title: string; lessons: number; isPublished: boolean; updatedAt: string }[]
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const db = supabaseServer()
  const [{ count: published }, { count: enrolled }, { data: recent }, objects] = await Promise.all([
    db.from('training_modules').select('id', { count: 'exact', head: true }).eq('is_published', true),
    db.from('training_enrollments').select('member_id', { count: 'exact', head: true }),
    db
      .from('training_modules')
      .select('id, title, is_published, updated_at, training_items(id)')
      .order('updated_at', { ascending: false })
      .limit(6),
    listTrainableObjects('assigned'),
  ])

  // Per-Object readiness (event/campaign Objects only — they carry registrations).
  const eventObjects = objects.filter((o) => o.type === 'competition' || o.type === 'campaign')
  const readiness: ObjectReadiness[] = []
  let pctSum = 0
  let needsAttention = 0
  for (const o of eventObjects) {
    const t = await getEventTracking(o.ref)
    const total = t.rows.length || t.summary.complete + t.summary.in_progress + t.summary.not_started + t.summary.overdue
    const pct = total > 0 ? Math.round((t.summary.complete / total) * 100) : 0
    const hasOverdue = t.summary.overdue > 0
    if (hasOverdue) needsAttention++
    pctSum += pct
    readiness.push({ ref: o.ref, label: o.label, type: o.type, pct, hasOverdue })
  }
  readiness.sort((a, b) => a.pct - b.pct)

  return {
    publishedCourses: published ?? 0,
    enrolledMembers: enrolled ?? 0,
    avgCompletion: readiness.length > 0 ? Math.round(pctSum / readiness.length) : 0,
    needsAttention,
    readiness,
    recentlyEdited: (recent ?? []).map((m) => ({
      id: m.id as string,
      title: m.title as string,
      lessons: Array.isArray(m.training_items) ? m.training_items.length : 0,
      isPublished: m.is_published as boolean,
      updatedAt: m.updated_at as string,
    })),
  }
}
