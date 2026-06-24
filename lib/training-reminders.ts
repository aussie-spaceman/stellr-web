import { supabaseServer } from '@/lib/supabase'
import { formatDateShort } from '@/lib/utils'
import { getEventsByIds } from '@/lib/sanity'
import { notifyMember } from '@/lib/notify'
import { sendEmail } from '@/lib/email'

// Training reminder + escalation engine (FR-COM-10), run daily by the cron.
// Processes BOTH assignment sources:
//   * training_assignments        — legacy, event-only, single is_mandatory
//   * course_object_assignments   — new builder, any Object type, per-tier reqs
// Reminders (in-app + email, per the course's channel toggles) go to members who
// haven't finished mandatory training as a deadline approaches; overdue mandatory
// training escalates to the supervising adult — the Teacher OR Student Manager
// for an event group, or the mentor for a cohort/space.
//
// SMS is intentionally out of scope (future): notifyMember already no-ops SMS
// until a provider is wired, and direct sends here use email only.

const DAY = 24 * 60 * 60_000

interface Settings {
  remind_inapp: boolean
  remind_email: boolean
  remind_sms: boolean
  remind_2wk: boolean
  remind_1wk: boolean
  remind_2d: boolean
  remind_1d: boolean
  escalate_supervisor: boolean
}
const DEFAULTS: Settings = {
  remind_inapp: true, remind_email: true, remind_sms: false,
  remind_2wk: false, remind_1wk: true, remind_2d: false, remind_1d: true,
  escalate_supervisor: true,
}

type Bucket = '2wk' | '1wk' | '2d' | '1d' | 'overdue'

function bucketFor(dueMs: number, now: number, s: Settings): Bucket | null {
  if (dueMs < now) return 'overdue'
  if (s.remind_1d && dueMs <= now + DAY) return '1d'
  if (s.remind_2d && dueMs <= now + 2 * DAY) return '2d'
  if (s.remind_1wk && dueMs <= now + 7 * DAY) return '1wk'
  if (s.remind_2wk && dueMs <= now + 14 * DAY) return '2wk'
  return null
}

type Db = ReturnType<typeof supabaseServer>

async function settingsByModule(db: Db, moduleIds: string[]): Promise<Map<string, Settings>> {
  const map = new Map<string, Settings>()
  if (moduleIds.length === 0) return map
  const { data } = await db
    .from('training_modules')
    .select('id, remind_inapp, remind_email, remind_sms, remind_2wk, remind_1wk, remind_2d, remind_1d, escalate_supervisor')
    .in('id', [...new Set(moduleIds)])
  for (const s of data ?? []) map.set(s.id as string, s as unknown as Settings)
  return map
}

/** Published lesson ids for a set of modules. */
async function publishedItems(db: Db, moduleIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (moduleIds.length === 0) return out
  const { data } = await db
    .from('training_items')
    .select('id, module_id')
    .in('module_id', [...new Set(moduleIds)])
    .eq('status', 'published')
  for (const it of data ?? []) {
    const arr = out.get(it.module_id as string) ?? []
    arr.push(it.id as string)
    out.set(it.module_id as string, arr)
  }
  return out
}

/** member_id → set of completed item ids, across the given items. */
async function completedByMember(db: Db, memberIds: string[], itemIds: string[]): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>()
  if (memberIds.length === 0 || itemIds.length === 0) return map
  const { data } = await db
    .from('training_progress')
    .select('member_id, item_id')
    .eq('status', 'completed')
    .in('member_id', [...new Set(memberIds)])
    .in('item_id', [...new Set(itemIds)])
  for (const p of data ?? []) {
    const set = map.get(p.member_id as string) ?? new Set<string>()
    set.add(p.item_id as string)
    map.set(p.member_id as string, set)
  }
  return map
}

