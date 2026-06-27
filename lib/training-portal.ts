import { supabaseServer } from '@/lib/supabase'
import { type CommunityMember } from '@/lib/community'
import { getMemberEvents } from '@/lib/event-portal'
import {
  listModules,
  deriveType,
  courseIssuer,
  type TrainingModuleSummary,
  type MaterialKind,
  type CourseTheme,
  type TrainingType,
} from '@/lib/training'

// Data layer for the redesigned Training portal (member + admin). Sits on top of
// lib/training.ts and reconciles the two assignment sources:
//   * training_assignments        — legacy, event-only, single is_mandatory bool
//   * course_object_assignments   — new builder, any Object type, per-tier reqs
// Members see assignments from BOTH so nothing created on the event Training tab
// disappears (Q3 / Option A).

export type ObjectType = 'competition' | 'campaign' | 'cohort' | 'workshop' | 'space'
export type Requirement = 'mandatory' | 'optional' | 'na'

export const OBJECT_TYPE_LABELS: Record<ObjectType, string> = {
  competition: 'Competition',
  campaign: 'Campaign',
  cohort: 'Cohort',
  workshop: 'Workshop',
  space: 'Space',
}

// Friendly label for a member's event participation role (members.event_role).
const ROLE_LABELS: Record<string, string> = {
  participant: 'Participant',
  school_student_manager: 'Student Manager',
  teacher: 'Teacher',
  mentor: 'Mentor',
  parent: 'Parent',
  adult: 'Participant',
  subscriber: 'Member',
}
export function roleLabel(role: string | null | undefined): string {
  return (role && ROLE_LABELS[role]) || 'Participant'
}

/** A course as it appears for a member in the context of one Object assignment. */
export interface AssignedCourse {
  moduleId: string
  title: string
  description: string | null
  material_kind: MaterialKind
  theme: CourseTheme | null
  type: TrainingType
  itemCount: number
  completedCount: number
  canAccess: boolean
  objectType: ObjectType
  objectRef: string
  objectLabel: string
  role: string | null
  requirement: Requirement
  dueAt: string | null
}

/** Resolve the requirement that applies to a member given their active tiers. */
function effectiveRequirement(
  a: { default_requirement: string; tier_requirements: Record<string, string> | null },
  tierIds: string[]
): Requirement {
  const reqs = tierIds
    .map((id) => a.tier_requirements?.[id])
    .filter((r): r is Requirement => r === 'mandatory' || r === 'optional' || r === 'na')
  if (reqs.includes('mandatory')) return 'mandatory'
  if (reqs.includes('optional')) return 'optional'
  if (reqs.length > 0 && reqs.every((r) => r === 'na')) return 'na'
  return (a.default_requirement as Requirement) ?? 'optional'
}

/** Cohort ids (incl. workshops/spaces — all live in mentoring_cohorts) a member belongs to. */
async function memberCohorts(
  memberId: string
): Promise<{ ids: string[]; labelByRef: Map<string, string> }> {
  const db = supabaseServer()
  const { data } = await db
    .from('cohort_members')
    .select('cohort_id, mentoring_cohorts(id, name)')
    .eq('member_id', memberId)
  const ids: string[] = []
  const labelByRef = new Map<string, string>()
  for (const r of data ?? []) {
    const id = r.cohort_id as string
    ids.push(id)
    const c = Array.isArray(r.mentoring_cohorts) ? r.mentoring_cohorts[0] : r.mentoring_cohorts
    if (c?.name) labelByRef.set(id, c.name as string)
  }
  return { ids, labelByRef }
}

/**
 * Every course assigned to a member across all Object types, merging the legacy
 * event table and the new per-tier table. Excludes 'na' requirements. One row per
 * (course, Object) pair — a course assigned to two Objects yields two rows.
 */
