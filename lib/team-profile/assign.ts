// Company planning for one event: everything the Auto-Assign button, the
// best-fit suggestions and the admin "Team profiles" panel need, loaded once.
//
// Students = non-withdrawn participants in STUDENT_ROLES (school students and
// student managers). Only students who SUBMITTED a team profile are placed by
// Auto-Assign; the rest go to the pool for staff to place by hand (David,
// 7 Oct 2026), each with a best-fit suggestion.

import type { SupabaseClient } from '@supabase/supabase-js'
import { ageOn, onDate } from '@/lib/age'
import { STUDENT_ROLES } from '@/lib/membership-rules'
import { assignCompanies, suggestCompanies, type AssignableStudent } from '@/lib/company-assign'
import { normaliseAnswers, type TeamProfileAnswers } from './questions'
import { leaderScore, matchTeammates, normaliseSchool, skillVector, type TeammateMatch } from './vectors'
import { formsComplete } from './store'

export type ProfileStatus = 'waiting' | 'not_sent' | 'sent' | 'submitted'

export interface PlanningStudent {
  participantId: string
  firstName: string
  lastName: string
  school: string | null
  grade: string | null
  gender: string | null
  age: number | null
  ethnicity: string[]
  /** Previous Stellr events (confirmed registrations made before this one). */
  experience: number
  registrationId: string
  isGroup: boolean
  companyId: string | null
  companyNumber: number | null
  locked: boolean
  status: ProfileStatus
  lastSentAt: string | null
  sendCount: number
  lastSendError: string | null
  submittedAt: string | null
  answers: TeamProfileAnswers | null
  teammates: TeammateMatch[]
  /** Best-fit company for an unplaced student; null when placed or no companies yet. */
  suggestedCompany: number | null
}

export interface CompanyPlan {
  companies: { id: string; number: number; name: string | null }[]
  students: PlanningStudent[]
}

const gradeNumber = (g: string | null) => {
  const m = /(\d{1,2})/.exec(g ?? '')
  return m ? Number(m[1]) : null
}

export async function loadCompanyPlan(db: SupabaseClient, slug: string, eventDate: string | null): Promise<CompanyPlan> {
  const [{ data: companies, error: cErr }, { data: regs, error: rErr }, { data: profiles, error: pErr }] = await Promise.all([
    db.from('event_companies').select('id, number, name').eq('event_slug', slug).order('number'),
    db
      .from('registrations')
      .select('id, type, created_at, participants(id, member_id, first_name, last_name, event_role, gender, date_of_birth, grade, school_name, ethnicity, company_id, company_locked)')
      .eq('event_slug', slug)
      .neq('status', 'withdrawn'),
    db
      .from('team_profiles')
      .select('participant_id, answers, submitted_at, last_sent_at, send_count, last_send_error')
      .eq('event_slug', slug),
  ])
  if (cErr || rErr || pErr) throw new Error(`Loading company plan failed: ${(cErr ?? rErr ?? pErr)!.message}`)

  const companyNumber = new Map((companies ?? []).map((c) => [c.id as string, c.number as number]))
  const profileOf = new Map((profiles ?? []).map((p) => [p.participant_id as string, p]))
  const on = eventDate ? onDate(eventDate) : undefined

  type Raw = Record<string, unknown>
  const rows: { p: Raw; reg: Raw }[] = []
  for (const reg of regs ?? []) {
    for (const p of ((reg as Raw).participants as Raw[]) ?? []) {
      if (STUDENT_ROLES.includes((p.event_role as string) ?? '')) rows.push({ p, reg: reg as Raw })
    }
  }

  // Experience: this member's confirmed registrations for OTHER events made
  // before this registration.
  const memberIds = [...new Set(rows.map((r) => r.p.member_id as string | null).filter((x): x is string => !!x))]
  const history = new Map<string, { slug: string; at: string }[]>()
  for (let i = 0; i < memberIds.length; i += 150) {
    const { data } = await db
      .from('participants')
      .select('member_id, registrations!inner(event_slug, status, created_at)')
      .in('member_id', memberIds.slice(i, i + 150))
      .eq('registrations.status', 'confirmed')
      .neq('registrations.event_slug', slug)
    for (const h of data ?? []) {
      const r = (Array.isArray(h.registrations) ? h.registrations[0] : h.registrations) as { event_slug: string; created_at: string }
      const list = history.get(h.member_id as string) ?? []
      list.push({ slug: r.event_slug, at: r.created_at })
      history.set(h.member_id as string, list)
    }
  }

  // Ethnicity: the participant row, else the member's profile.
  const ethnicityByMember = new Map<string, string[]>()
  const needEthnicity = rows.filter((r) => !((r.p.ethnicity as string[] | null)?.length) && r.p.member_id).map((r) => r.p.member_id as string)
  for (let i = 0; i < needEthnicity.length; i += 150) {
    const { data } = await db
      .from('member_ethnicities')
      .select('member_id, ethnicity_options(name)')
      .in('member_id', needEthnicity.slice(i, i + 150))
    for (const e of data ?? []) {
      const opt = (Array.isArray(e.ethnicity_options) ? e.ethnicity_options[0] : e.ethnicity_options) as { name: string } | null
      if (!opt?.name) continue
      ethnicityByMember.set(e.member_id as string, [...(ethnicityByMember.get(e.member_id as string) ?? []), opt.name])
    }
  }

  const ready = await formsComplete(
    db,
    rows.map((r) => ({ id: r.p.id as string, date_of_birth: r.p.date_of_birth as string | null, event_slug: slug })),
    new Map([[slug, eventDate]]),
  )

  const roster = rows.map((r) => ({
    participantId: r.p.id as string,
    firstName: (r.p.first_name as string) ?? '',
    lastName: (r.p.last_name as string) ?? '',
  }))

  const students: PlanningStudent[] = rows.map(({ p, reg }) => {
    const id = p.id as string
    const prof = profileOf.get(id)
    const submitted = !!prof?.submitted_at
    const answers = submitted ? normaliseAnswers(prof!.answers) : null
    const dob = p.date_of_birth as string | null
    const grade = gradeNumber(p.grade as string | null)
    const age = dob ? ageOn(dob, on) : grade !== null ? grade + 5.5 : null
    const regAt = reg.created_at as string
    const memberId = p.member_id as string | null
    const experience = memberId
      ? new Set((history.get(memberId) ?? []).filter((h) => h.at < regAt).map((h) => h.slug)).size
      : 0
    const companyId = (p.company_id as string | null) ?? null
    return {
      participantId: id,
      firstName: (p.first_name as string) ?? '',
      lastName: (p.last_name as string) ?? '',
      school: (p.school_name as string | null) ?? null,
      grade: (p.grade as string | null) ?? null,
      gender: (p.gender as string | null) ?? null,
      age,
      ethnicity: ((p.ethnicity as string[] | null)?.length ? (p.ethnicity as string[]) : memberId ? ethnicityByMember.get(memberId) : null) ?? [],
      experience,
      registrationId: reg.id as string,
      isGroup: reg.type === 'group',
      companyId,
      companyNumber: companyId ? companyNumber.get(companyId) ?? null : null,
      locked: !!p.company_locked,
      status: submitted ? 'submitted' : prof?.last_sent_at ? 'sent' : ready.has(id) ? 'not_sent' : 'waiting',
      lastSentAt: (prof?.last_sent_at as string | null) ?? null,
      sendCount: (prof?.send_count as number | null) ?? 0,
      lastSendError: (prof?.last_send_error as string | null) ?? null,
      submittedAt: (prof?.submitted_at as string | null) ?? null,
      answers,
      teammates: answers ? matchTeammates(answers.teammates, roster, id) : [],
      suggestedCompany: null,
    }
  })

  const count = (companies ?? []).length
  const placed = students.filter((s) => s.companyNumber !== null)
  const unplaced = students.filter((s) => s.companyNumber === null)
  if (count > 0 && placed.length > 0 && unplaced.length > 0) {
    const suggestions = suggestCompanies(
      placed.map((s) => ({ ...toAssignable(s), company: s.companyNumber! })),
      unplaced.map(toAssignable),
      count,
    )
    for (const s of unplaced) s.suggestedCompany = suggestions.get(s.participantId) ?? null
  }

  return { companies: (companies ?? []) as CompanyPlan['companies'], students }
}

