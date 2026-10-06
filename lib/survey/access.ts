/**
 * A respondent's survey session — reached by an emailed token link or from the
 * member dashboard — and the three things they can do: open, autosave, submit.
 *
 * Token links work signed out (sign-in would cost responses). If the invitation
 * belongs to a member and someone signed in as a *different* member opens it,
 * it is refused. History (P3) is never reachable by token.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Option, OptionsSource, SurveyDefinition } from './definition'
import type { SurveyContext, ProfileField, Answers } from './branching'
import { visiblePages } from './branching'
import { flattenAnswers, missingRequired, sanitiseDraft, type RuntimeOptions } from './answers'
import { getDistribution, loadDefinition, statusNow, type DefinitionRow, type DistributionRow } from './distributions'
import type { InvitationRow } from './send'
import { hashToken, looksLikeToken } from './tokens'
import { ageIfKnown, isMinorPerPolicy } from './minor'
import { defaultAllowQuotes, loadMinorConsents } from './consent'
import { logActivity } from '@/lib/activity-log'

export type OpenedFrom = 'email' | 'dashboard' | 'qr'

export interface ResponseRow {
  id: string
  invitation_id: string | null
  definition_id: string
  distribution_id: string | null
  event_slug: string | null
  event_year: number | null
  participant_id: string | null
  member_id: string | null
  respondent_role: 'student' | 'mentor' | 'adult' | null
  context: SurveyContext
  draft_answers: Answers
  current_page: string | null
  started_at: string | null
  last_saved_at: string | null
  submitted_at: string | null
  submitted_from: OpenedFrom | null
  is_minor_at_submit: boolean | null
  quote_consent: string | null
  no_quote: boolean | null
  followup_consent: boolean | null
  quote_withdrawn_at: string | null
}

export type SessionState = 'scheduled' | 'paused' | 'closed' | 'submitted' | 'open'

export interface SurveySession {
  invitation: InvitationRow
  distribution: DistributionRow
  definitionRow: DefinitionRow
  def: SurveyDefinition
  response: ResponseRow | null
  state: SessionState
}

// ── Finding the invitation ───────────────────────────────────────────────────

export async function invitationByToken(db: SupabaseClient, token: string): Promise<InvitationRow | null> {
  if (!looksLikeToken(token)) return null
  const { data, error } = await db.from('survey_invitations').select('*').eq('token_hash', hashToken(token)).maybeSingle()
  if (error) throw new Error(`Reading invitation failed: ${error.message}`)
  return (data as InvitationRow | null) ?? null
}

/** The member's participant rows — invitations made before they had an account point at these. */
export async function participantIdsFor(db: SupabaseClient, memberId: string): Promise<string[]> {
  const { data } = await db.from('participants').select('id').eq('member_id', memberId)
  return (data ?? []).map((r) => r.id as string)
}

/**
 * An invitation the signed-in member may open: theirs by member, or by one of
 * their participant rows. Guardian-addressed invitations are the student's,
 * so they match the student's account, not the guardian's.
 */
export async function invitationForMember(db: SupabaseClient, memberId: string, invitationId: string): Promise<InvitationRow | null> {
  const { data, error } = await db.from('survey_invitations').select('*').eq('id', invitationId).maybeSingle()
  if (error) throw new Error(`Reading invitation failed: ${error.message}`)
  const inv = data as InvitationRow | null
  if (!inv) return null
  if (inv.member_id === memberId) return inv
  if (inv.participant_id && (await participantIdsFor(db, memberId)).includes(inv.participant_id)) return inv
  return null
}

export async function loadSession(db: SupabaseClient, inv: InvitationRow, now = new Date()): Promise<SurveySession | null> {
  const distribution = await getDistribution(db, inv.distribution_id)
  if (!distribution) return null
  const { row: definitionRow, def } = await loadDefinition(db, distribution.definition_id)
  const { data: resp } = await db.from('survey_responses').select('*').eq('invitation_id', inv.id).maybeSingle()
  const response = (resp as ResponseRow | null) ?? null
  const status = statusNow(distribution, now)
  const state: SessionState = response?.submitted_at || inv.status === 'submitted' ? 'submitted' : status
  return { invitation: inv, distribution, definitionRow, def, response, state }
}

/** True when a signed-in member is someone other than the invitation's owner. */
export async function isWrongMember(db: SupabaseClient, inv: InvitationRow, signedInMemberId: string | null): Promise<boolean> {
  if (!signedInMemberId) return false
  if (inv.member_id) return inv.member_id !== signedInMemberId
  if (inv.participant_id) {
    const { data } = await db.from('participants').select('member_id').eq('id', inv.participant_id).maybeSingle()
    const owner = (data?.member_id as string | null) ?? null
    return !!owner && owner !== signedInMemberId
  }
  return false
}