export async function getAssignedCourses(member: CommunityMember): Promise<AssignedCourse[]> {
  const db = supabaseServer()

  // Objects the member belongs to.
  const events = await getMemberEvents(member)
  const eventLabel = new Map<string, string>()
  const eventType = new Map<string, ObjectType>()
  const eventRefs: string[] = []
  for (const e of events) {
    const t: ObjectType = e.activityType === 'campaign' ? 'campaign' : 'competition'
    for (const ref of [e.eventId, e.slug].filter((r): r is string => !!r)) {
      eventRefs.push(ref)
      eventLabel.set(ref, e.title)
      eventType.set(ref, t)
    }
  }
  const eventRoles: string[] = []
  if (member.event_role) {
    eventRoles.push(member.event_role)
    if (member.event_role === 'school_student_manager') eventRoles.push('participant')
  }
  const { ids: cohortIds, labelByRef: cohortLabel } = await memberCohorts(member.id)

  // Course summaries (progress, access, theme) keyed by id.
  const summaries = await listModules(member)
  const byId = new Map(summaries.map((m) => [m.id, m]))

  // Keyed by module+object so the new table wins over the legacy duplicate.
  const out = new Map<string, AssignedCourse>()
  const key = (m: string, ot: string, or: string) => `${m}::${ot}::${or}`

  const toCourse = (
    base: TrainingModuleSummary,
    ctx: { objectType: ObjectType; objectRef: string; objectLabel: string; requirement: Requirement; dueAt: string | null }
  ): AssignedCourse => ({
    moduleId: base.id,
    title: base.title,
    description: base.description,
    material_kind: base.material_kind,
    theme: base.theme,
    type: deriveType(base.material_kind),
    itemCount: base.itemCount,
    completedCount: base.completedCount,
    canAccess: base.canAccess,
    role: member.event_role,
    ...ctx,
  })

  // ── Legacy event assignments (single is_mandatory bool, role-targeted). ──
  if (eventRefs.length > 0) {
    const { data: legacy } = await db
      .from('training_assignments')
      .select('module_id, event_ref, event_role, is_mandatory, due_at')
      .in('event_ref', eventRefs)
      .in('event_role', [...eventRoles, 'all'])
    for (const a of legacy ?? []) {
      const base = byId.get(a.module_id as string)
      if (!base) continue
      const ref = a.event_ref as string
      const objectType = eventType.get(ref) ?? 'competition'
      out.set(key(base.id, objectType, ref), toCourse(base, {
        objectType,
        objectRef: ref,
        objectLabel: eventLabel.get(ref) ?? base.title,
        requirement: a.is_mandatory ? 'mandatory' : 'optional',
        dueAt: (a.due_at as string | null) ?? null,
      }))
    }
  }

  // ── New per-tier Object assignments. ──
  const objectRefs = [...eventRefs, ...cohortIds]
  if (objectRefs.length > 0) {
    const { data: rich } = await db
      .from('course_object_assignments')
      .select('module_id, object_type, object_ref, object_label, default_requirement, tier_requirements, due_at')
      .in('object_ref', objectRefs)
    for (const a of rich ?? []) {
      const base = byId.get(a.module_id as string)
      if (!base) continue
      const objectType = a.object_type as ObjectType
      const objectRef = a.object_ref as string
      // Guard: the ref must actually belong to the member for this object class.
      const isEventObj = objectType === 'competition' || objectType === 'campaign'
      if (isEventObj && !eventRefs.includes(objectRef)) continue
      if (!isEventObj && !cohortIds.includes(objectRef)) continue

      const requirement = effectiveRequirement(
        {
          default_requirement: a.default_requirement as string,
          tier_requirements: (a.tier_requirements as Record<string, string> | null) ?? {},
        },
        member.activeTierIds
      )
      if (requirement === 'na') continue
      const objectLabel =
        (a.object_label as string | null) ??
        (isEventObj ? eventLabel.get(objectRef) : cohortLabel.get(objectRef)) ??
        base.title
      out.set(key(base.id, objectType, objectRef), toCourse(base, {
        objectType,
        objectRef,
        objectLabel,
        requirement,
        dueAt: (a.due_at as string | null) ?? null,
      }))
    }
  }

  return [...out.values()]
}

export interface ObjectGroup {
  objectType: ObjectType
  objectRef: string
  objectLabel: string
  role: string | null
  courses: AssignedCourse[]
  completedCourses: number
  totalCourses: number
}

