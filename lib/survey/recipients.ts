/**
 * Who is invited to an event's survey, and at which address.
 *
 * Sources (prod, 2 Oct 2026: `participants` holds only students):
 *   - participants on the event's live registrations (students; adults on some rosters)
 *   - each registration's teacher and point of contact (registrations.teacher_*)
 *   - members with an event_participations row for the event (volunteers → mentor path)
 * Adults recorded only as registrations.adult_count cannot be surveyed; the
 * preview shows that count.
 *
 * One invitation per person: deduplicated by member, then lower-cased email.
 *
 * Minors (lib/survey/minor.ts) are invited only under a current V2.3+ agreement
 * (lib/survey/consent.ts); the rest are listed as "awaiting V2.3 consent". A
 * minor's invitation goes to the student, or to the guardian alone when the
 * guardian ticked §4 "no direct digital communications", or the student has no
 * address of their own. Never to both.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RespondentRole } from './definition'
import type { AdultRelationship } from './branching'
import { isMinorPerPolicy } from './minor'
import { loadMinorConsents, NO_CONSENT, type MinorConsent } from './consent'

export type Audience = RespondentRole

/** members.event_role / participants.event_role → survey path (handover A1). */
export function pathForRole(role: string | null | undefined): { role: RespondentRole; relationship: AdultRelationship | null } | null {
  switch ((role ?? '').trim()) {
    case 'participant':
    case 'school_student':
    case 'student':
      return { role: 'student', relationship: null }
    case 'mentor':
    case 'volunteer':
      return { role: 'mentor', relationship: null }
    case 'teacher':
    case 'school_student_manager':
      return { role: 'adult', relationship: 'teacher' }
    case 'parent':
      return { role: 'adult', relationship: 'parent' }
    case 'adult':
      return { role: 'adult', relationship: null }
    default:
      return null // donor, subscriber, unknown: not surveyed
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function cleanEmail(e: string | null | undefined): string | null {
  const s = e?.trim().toLowerCase()
  return s && EMAIL.test(s) ? s : null
}

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface Person {
  /** Where this record came from, for the preview. */
  source: 'participant' | 'teacher' | 'contact' | 'volunteer' | 'attendee'
  participantId: string | null
  memberId: string | null
  firstName: string | null
  lastName: string | null
  email: string | null
  eventRole: string | null
  dateOfBirth: string | null
  grade: string | null
  ageBracket: string | null
  state: string | null
  /** Guardian address on file outside the agreement (participant emergency contact, members.ec_email). */
  guardianEmail: string | null
  guardianFirstName: string | null
}

export interface PlannedInvitation {
  recipientKey: string
  participantId: string | null
  memberId: string | null
  role: RespondentRole
  adultRelationship: AdultRelationship | null
  firstName: string | null
  lastName: string | null
  isMinor: boolean
  email: string
  sendVia: 'self' | 'guardian'
  sources: Person['source'][]
}

export interface Unreachable {
  name: string
  role: RespondentRole
  source: Person['source']
  participantId: string | null
  memberId: string | null
  reason: 'no_email' | 'no_guardian_email'
}

export interface AwaitingConsent {
  name: string
  participantId: string | null
  memberId: string | null
  agreementVersion: string | null
  reason: 'no_agreement' | 'older_version' | 'restricted'
}

export interface RecipientPlan {
  invitable: PlannedInvitation[]
  unreachable: Unreachable[]
  awaitingConsent: AwaitingConsent[]
  /** registrations.adult_count beyond the adults named on the roster. */
  headcountOnlyAdults: number
  notSurveyed: number
}

const ROLE_PRIORITY: Record<RespondentRole, number> = { student: 0, mentor: 1, adult: 2 }

function personKey(p: Pick<Person, 'memberId' | 'email'>): string | null {
  if (p.memberId) return `member:${p.memberId}`
  const e = cleanEmail(p.email)
  return e ? `email:${e}` : null
}

/** Consent for a person, looked up by member and by participant (either may hold the agreement). */
export function consentFor(consents: Map<string, MinorConsent>, p: Pick<Person, 'memberId' | 'participantId'>): MinorConsent {
  const found = [p.memberId && `member:${p.memberId}`, p.participantId && `participant:${p.participantId}`]
    .filter(Boolean)
    .map((k) => consents.get(k as string))
    .filter(Boolean) as MinorConsent[]
  return found.find((c) => c.coversSurveys) ?? found.find((c) => c.agreementId) ?? found[0] ?? NO_CONSENT
}

const nameOf = (p: Person) => [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || p.email || 'Unnamed'

/**
 * Pure planning step: people + consents → invitations, gaps and holds.
 * `eventDay` is the event's last day, the date ages are taken on.
 */
export function planRecipients(
  people: Person[],
  consents: Map<string, MinorConsent>,
  audiences: Audience[],
  eventDay: string,
  headcountOnlyAdults = 0,
): RecipientPlan {
  const want = new Set(audiences)
  const plan: RecipientPlan = { invitable: [], unreachable: [], awaitingConsent: [], headcountOnlyAdults, notSurveyed: 0 }

  // Collapse the same person across sources (member first, then email).
  type Merged = { person: Person; role: RespondentRole; relationship: AdultRelationship | null; sources: Person['source'][] }
  const byKey = new Map<string, Merged>()
  const emailToKey = new Map<string, string>()
  const anonymous: Merged[] = []

  for (const p of people) {
    const path = pathForRole(p.eventRole)
    if (!path) {
      plan.notSurveyed++
      continue
    }
    const email = cleanEmail(p.email)
    let key = personKey(p)
    if (email && emailToKey.has(email)) key = emailToKey.get(email)!
    const entry: Merged = { person: p, role: path.role, relationship: path.relationship, sources: [p.source] }
    if (!key) {
      anonymous.push(entry)
      continue
    }
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, entry)
    } else {
      existing.sources.push(p.source)
      // Keep the most specific record: a student row beats a contact row, and fill gaps.
      if (ROLE_PRIORITY[path.role] < ROLE_PRIORITY[existing.role]) {
        existing.role = path.role
        existing.relationship = path.relationship
        existing.person = { ...p, memberId: p.memberId ?? existing.person.memberId, participantId: p.participantId ?? existing.person.participantId }
      } else {
        existing.person = {
          ...existing.person,
          memberId: existing.person.memberId ?? p.memberId,
          participantId: existing.person.participantId ?? p.participantId,
          dateOfBirth: existing.person.dateOfBirth ?? p.dateOfBirth,
          grade: existing.person.grade ?? p.grade,
          state: existing.person.state ?? p.state,
          guardianEmail: existing.person.guardianEmail ?? p.guardianEmail,
          guardianFirstName: existing.person.guardianFirstName ?? p.guardianFirstName,
        }
        existing.relationship = existing.relationship ?? path.relationship
      }
    }
    if (email) emailToKey.set(email, key)
  }

  for (const m of [...byKey.entries()].map(([k, v]) => ({ key: k, ...v })).concat(anonymous.map((a) => ({ key: '', ...a })))) {
    if (!want.has(m.role)) continue
    const p = m.person
    const base = { name: nameOf(p), role: m.role, source: p.source, participantId: p.participantId, memberId: p.memberId }
    const isMinor =
      m.role === 'student' &&
      isMinorPerPolicy(
        { dateOfBirth: p.dateOfBirth, state: p.state, ageBracket: p.ageBracket, grade: p.grade, presumeMinorIfUnknown: true },
        eventDay,
      )

    let email = cleanEmail(p.email)
    let sendVia: 'self' | 'guardian' = 'self'
    if (isMinor) {
      const c = consentFor(consents, p)
      if (!c.coversSurveys) {
        plan.awaitingConsent.push({
          name: base.name,
          participantId: p.participantId,
          memberId: p.memberId,
          agreementVersion: c.agreementVersion,
          reason: c.restricted ? 'restricted' : c.agreementId ? 'older_version' : 'no_agreement',
        })
        continue
      }
      const guardian = cleanEmail(c.guardianEmail) ?? cleanEmail(p.guardianEmail)
      if (c.digitalCommsOptOut || !email || email === guardian) {
        if (!guardian) {
          plan.unreachable.push({ ...base, reason: 'no_guardian_email' })
          continue
        }
        email = guardian
        sendVia = 'guardian'
      }
    }
    if (!email) {
      plan.unreachable.push({ ...base, reason: 'no_email' })
      continue
    }
    plan.invitable.push({
      recipientKey: m.key || `email:${email}`,
      participantId: p.participantId,
      memberId: p.memberId,
      role: m.role,
      adultRelationship: m.role === 'adult' ? m.relationship : null,
      firstName: p.firstName,
      lastName: p.lastName,
      isMinor,
      email,
      sendVia,
      sources: m.sources,
    })
  }

  plan.invitable.sort((a, b) => (a.lastName ?? '').localeCompare(b.lastName ?? '') || (a.firstName ?? '').localeCompare(b.firstName ?? ''))
  return plan
}

// ── Loading ──────────────────────────────────────────────────────────────────

interface MemberRow {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  date_of_birth: string | null
  grade: string | null
  age_bracket: string | null
  event_role: string | null
  ec_email: string | null
  ec_first_name: string | null
}

async function memberSchoolStates(db: SupabaseClient, memberIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let i = 0; i < memberIds.length; i += 200) {
    const { data, error } = await db
      .from('member_schools')
      .select('member_id, is_current, schools(state)')
      .in('member_id', memberIds.slice(i, i + 200))
    if (error) throw new Error(`Reading member schools failed: ${error.message}`)
    for (const r of (data ?? []) as unknown as { member_id: string; is_current: boolean | null; schools: { state: string | null } | null }[]) {
      const st = r.schools?.state
      if (st && (r.is_current || !out.has(r.member_id))) out.set(r.member_id, st)
    }
  }
  return out
}