// ── Context (what branching knows) ───────────────────────────────────────────

async function isFirstTime(db: SupabaseClient, inv: InvitationRow, slug: string, memberId: string | null, email: string | null): Promise<boolean> {
  if (memberId) {
    const { count } = await db
      .from('event_participations')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', memberId)
      .or(`event_slug.is.null,event_slug.neq.${slug}`)
    if ((count ?? 0) > 0) return false
  }
  if (email) {
    const { data } = await db.from('participants').select('id, registrations!inner(event_slug)').ilike('email', email).neq('registrations.event_slug', slug).limit(1)
    if (data?.length) return false
    if (inv.respondent_role === 'adult') {
      const { data: regs } = await db.from('registrations').select('id').ilike('teacher_email', email).neq('event_slug', slug).limit(1)
      if (regs?.length) return false
    }
  }
  return true
}

interface Profile {
  firstName: string | null
  dateOfBirth: string | null
  gender: string | null
  grade: string | null
  ageBracket: string | null
  hasEthnicity: boolean
  school: string | null
  schoolState: string | null
  email: string | null
}

async function loadProfile(db: SupabaseClient, inv: InvitationRow, memberId: string | null): Promise<Profile> {
  let p: Record<string, unknown> | null = null
  if (inv.participant_id) {
    const { data } = await db
      .from('participants')
      .select('first_name, email, date_of_birth, gender, grade, ethnicity, school_name, age_bracket, registrations(school_address_state)')
      .eq('id', inv.participant_id)
      .maybeSingle()
    p = data
  }
  let m: Record<string, unknown> | null = null
  let memberEthnicity = false
  let school: { name: string | null; state: string | null } | null = null
  if (memberId) {
    const [{ data: mem }, { count }, { data: ms }] = await Promise.all([
      db.from('members').select('first_name, email, date_of_birth, gender, grade, age_bracket').eq('id', memberId).maybeSingle(),
      db.from('member_ethnicities').select('id', { count: 'exact', head: true }).eq('member_id', memberId),
      db.from('member_schools').select('is_current, schools(name, state)').eq('member_id', memberId).order('is_current', { ascending: false }).limit(1),
    ])
    m = mem
    memberEthnicity = (count ?? 0) > 0
    const s = (ms?.[0] as { schools?: { name: string | null; state: string | null } } | undefined)?.schools
    if (s) school = { name: s.name, state: s.state }
  }
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
  const reg = p?.registrations as { school_address_state?: string | null } | null | undefined
  return {
    firstName: str(m?.first_name) ?? str(p?.first_name) ?? inv.first_name,
    email: str(p?.email) ?? str(m?.email),
    dateOfBirth: str(m?.date_of_birth) ?? str(p?.date_of_birth),
    gender: str(m?.gender) ?? str(p?.gender),
    grade: str(m?.grade) ?? str(p?.grade),
    ageBracket: str(m?.age_bracket) ?? str(p?.age_bracket),
    hasEthnicity: memberEthnicity || (Array.isArray(p?.ethnicity) && (p!.ethnicity as unknown[]).length > 0),
    school: school?.name ?? str(p?.school_name),
    schoolState: school?.state ?? reg?.school_address_state ?? null,
  }
}

async function memberIdOf(db: SupabaseClient, inv: InvitationRow): Promise<string | null> {
  if (inv.member_id) return inv.member_id
  if (!inv.participant_id) return null
  const { data } = await db.from('participants').select('member_id').eq('id', inv.participant_id).maybeSingle()
  return (data?.member_id as string | null) ?? null
}

async function quoteEligibleByAgreement(db: SupabaseClient, inv: InvitationRow, memberId: string | null, profile: Profile, eventDay: string): Promise<boolean> {
  if (!inv.is_minor) return false
  const key = 'me'
  const consents = await loadMinorConsents(db, [{ key, memberId, participantId: inv.participant_id }])
  const c = consents.get(key)
  if (!c?.coversSurveys || c.quoteOptOut) return false
  const age = ageIfKnown(profile.dateOfBirth, eventDay)
  if (age !== null && age < 13) return true
  let allow: boolean | null = null
  if (memberId) {
    const { data } = await db.from('member_privacy_prefs').select('allow_quotes').eq('member_id', memberId).maybeSingle()
    allow = (data?.allow_quotes as boolean | null) ?? null
  }
  return allow ?? defaultAllowQuotes(age, profile.schoolState)
}