export interface MyTraining {
  stats: { requiredToDo: number; dueThisWeek: number; inProgress: number; certificates: number }
  /** Required (mandatory) courses, deadline-sorted, for Variant A's priority list. */
  required: AssignedCourse[]
  /** In-progress + optional accessible courses for the "Continue learning" grid. */
  continueLearning: TrainingModuleSummary[]
  /** All assigned courses grouped by Object, for Variant B. */
  groups: ObjectGroup[]
}

const WEEK_MS = 7 * 24 * 60 * 60_000

function isComplete(c: { itemCount: number; completedCount: number }) {
  return c.itemCount > 0 && c.completedCount >= c.itemCount
}

/** Everything the My training dashboard needs for both layout variants. */
export async function getMyTraining(member: CommunityMember): Promise<MyTraining> {
  const db = supabaseServer()
  const [assigned, summaries, { count: certCount }] = await Promise.all([
    getAssignedCourses(member),
    listModules(member),
    db
      .from('training_certificates')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', member.id),
  ])

  const required = assigned
    .filter((c) => c.requirement === 'mandatory')
    .sort((a, b) => {
      if (!a.dueAt && !b.dueAt) return 0
      if (!a.dueAt) return 1
      if (!b.dueAt) return -1
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
    })

  // Stats — distinct courses so a course assigned to two Objects isn't double-counted.
  const now = Date.now()
  const distinctRequiredOpen = new Set(required.filter((c) => !isComplete(c)).map((c) => c.moduleId))
  const distinctDueThisWeek = new Set(
    required
      .filter((c) => !isComplete(c) && c.dueAt && new Date(c.dueAt).getTime() - now <= WEEK_MS)
      .map((c) => c.moduleId)
  )
  const inProgressModules = summaries.filter((m) => m.completedCount > 0 && m.completedCount < m.itemCount)

  // Continue learning: in-progress courses, then accessible not-started optionals.
  const requiredIds = new Set(required.map((c) => c.moduleId))
  const continueLearning = [
    ...inProgressModules,
    ...summaries.filter(
      (m) => m.canAccess && m.completedCount === 0 && m.itemCount > 0 && !requiredIds.has(m.id)
    ),
  ]
    .filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i)
    .slice(0, 6)

  // Group by Object for Variant B (events first, then cohorts/workshops/spaces).
  const groupMap = new Map<string, ObjectGroup>()
  for (const c of assigned) {
    const gk = `${c.objectType}::${c.objectRef}`
    let g = groupMap.get(gk)
    if (!g) {
      g = {
        objectType: c.objectType,
        objectRef: c.objectRef,
        objectLabel: c.objectLabel,
        role: c.role,
        courses: [],
        completedCourses: 0,
        totalCourses: 0,
      }
      groupMap.set(gk, g)
    }
    g.courses.push(c)
  }
  const groups = [...groupMap.values()]
  for (const g of groups) {
    // Required first, then by deadline.
    g.courses.sort((a, b) => {
      if (a.requirement !== b.requirement) return a.requirement === 'mandatory' ? -1 : 1
      return (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) - (b.dueAt ? new Date(b.dueAt).getTime() : Infinity)
    })
    g.totalCourses = g.courses.length
    g.completedCourses = g.courses.filter(isComplete).length
  }

  return {
    stats: {
      requiredToDo: distinctRequiredOpen.size,
      dueThisWeek: distinctDueThisWeek.size,
      inProgress: inProgressModules.length,
      certificates: certCount ?? 0,
    },
    required,
    continueLearning,
    groups,
  }
}

/* ─── Certificates ───────────────────────────────────────────────────────── */

export interface Certificate {
  id: string
  moduleId: string
  title: string
  material_kind: MaterialKind
  theme: CourseTheme | null
  type: TrainingType
  certNumber: string
  issuer: string
  issuedAt: string
}