export async function loadEventPeople(db: SupabaseClient, slug: string): Promise<{ people: Person[]; headcountOnlyAdults: number }> {
  const { data: regs, error: regErr } = await db
    .from('registrations')
    .select('id, status, teacher_first_name, teacher_last_name, teacher_email, teacher_member_id, teacher_poc_first_name, teacher_poc_last_name, teacher_poc_email, school_address_state, adult_count')
    .eq('event_slug', slug)
    .neq('status', 'withdrawn')
  if (regErr) throw new Error(`Reading registrations failed: ${regErr.message}`)
  const regRows = regs ?? []
  const regIds = regRows.map((r) => r.id as string)
  const regState = new Map(regRows.map((r) => [r.id as string, (r.school_address_state as string | null) ?? null]))

  const participants: Record<string, unknown>[] = []
  for (let i = 0; i < regIds.length; i += 200) {
    const { data, error } = await db
      .from('participants')
      .select('id, registration_id, first_name, last_name, email, date_of_birth, grade, age_bracket, event_role, member_id, emergency_contact_email, emergency_contact_first_name')
      .in('registration_id', regIds.slice(i, i + 200))
    if (error) throw new Error(`Reading participants failed: ${error.message}`)
    participants.push(...(data ?? []))
  }

  const { data: eps, error: epErr } = await db
    .from('event_participations')
    .select('member_id, role')
    .eq('event_slug', slug)
  if (epErr) throw new Error(`Reading event participations failed: ${epErr.message}`)

  const memberIds = new Set<string>()
  for (const p of participants) if (p.member_id) memberIds.add(p.member_id as string)
  for (const r of regRows) if (r.teacher_member_id) memberIds.add(r.teacher_member_id as string)
  for (const e of eps ?? []) if (e.member_id) memberIds.add(e.member_id as string)
  const ids = [...memberIds]

  const members = new Map<string, MemberRow>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db
      .from('members')
      .select('id, first_name, last_name, email, date_of_birth, grade, age_bracket, event_role, ec_email, ec_first_name')
      .in('id', ids.slice(i, i + 200))
    if (error) throw new Error(`Reading members failed: ${error.message}`)
    for (const m of (data ?? []) as MemberRow[]) members.set(m.id, m)
  }
  const states = await memberSchoolStates(db, ids)

  const people: Person[] = []
  const namedAdults = new Map<string, number>()
  for (const p of participants) {
    const m = p.member_id ? members.get(p.member_id as string) : undefined
    const role = (p.event_role as string | null) ?? 'participant'
    if (pathForRole(role)?.role !== 'student') {
      namedAdults.set(p.registration_id as string, (namedAdults.get(p.registration_id as string) ?? 0) + 1)
    }
    people.push({
      source: 'participant',
      participantId: p.id as string,
      memberId: (p.member_id as string | null) ?? null,
      firstName: (p.first_name as string | null) ?? m?.first_name ?? null,
      lastName: (p.last_name as string | null) ?? m?.last_name ?? null,
      email: (p.email as string | null) ?? m?.email ?? null,
      eventRole: role,
      dateOfBirth: (p.date_of_birth as string | null) ?? m?.date_of_birth ?? null,
      grade: (p.grade as string | null) ?? m?.grade ?? null,
      ageBracket: (p.age_bracket as string | null) ?? m?.age_bracket ?? null,
      state: (m && states.get(m.id)) ?? regState.get(p.registration_id as string) ?? null,
      guardianEmail: (p.emergency_contact_email as string | null) ?? m?.ec_email ?? null,
      guardianFirstName: (p.emergency_contact_first_name as string | null) ?? m?.ec_first_name ?? null,
    })
  }

  let headcountOnlyAdults = 0
  for (const r of regRows) {
    const tm = r.teacher_member_id ? members.get(r.teacher_member_id as string) : undefined
    if (r.teacher_email || tm) {
      people.push({
        source: 'teacher',
        participantId: null,
        memberId: (r.teacher_member_id as string | null) ?? null,
        firstName: (r.teacher_first_name as string | null) ?? tm?.first_name ?? null,
        lastName: (r.teacher_last_name as string | null) ?? tm?.last_name ?? null,
        email: (r.teacher_email as string | null) ?? tm?.email ?? null,
        eventRole: 'teacher',
        dateOfBirth: null,
        grade: null,
        ageBracket: 'adult',
        state: null,
        guardianEmail: null,
        guardianFirstName: null,
      })
    }
    if (r.teacher_poc_email) {
      people.push({
        source: 'contact',
        participantId: null,
        memberId: null,
        firstName: (r.teacher_poc_first_name as string | null) ?? null,
        lastName: (r.teacher_poc_last_name as string | null) ?? null,
        email: r.teacher_poc_email as string,
        eventRole: 'teacher',
        dateOfBirth: null,
        grade: null,
        ageBracket: 'adult',
        state: null,
        guardianEmail: null,
        guardianFirstName: null,
      })
    }
    const named = (namedAdults.get(r.id as string) ?? 0) + (r.teacher_email || tm ? 1 : 0)
    headcountOnlyAdults += Math.max(0, ((r.adult_count as number | null) ?? 0) - named)
  }

  for (const e of eps ?? []) {
    const m = members.get(e.member_id as string)
    if (!m) continue
    people.push({
      source: e.role === 'volunteer' ? 'volunteer' : 'attendee',
      participantId: null,
      memberId: m.id,
      firstName: m.first_name,
      lastName: m.last_name,
      email: m.email,
      eventRole: e.role === 'volunteer' ? 'volunteer' : m.event_role,
      dateOfBirth: m.date_of_birth,
      grade: m.grade,
      ageBracket: m.age_bracket,
      state: states.get(m.id) ?? null,
      guardianEmail: m.ec_email,
      guardianFirstName: m.ec_first_name,
    })
  }

  return { people, headcountOnlyAdults }
}

/** Everything the go-live job and the admin preview need. */
export async function buildRecipientPlan(
  db: SupabaseClient,
  slug: string,
  eventDay: string,
  audiences: Audience[],
): Promise<RecipientPlan> {
  const { people, headcountOnlyAdults } = await loadEventPeople(db, slug)
  const subjects = new Map<string, { key: string; memberId: string | null; participantId: string | null }>()
  for (const p of people) {
    if (pathForRole(p.eventRole)?.role !== 'student') continue
    if (p.memberId) subjects.set(`member:${p.memberId}`, { key: `member:${p.memberId}`, memberId: p.memberId, participantId: null })
    if (p.participantId) subjects.set(`participant:${p.participantId}`, { key: `participant:${p.participantId}`, memberId: null, participantId: p.participantId })
  }
  const consents = await loadMinorConsents(db, [...subjects.values()])
  return planRecipients(people, consents, audiences, eventDay, headcountOnlyAdults)
}