export async function buildContext(db: SupabaseClient, s: SurveySession): Promise<SurveyContext> {
  const inv = s.invitation
  const memberId = await memberIdOf(db, inv)
  const profile = await loadProfile(db, inv, memberId)
  const missing: ProfileField[] = []
  if (inv.respondent_role === 'student') {
    if (!profile.gender) missing.push('gender')
    if (!profile.hasEthnicity) missing.push('ethnicity')
    if (!profile.grade) missing.push('grade')
    if (!profile.school) missing.push('school')
  }
  const year = Number(s.distribution.event_date.slice(0, 4))
  return {
    role: inv.respondent_role,
    first_time: await isFirstTime(db, inv, s.distribution.event_slug, memberId, inv.send_via === 'self' ? inv.email : profile.email),
    is_minor: inv.is_minor,
    quote_eligible_by_agreement: await quoteEligibleByAgreement(db, inv, memberId, profile, s.distribution.event_date),
    adult_relationship: inv.respondent_role === 'adult' ? inv.adult_relationship : null,
    profile_missing: missing,
    event_title: s.distribution.event_title ?? s.distribution.event_slug,
    event_slug: s.distribution.event_slug,
    event_year: Number.isFinite(year) ? year : null,
    first_name: profile.firstName,
  }
}

// ── Runtime option lists ─────────────────────────────────────────────────────

const GENDER_LABELS: Record<string, string> = { male: 'Male', female: 'Female', other: 'Another gender', prefer_not_to_say: 'Prefer not to say' }
const GRADE_LABELS: Record<string, string> = {
  grade_6: 'Grade 6', grade_7: 'Grade 7', grade_8: 'Grade 8', grade_9: 'Grade 9', grade_10: 'Grade 10', grade_11: 'Grade 11', grade_12: 'Grade 12',
  college_freshman: 'College freshman', college_sophomore: 'College sophomore', college_junior: 'College junior', college_senior: 'College senior', grad_phd: 'Graduate / PhD',
}

export async function runtimeOptions(db: SupabaseClient): Promise<RuntimeOptions> {
  const { data } = await db.from('ethnicity_options').select('name').order('name')
  const opt = (key: string, label: string): Option => ({ key, label, numeric: null })
  const out: Partial<Record<OptionsSource, Option[]>> = {
    gender: Object.entries(GENDER_LABELS).map(([k, l]) => opt(k, l)),
    grade: Object.entries(GRADE_LABELS).map(([k, l]) => opt(k, l)),
    ethnicity: [...(data ?? []).map((r) => opt(r.name as string, r.name as string)), { ...opt('Prefer not to say', 'Prefer not to say'), exclusive: true }],
  }
  return out
}

// ── Actions ──────────────────────────────────────────────────────────────────

/** Record an open and make sure a response row (with its context) exists. */
export async function openSession(db: SupabaseClient, s: SurveySession, from: OpenedFrom, now = new Date()): Promise<ResponseRow> {
  const inv = s.invitation
  const iso = now.toISOString()
  const patch: Record<string, unknown> = { last_activity_at: iso }
  if (!inv.first_opened_at) {
    patch.first_opened_at = iso
    patch.opened_from = from
  }
  if (inv.status === 'queued' || inv.status === 'sent' || inv.status === 'expired') patch.status = 'opened'
  await db.from('survey_invitations').update(patch).eq('id', inv.id)

  if (s.response) return s.response
  const ctx = await buildContext(db, s)
  const memberId = await memberIdOf(db, inv)
  const { data, error } = await db
    .from('survey_responses')
    .upsert(
      {
        invitation_id: inv.id,
        definition_id: s.distribution.definition_id,
        distribution_id: s.distribution.id,
        event_slug: s.distribution.event_slug,
        event_year: ctx.event_year,
        participant_id: inv.participant_id,
        member_id: memberId,
        respondent_role: inv.respondent_role,
        context: ctx,
        current_page: null,
      },
      { onConflict: 'invitation_id', ignoreDuplicates: true },
    )
    .select('*')
  if (error) throw new Error(`Starting the response failed: ${error.message}`)
  if (data?.[0]) return data[0] as ResponseRow
  const { data: again } = await db.from('survey_responses').select('*').eq('invitation_id', inv.id).single()
  return again as ResponseRow
}

export type SaveResult = { ok: true; savedAt: string } | { ok: false; status: number; error: string; fieldErrors?: Record<string, string> }