export async function getCertificates(member: CommunityMember): Promise<Certificate[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('training_certificates')
    .select('id, module_id, cert_number, issuer, issued_at, training_modules(title, material_kind, theme)')
    .eq('member_id', member.id)
    .order('issued_at', { ascending: false })
  return (data ?? []).map((r) => {
    const m = Array.isArray(r.training_modules) ? r.training_modules[0] : r.training_modules
    const kind = (m?.material_kind as MaterialKind) ?? 'general'
    return {
      id: r.id as string,
      moduleId: r.module_id as string,
      title: (m?.title as string) ?? 'Course',
      material_kind: kind,
      theme: (m?.theme as CourseTheme | null) ?? null,
      type: deriveType(kind),
      certNumber: r.cert_number as string,
      issuer: (r.issuer as string) ?? courseIssuer(kind),
      issuedAt: r.issued_at as string,
    }
  })
}

/**
 * Idempotently issue a completion certificate when a member has completed every
 * PUBLISHED lesson of a course. Called from the progress API after a completion.
 * Returns the cert number if one is (or was already) issued, else null.
 */
export async function ensureCertificate(memberId: string, moduleId: string): Promise<string | null> {
  const db = supabaseServer()
  const { data: mod } = await db
    .from('training_modules')
    .select('id, material_kind, is_published')
    .eq('id', moduleId)
    .maybeSingle()
  if (!mod || !mod.is_published) return null

  const { data: items } = await db
    .from('training_items')
    .select('id')
    .eq('module_id', moduleId)
    .eq('status', 'published')
  const itemIds = (items ?? []).map((i) => i.id as string)
  if (itemIds.length === 0) return null

  const { count: done } = await db
    .from('training_progress')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', memberId)
    .eq('status', 'completed')
    .in('item_id', itemIds)
  if ((done ?? 0) < itemIds.length) return null

  // Already issued?
  const { data: existing } = await db
    .from('training_certificates')
    .select('cert_number')
    .eq('member_id', memberId)
    .eq('module_id', moduleId)
    .maybeSingle()
  if (existing) return existing.cert_number as string

  const year = new Date().getFullYear()
  const certNumber = `STL-${year}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`
  const { error } = await db.from('training_certificates').insert({
    member_id: memberId,
    module_id: moduleId,
    cert_number: certNumber,
    issuer: courseIssuer(mod.material_kind as MaterialKind),
  })
  // Unique-violation = a concurrent request issued it first; treat as success.
  if (error && !String(error.message).includes('duplicate')) {
    console.error('[training] certificate issue error:', error)
    return null
  }
  return certNumber
}

/* ─── Group progress (Teacher) ───────────────────────────────────────────── */

export type GroupCellStatus = 'complete' | 'in_progress' | 'overdue' | 'not_started'

export interface GroupCourseCol {
  moduleId: string
  title: string
  dueAt: string | null
}
export interface GroupStudentRow {
  memberId: string
  name: string
  group: string
  statusByCourse: Record<string, GroupCellStatus>
}
export interface GroupProgress {
  /** Objects this Teacher can monitor (their registered events), for the filter. */
  objects: { ref: string; label: string }[]
  selectedRef: string | null
  /** Distinct group/school names within the selected Object, for the group filter. */
  groups: string[]
  courses: GroupCourseCol[]
  students: GroupStudentRow[]
  summary: { total: number; compliant: number; atRisk: number }
}