/** Active tier ids per member (for per-tier requirement resolution). */
async function memberTierIds(db: Db, memberIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (memberIds.length === 0) return map
  const { data } = await db
    .from('member_memberships')
    .select('member_id, tier_id')
    .eq('renewal_status', 'active')
    .in('member_id', [...new Set(memberIds)])
  for (const r of data ?? []) {
    const arr = map.get(r.member_id as string) ?? []
    if (r.tier_id) arr.push(r.tier_id as string)
    map.set(r.member_id as string, arr)
  }
  return map
}

type Requirement = 'mandatory' | 'optional' | 'na'
function reqForTiers(a: { default_requirement: string; tier_requirements: Record<string, string> | null }, tierIds: string[]): Requirement {
  const reqs = tierIds.map((id) => a.tier_requirements?.[id]).filter((r): r is Requirement => r === 'mandatory' || r === 'optional' || r === 'na')
  if (reqs.includes('mandatory')) return 'mandatory'
  if (reqs.includes('optional')) return 'optional'
  if (reqs.length > 0 && reqs.every((r) => r === 'na')) return 'na'
  return (a.default_requirement as Requirement) ?? 'optional'
}

/** Record the reminder; returns false if already sent (sent_reminders unique key). */
async function claim(db: Db, kind: string, refId: string, memberId: string, bucket: Bucket): Promise<boolean> {
  const { error } = await db.from('sent_reminders').insert({ kind, ref_id: refId, member_id: memberId, bucket })
  return !error
}

/** Deliver a member reminder via the course's enabled channels (in-app + email). */
async function deliverReminder(db: Db, memberId: string, email: string | null, moduleId: string, dueAt: string, s: Settings) {
  if (s.remind_inapp) {
    await db.from('community_notifications').insert({
      recipient_member_id: memberId,
      type: 'session_reminder',
      reference_type: 'training_module',
      reference_id: moduleId,
      body: `Training due ${formatDateShort(dueAt)} — you still have lessons to complete.`,
    })
  }
  if (s.remind_email && email) {
    await sendEmail({
      to: email,
      subject: 'Required training reminder',
      html: `<p>Your required training is due ${formatDateShort(dueAt)}. Sign in to Stellr and open Academy &rsaquo; Training to finish your lessons.</p>`,
      text: `Your required training is due ${formatDateShort(dueAt)}. Finish your lessons in Academy → Training.`,
    })
  }
}

/** Escalate overdue mandatory training to supervising adults. */
async function escalate(
  db: Db,
  supervisors: { teacherEmail?: string | null; teacherName?: string | null; memberIds: string[] },
  studentName: string,
  dueAt: string
) {
  const due = formatDateShort(dueAt)
  if (supervisors.teacherEmail) {
    await sendEmail({
      to: supervisors.teacherEmail,
      subject: 'Mandatory training overdue for a group member',
      html: `<p>Hi ${supervisors.teacherName ?? 'there'},</p><p><strong>${studentName}</strong> has not completed mandatory training that was due ${due}.</p>`,
      text: `${studentName} has not completed mandatory training due ${due}.`,
    })
  }
  for (const mid of supervisors.memberIds) {
    await notifyMember(mid, {
      type: 'session_reminder',
      body: `${studentName} has not completed mandatory training that was due ${due}.`,
      email: {
        subject: 'Mandatory training overdue for a group member',
        html: `<p><strong>${studentName}</strong> has not completed mandatory training that was due ${due}.</p>`,
        text: `${studentName} has not completed mandatory training due ${due}.`,
      },
    })
  }
}

export interface ReminderResult { reminded: number; escalated: number }