export async function saveDraft(
  db: SupabaseClient,
  s: SurveySession,
  body: { answers: unknown; page?: unknown },
  now = new Date(),
): Promise<SaveResult> {
  if (s.state !== 'open') return { ok: false, status: 409, error: closedMessage(s.state) }
  const resp = s.response
  if (!resp) return { ok: false, status: 409, error: 'Open the survey first.' }
  const runtime = await runtimeOptions(db)
  const clean = sanitiseDraft(s.def, resp.context, body.answers, runtime)
  if (!clean.ok) return { ok: false, status: 400, error: 'Some answers weren’t valid.', fieldErrors: clean.errors }
  const pages = new Set(s.def.branches[resp.context.role].map((p) => p.id))
  const page = typeof body.page === 'string' && pages.has(body.page) ? body.page : resp.current_page
  const iso = now.toISOString()
  const { data, error } = await db
    .from('survey_responses')
    .update({ draft_answers: clean.answers, current_page: page, last_saved_at: iso, started_at: resp.started_at ?? iso })
    .eq('id', resp.id)
    .is('submitted_at', null)
    .select('id')
  if (error) return { ok: false, status: 500, error: 'Saving failed. Your answers are still on this page; try again.' }
  if (!data?.length) return { ok: false, status: 409, error: 'This survey has already been submitted.' }
  if (s.invitation.status !== 'started' && s.invitation.status !== 'submitted') {
    await db.from('survey_invitations').update({ status: 'started', last_activity_at: iso }).eq('id', s.invitation.id).neq('status', 'submitted')
  } else {
    await db.from('survey_invitations').update({ last_activity_at: iso }).eq('id', s.invitation.id)
  }
  return { ok: true, savedAt: iso }
}

export type SubmitResult = { ok: true; submittedAt: string } | { ok: false; status: number; error: string; fieldErrors?: Record<string, string> }

export async function submitResponse(
  db: SupabaseClient,
  s: SurveySession,
  body: { answers: unknown },
  from: OpenedFrom,
  now = new Date(),
): Promise<SubmitResult> {
  if (s.state !== 'open') return { ok: false, status: 409, error: closedMessage(s.state) }
  const resp = s.response
  if (!resp) return { ok: false, status: 409, error: 'Open the survey first.' }
  const runtime = await runtimeOptions(db)
  const clean = sanitiseDraft(s.def, resp.context, body.answers, runtime)
  if (!clean.ok) return { ok: false, status: 400, error: 'Some answers weren’t valid.', fieldErrors: clean.errors }
  const missing = missingRequired(s.def, resp.context, clean.answers)
  if (Object.keys(missing).length) return { ok: false, status: 400, error: 'A few required questions still need an answer.', fieldErrors: missing }

  // Save the final draft first, so what is frozen is exactly what was checked.
  const saved = await saveDraft(db, s, { answers: clean.answers, page: resp.current_page }, now)
  if (!saved.ok) return saved

  const flat = flattenAnswers(s.def, resp.context, clean.answers, runtime)
  const memberId = await memberIdOf(db, s.invitation)
  const profile = await loadProfile(db, s.invitation, memberId)
  const isMinor =
    s.invitation.respondent_role === 'student' &&
    isMinorPerPolicy({
      dateOfBirth: profile.dateOfBirth,
      state: profile.schoolState,
      ageBracket: profile.ageBracket,
      grade: profile.grade,
      presumeMinorIfUnknown: true,
    })

  const { data, error } = await db.rpc('survey_submit_response', {
    p_response_id: resp.id,
    p_answers: flat.rows,
    p_is_minor: isMinor,
    p_quote_consent: flat.quoteConsent,
    p_no_quote: flat.noQuote,
    p_followup_consent: flat.followupConsent,
    p_submitted_from: from,
  })
  if (error) {
    if (error.code === 'P0002') return { ok: false, status: 409, error: 'This survey has already been submitted.' }
    return { ok: false, status: 500, error: 'Submitting failed. Your answers are saved; try again in a moment.' }
  }
  // Backfill the account link if it appeared since the response began.
  if (memberId && !resp.member_id) await db.from('survey_responses').update({ member_id: memberId }).eq('id', resp.id)
  if (memberId) {
    await logActivity({
      memberId,
      actorType: 'member',
      category: 'survey',
      action: 'survey_submitted',
      summary: `Submitted the ${s.distribution.event_title ?? s.distribution.event_slug} survey`,
      metadata: { response_id: resp.id, event_slug: s.distribution.event_slug },
    })
  }
  return { ok: true, submittedAt: data as string }
}

export function closedMessage(state: SessionState): string {
  switch (state) {
    case 'scheduled':
      return 'This survey isn’t open yet.'
    case 'paused':
      return 'This survey is paused.'
    case 'closed':
      return 'This survey has closed.'
    case 'submitted':
      return 'This survey has already been submitted.'
    default:
      return 'This survey isn’t available.'
  }
}

/** What the renderer needs, with nothing the respondent shouldn't see. */
export function clientView(s: SurveySession, resp: ResponseRow, runtime: RuntimeOptions) {
  return {
    state: s.state,
    role: resp.context.role,
    context: resp.context,
    definition: s.def,
    runtimeOptions: runtime,
    answers: resp.draft_answers ?? {},
    currentPage: resp.current_page,
    pages: visiblePages(s.def, resp.context, resp.draft_answers ?? {}).map((p) => p.id),
    closesAt: s.distribution.closes_at,
    timeZone: s.distribution.event_time_zone,
    submittedAt: resp.submitted_at,
  }
}
export type ClientView = ReturnType<typeof clientView>