export function toAssignable(s: PlanningStudent): AssignableStudent {
  return {
    participantId: s.participantId,
    groupKey: s.isGroup ? s.registrationId : null,
    school: normaliseSchool(s.school),
    gender: s.gender,
    age: s.age,
    experience: s.experience,
    ethnicity: s.ethnicity,
    skills: s.answers ? skillVector(s.answers) : null,
    leader: s.answers ? leaderScore(s.answers) : null,
    teammateIds: s.teammates.map((t) => t.participantId).filter((x): x is string => !!x),
    lockedCompany: s.locked ? s.companyNumber : null,
  }
}

export interface AutoAssignResult {
  assigned: number
  /** Students without a submitted team profile, left unassigned for staff. */
  pooled: number
  kept: number
}

/**
 * Auto-Assign: places every student who submitted a team profile, keeps hand-
 * placed students where they are, and leaves everyone else unassigned.
 */
export async function autoAssign(db: SupabaseClient, slug: string, eventDate: string | null): Promise<AutoAssignResult> {
  const plan = await loadCompanyPlan(db, slug, eventDate)
  if (plan.companies.length === 0) throw new AssignError('Set the number of companies first')
  const locked = plan.students.filter((s) => s.locked && s.companyNumber !== null)
  const responders = plan.students.filter((s) => s.status === 'submitted' && !(s.locked && s.companyNumber !== null))
  const pool = plan.students.filter((s) => s.status !== 'submitted' && !(s.locked && s.companyNumber !== null))
  if (responders.length === 0) throw new AssignError('No students have submitted a team profile yet')

  const result = assignCompanies([...locked, ...responders].map(toAssignable), plan.companies.length)
  const idByNumber = new Map(plan.companies.map((c) => [c.number, c.id]))

  const byCompany = new Map<string | null, string[]>()
  for (const s of responders) {
    const target = idByNumber.get(result.get(s.participantId)!) ?? null
    byCompany.set(target, [...(byCompany.get(target) ?? []), s.participantId])
  }
  byCompany.set(null, [...(byCompany.get(null) ?? []), ...pool.map((s) => s.participantId)])
  for (const [companyId, ids] of byCompany) {
    for (let i = 0; i < ids.length; i += 150) {
      const { error } = await db
        .from('participants')
        .update({ company_id: companyId, company_locked: false })
        .in('id', ids.slice(i, i + 150))
      if (error) throw new Error(`Saving assignments failed: ${error.message}`)
    }
  }
  return { assigned: responders.length, pooled: pool.length, kept: locked.length }
}

export class AssignError extends Error {}