/** Courses that are MANDATORY for an Object (across both assignment tables). */
async function objectMandatoryCourses(refs: string[]): Promise<GroupCourseCol[]> {
  if (refs.length === 0) return []
  const db = supabaseServer()
  const cols = new Map<string, GroupCourseCol>()

  const [{ data: legacy }, { data: rich }] = await Promise.all([
    db
      .from('training_assignments')
      .select('module_id, due_at, is_mandatory, training_modules(title)')
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

  for (const a of legacy ?? []) {
    cols.set(a.module_id as string, {
      moduleId: a.module_id as string,
      title: title(a),
      dueAt: (a.due_at as string | null) ?? null,
    })
  }
  for (const a of rich ?? []) {
    const tierReqs = (a.tier_requirements as Record<string, string> | null) ?? {}
    const mandatory =
      a.default_requirement === 'mandatory' || Object.values(tierReqs).includes('mandatory')
    if (!mandatory) continue
    cols.set(a.module_id as string, {
      moduleId: a.module_id as string,
      title: title(a),
      dueAt: (a.due_at as string | null) ?? null,
    })
  }
  return [...cols.values()]
}

/**
 * Teacher's group-completion matrix. Students are the participants registered
 * under this Teacher (matched by teacher_email per migration cron convention) for
 * the selected Object; columns are that Object's mandatory courses.
 */
export async function getGroupProgress(
  member: CommunityMember,
  selectedRef?: string
): Promise<GroupProgress> {
  const db = supabaseServer()
  const events = await getMemberEvents(member)
  const objects = events
    .filter((e) => e.slug)
    .map((e) => ({ ref: e.slug, label: e.title }))

  const selected = selectedRef && objects.some((o) => o.ref === selectedRef)
    ? selectedRef
    : objects[0]?.ref ?? null
  if (!selected) {
    return { objects, selectedRef: null, groups: [], courses: [], students: [], summary: { total: 0, compliant: 0, atRisk: 0 } }
  }

  const selectedEvent = events.find((e) => e.slug === selected)
  const refs = [selectedEvent?.eventId, selected].filter((r): r is string => !!r)

  // Mandatory course columns for this Object.
  const courses = await objectMandatoryCourses(refs)

  // The Teacher's group: registrations they own (teacher_email) for this event.
  const { data: regs } = await db
    .from('registrations')
    .select('id, school_name')
    .eq('event_slug', selected)
    .eq('teacher_email', member.email)
  const regIds = (regs ?? []).map((r) => r.id as string)
  const groupByReg = new Map((regs ?? []).map((r) => [r.id as string, (r.school_name as string) ?? 'Group']))

  let students: GroupStudentRow[] = []
  const groupNames = new Set<string>()

  if (regIds.length > 0 && courses.length > 0) {
    const { data: parts } = await db
      .from('participants')
      .select('member_id, first_name, last_name, registration_id')
      .in('registration_id', regIds)
      .not('member_id', 'is', null)

    const memberIds = [...new Set((parts ?? []).map((p) => p.member_id as string))]
    const moduleIds = courses.map((c) => c.moduleId)

    // Published item ids per module + each student's completed set, in two queries.
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

    const completedByMember = new Map<string, Set<string>>()
    if (memberIds.length > 0 && allItemIds.length > 0) {
      const { data: progress } = await db
        .from('training_progress')
        .select('member_id, item_id')
        .eq('status', 'completed')
        .in('member_id', memberIds)
        .in('item_id', allItemIds)
      for (const p of progress ?? []) {
        const set = completedByMember.get(p.member_id as string) ?? new Set<string>()
        set.add(p.item_id as string)
        completedByMember.set(p.member_id as string, set)
      }
    }

    const now = Date.now()
    students = (parts ?? []).map((p) => {
      const mid = p.member_id as string
      const completed = completedByMember.get(mid) ?? new Set<string>()
      const group = groupByReg.get(p.registration_id as string) ?? 'Group'
      groupNames.add(group)
      const statusByCourse: Record<string, GroupCellStatus> = {}
      for (const c of courses) {
        const ids = itemsByModule.get(c.moduleId) ?? []
        const done = ids.filter((id) => completed.has(id)).length
        let status: GroupCellStatus
        if (ids.length > 0 && done >= ids.length) status = 'complete'
        else if (c.dueAt && new Date(c.dueAt).getTime() < now) status = 'overdue'
        else if (done > 0) status = 'in_progress'
        else status = 'not_started'
        statusByCourse[c.moduleId] = status
      }
      return {
        memberId: mid,
        name: [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Student',
        group,
        statusByCourse,
      }
    })
  }

  const compliant = students.filter((s) =>
    courses.every((c) => s.statusByCourse[c.moduleId] === 'complete')
  ).length
  const atRisk = students.filter((s) =>
    courses.some((c) => s.statusByCourse[c.moduleId] === 'overdue')
  ).length

  return {
    objects,
    selectedRef: selected,
    groups: [...groupNames],
    courses,
    students,
    summary: { total: students.length, compliant, atRisk },
  }
}