export async function runTrainingReminders(): Promise<ReminderResult> {
  const db = supabaseServer()
  const now = Date.now()
  let reminded = 0
  let escalated = 0

  /* ── Pass 1: legacy event assignments (training_assignments) ── */
  const { data: legacy } = await db
    .from('training_assignments')
    .select('id, module_id, event_ref, event_role, is_mandatory, due_at')
    .not('due_at', 'is', null)

  if (legacy?.length) {
    const settings = await settingsByModule(db, legacy.map((a) => a.module_id as string))
    const items = await publishedItems(db, legacy.map((a) => a.module_id as string))
    const events = await getEventsByIds([...new Set(legacy.map((a) => a.event_ref as string))])
    const slugByRef = new Map(events.map((e) => [e._id, e.slug.current]))

    for (const a of legacy) {
      const s = settings.get(a.module_id as string) ?? DEFAULTS
      const due = new Date(a.due_at as string).getTime()
      const bucket = bucketFor(due, now, s)
      if (!bucket) continue
      if (bucket !== 'overdue' && !(s.remind_inapp || s.remind_email)) continue
      const slug = slugByRef.get(a.event_ref as string)
      if (!slug) continue
      const itemIds = items.get(a.module_id as string) ?? []
      if (itemIds.length === 0) continue

      const { data: regs } = await db.from('registrations').select('id, teacher_email, teacher_first_name').eq('event_slug', slug)
      const regById = new Map((regs ?? []).map((r) => [r.id as string, r]))
      const regIds = [...regById.keys()]
      if (regIds.length === 0) continue

      let pq = db.from('participants').select('member_id, first_name, last_name, event_role, registration_id').in('registration_id', regIds).not('member_id', 'is', null)
      if (a.event_role !== 'all') pq = pq.eq('event_role', a.event_role)
      const { data: parts } = await pq
      if (!parts?.length) continue

      // SM members per registration (for escalation alongside the teacher).
      const smByReg = new Map<string, string[]>()
      for (const p of parts) {
        if (p.event_role === 'school_student_manager') {
          const arr = smByReg.get(p.registration_id as string) ?? []
          arr.push(p.member_id as string)
          smByReg.set(p.registration_id as string, arr)
        }
      }

      const memberIds = parts.map((p) => p.member_id as string)
      const completed = await completedByMember(db, memberIds, itemIds)

      for (const p of parts) {
        const mid = p.member_id as string
        if ((completed.get(mid)?.size ?? 0) >= itemIds.length) continue // done

        if (bucket === 'overdue') {
          if (!a.is_mandatory || !s.escalate_supervisor) continue
          if (!(await claim(db, 'training_escalation', a.id as string, mid, bucket))) continue
          const reg = regById.get(p.registration_id as string) as { teacher_email?: string; teacher_first_name?: string } | undefined
          await escalate(
            db,
            { teacherEmail: reg?.teacher_email, teacherName: reg?.teacher_first_name, memberIds: (smByReg.get(p.registration_id as string) ?? []).filter((id) => id !== mid) },
            `${p.first_name} ${p.last_name}`,
            a.due_at as string
          )
          escalated++
        } else {
          if (!(await claim(db, 'training', a.id as string, mid, bucket))) continue
          const { data: m } = await db.from('members').select('email').eq('id', mid).maybeSingle()
          await deliverReminder(db, mid, (m?.email as string | null) ?? null, a.module_id as string, a.due_at as string, s)
          reminded++
        }
      }
    }
  }

  /* ── Pass 2: new per-Object assignments (course_object_assignments) ── */
  const { data: rich } = await db
    .from('course_object_assignments')
    .select('id, module_id, object_type, object_ref, default_requirement, tier_requirements, due_at')
    .not('due_at', 'is', null)

  if (rich?.length) {
    const settings = await settingsByModule(db, rich.map((a) => a.module_id as string))
    const items = await publishedItems(db, rich.map((a) => a.module_id as string))

    for (const a of rich) {
      const s = settings.get(a.module_id as string) ?? DEFAULTS
      const due = new Date(a.due_at as string).getTime()
      const bucket = bucketFor(due, now, s)
      if (!bucket) continue
      if (bucket !== 'overdue' && !(s.remind_inapp || s.remind_email)) continue
      const itemIds = items.get(a.module_id as string) ?? []
      if (itemIds.length === 0) continue

      const objectType = a.object_type as string
      const isEvent = objectType === 'competition' || objectType === 'campaign'

      // Resolve participants + escalation contacts for this Object.
      interface P { memberId: string; name: string; tierIds: string[]; teacherEmail?: string | null; teacherName?: string | null; supervisorIds: string[] }
      let people: P[] = []

      if (isEvent) {
        const slug = a.object_ref as string
        const { data: regs } = await db.from('registrations').select('id, teacher_email, teacher_first_name').eq('event_slug', slug)
        const regById = new Map((regs ?? []).map((r) => [r.id as string, r]))
        const regIds = [...regById.keys()]
        if (regIds.length === 0) continue
        const { data: parts } = await db.from('participants').select('member_id, first_name, last_name, event_role, registration_id').in('registration_id', regIds).not('member_id', 'is', null)
        if (!parts?.length) continue
        const smByReg = new Map<string, string[]>()
        for (const p of parts) if (p.event_role === 'school_student_manager') {
          const arr = smByReg.get(p.registration_id as string) ?? []; arr.push(p.member_id as string); smByReg.set(p.registration_id as string, arr)
        }
        const tiers = await memberTierIds(db, parts.map((p) => p.member_id as string))
        people = parts.map((p) => {
          const reg = regById.get(p.registration_id as string) as { teacher_email?: string; teacher_first_name?: string } | undefined
          return {
            memberId: p.member_id as string,
            name: `${p.first_name} ${p.last_name}`,
            tierIds: tiers.get(p.member_id as string) ?? [],
            teacherEmail: reg?.teacher_email,
            teacherName: reg?.teacher_first_name,
            supervisorIds: (smByReg.get(p.registration_id as string) ?? []).filter((id) => id !== p.member_id),
          }
        })
      } else {
        // cohort / workshop / space — members + the cohort mentor as supervisor.
        const cohortId = a.object_ref as string
        const [{ data: cohort }, { data: members }] = await Promise.all([
          db.from('mentoring_cohorts').select('mentor_member_id').eq('id', cohortId).maybeSingle(),
          db.from('cohort_members').select('member_id, members(first_name, last_name)').eq('cohort_id', cohortId),
        ])
        if (!members?.length) continue
        const mentorId = (cohort?.mentor_member_id as string | null) ?? null
        const tiers = await memberTierIds(db, members.map((m) => m.member_id as string))
        people = members.map((cm) => {
          const m = Array.isArray(cm.members) ? cm.members[0] : cm.members
          const mm = m as { first_name?: string; last_name?: string } | null
          return {
            memberId: cm.member_id as string,
            name: [mm?.first_name, mm?.last_name].filter(Boolean).join(' ') || 'Member',
            tierIds: tiers.get(cm.member_id as string) ?? [],
            supervisorIds: mentorId && mentorId !== cm.member_id ? [mentorId] : [],
          }
        })
      }

      const completed = await completedByMember(db, people.map((p) => p.memberId), itemIds)

      for (const p of people) {
        if (reqForTiers(a, p.tierIds) !== 'mandatory') continue // only nag for mandatory
        if ((completed.get(p.memberId)?.size ?? 0) >= itemIds.length) continue

        if (bucket === 'overdue') {
          if (!s.escalate_supervisor) continue
          if (!(await claim(db, 'training_obj_escalation', a.id as string, p.memberId, bucket))) continue
          await escalate(db, { teacherEmail: p.teacherEmail, teacherName: p.teacherName, memberIds: p.supervisorIds }, p.name, a.due_at as string)
          escalated++
        } else {
          if (!(await claim(db, 'training_obj', a.id as string, p.memberId, bucket))) continue
          const { data: m } = await db.from('members').select('email').eq('id', p.memberId).maybeSingle()
          await deliverReminder(db, p.memberId, (m?.email as string | null) ?? null, a.module_id as string, a.due_at as string, s)
          reminded++
        }
      }
    }
  }

  return { reminded, escalated }
}
