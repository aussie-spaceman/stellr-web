/**
 * A signed-in member's surveys (handover A4, P3): the ones open for them now
 * (dashboard card) and the ones they've submitted (history, read-only).
 *
 * History needs an account: it is never reachable by token. A member sees
 * only their own responses — matched on member_id, or on a participant row
 * that is theirs (answers given before they had an account). Those older rows
 * are re-associated (member_id backfilled) as they are read; the database
 * trigger on participants does the same when an account is linked. A response
 * linked that way gets the activity-log entry its submit couldn't write.
 *
 * Admins read the same history on the member page (memberSurveyRows,
 * submittedResponseById), without the backfill.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliseDefinition, type Question } from './definition'
import { visibleQuestions, type SurveyContext } from './branching'
import { statusNow, type DistributionRow } from './distributions'
import { participantIdsFor } from './access'
import { responseBelongsTo, unloggedSubmissions, type MemberSurveyRow } from './history'
import { logActivities } from '@/lib/activity-log'

export interface OpenSurvey {
  invitationId: string
  eventTitle: string
  eventSlug: string
  closesAt: string
  timeZone: string
  started: boolean
}

export interface HistoryItem {
  responseId: string
  eventTitle: string
  eventSlug: string | null
  eventYear: number | null
  submittedAt: string
  quoteWithdrawn: boolean
}

// One backfill per member at a time: the surveys page reads open surveys and
// history together, and both would otherwise log the same late submission.
const backfilling = new Map<string, Promise<void>>()

function backfill(db: SupabaseClient, memberId: string, participantIds: string[]): Promise<void> {
  if (!participantIds.length) return Promise.resolve()
  const running = backfilling.get(memberId)
  if (running) return running
  const job = (async () => {
    await Promise.all([
      db.from('survey_invitations').update({ member_id: memberId }).in('participant_id', participantIds).is('member_id', null),
      db.from('survey_responses').update({ member_id: memberId }).in('participant_id', participantIds).is('member_id', null),
    ])
    await logLateSubmissions(db, memberId, participantIds)
  })().finally(() => backfilling.delete(memberId))
  backfilling.set(memberId, job)
  return job
}

/**
 * A response submitted before the account was linked never reached the
 * member's activity log (the submit had no member to log against). Once it is
 * linked — here, or by the participants trigger — write the entry it missed,
 * once: a response that already has a survey_submitted entry is skipped.
 * Best-effort, like every activity write.
 */
async function logLateSubmissions(db: SupabaseClient, memberId: string, participantIds: string[]): Promise<void> {
  try {
    const { data: responses, error } = await db
      .from('survey_responses')
      .select('id, event_slug, submitted_at, context, survey_distributions(event_title)')
      .eq('member_id', memberId)
      .in('participant_id', participantIds)
      .not('submitted_at', 'is', null)
      .eq('source', 'app')
    if (error || !responses?.length) return
    const { data: logged, error: e2 } = await db
      .from('member_activity_log')
      .select('metadata')
      .eq('member_id', memberId)
      .eq('action', 'survey_submitted')
      .in('metadata->>response_id', responses.map((r) => r.id as string))
    if (e2) return
    const missing = unloggedSubmissions(
      responses as unknown as { id: string; event_slug: string | null; submitted_at: string; context: SurveyContext | null; survey_distributions: { event_title: string | null } | null }[],
      (logged ?? []).map((l) => (l.metadata as { response_id?: string } | null)?.response_id).filter((id): id is string => !!id),
    )
    await logActivities(
      missing.map((r) => ({
        memberId,
        actorType: 'member' as const,
        category: 'survey' as const,
        action: 'survey_submitted',
        summary: `Submitted the ${r.survey_distributions?.event_title ?? r.context?.event_title ?? r.event_slug ?? 'event'} survey`,
        metadata: { response_id: r.id, event_slug: r.event_slug, submitted_at: r.submitted_at, linked_later: true },
      })),
      db,
    )
  } catch (err) {
    console.error('[survey] logging late submissions failed:', err)
  }
}

function ownership(memberId: string, participantIds: string[]): string {
  return participantIds.length ? `member_id.eq.${memberId},participant_id.in.(${participantIds.join(',')})` : `member_id.eq.${memberId}`
}

export async function openSurveysFor(db: SupabaseClient, memberId: string, now = new Date()): Promise<OpenSurvey[]> {
  const participantIds = await participantIdsFor(db, memberId)
  await backfill(db, memberId, participantIds)
  const { data, error } = await db
    .from('survey_invitations')
    .select('id, status, survey_distributions!inner(*)')
    .or(ownership(memberId, participantIds))
    .not('status', 'in', '(submitted)')
  if (error) throw new Error(`Reading surveys failed: ${error.message}`)
  return ((data ?? []) as unknown as { id: string; status: string; survey_distributions: DistributionRow }[])
    .filter((r) => statusNow(r.survey_distributions, now) === 'open')
    .map((r) => ({
      invitationId: r.id,
      eventTitle: r.survey_distributions.event_title ?? r.survey_distributions.event_slug,
      eventSlug: r.survey_distributions.event_slug,
      closesAt: r.survey_distributions.closes_at,
      timeZone: r.survey_distributions.event_time_zone,
      started: r.status === 'started',
    }))
}

export async function surveyHistoryFor(db: SupabaseClient, memberId: string): Promise<HistoryItem[]> {
  const participantIds = await participantIdsFor(db, memberId)
  await backfill(db, memberId, participantIds)
  const { data, error } = await db
    .from('survey_responses')
    .select('id, event_slug, event_year, submitted_at, quote_withdrawn_at, context, survey_distributions(event_title)')
    .or(ownership(memberId, participantIds))
    .not('submitted_at', 'is', null)
    .eq('source', 'app')
    .order('submitted_at', { ascending: false })
  if (error) throw new Error(`Reading survey history failed: ${error.message}`)
  return ((data ?? []) as unknown as {
    id: string
    event_slug: string | null
    event_year: number | null
    submitted_at: string
    quote_withdrawn_at: string | null
    context: SurveyContext
    survey_distributions: { event_title: string | null } | null
  }[]).map((r) => ({
    responseId: r.id,
    eventTitle: r.survey_distributions?.event_title ?? r.context?.event_title ?? r.event_slug ?? 'Event',
    eventSlug: r.event_slug,
    eventYear: r.event_year,
    submittedAt: r.submitted_at,
    quoteWithdrawn: !!r.quote_withdrawn_at,
  }))
}

export interface AnswerLine {
  question: Question
  display: string
}

const RESPONSE_COLUMNS =
  'id, member_id, participant_id, distribution_id, definition_id, respondent_role, event_slug, event_year, submitted_at, quote_withdrawn_at, context, no_quote, quote_consent, is_minor_at_submit, survey_distributions(event_title)'

interface SubmittedRow {
  id: string
  member_id: string | null
  participant_id: string | null
  distribution_id: string | null
  definition_id: string
  respondent_role: 'student' | 'mentor' | 'adult' | null
  event_slug: string | null
  event_year: number | null
  submitted_at: string
  quote_withdrawn_at: string | null
  context: SurveyContext
  no_quote: boolean | null
  quote_consent: string | null
  is_minor_at_submit: boolean | null
  survey_distributions: { event_title: string | null } | null
}

export interface SubmittedResponse {
  item: HistoryItem
  lines: AnswerLine[]
  quotable: boolean
  memberId: string | null
  participantId: string | null
  distributionId: string | null
  role: 'student' | 'mentor' | 'adult' | null
}

async function submittedRow(db: SupabaseClient, responseId: string): Promise<SubmittedRow | null> {
  const { data } = await db.from('survey_responses').select(RESPONSE_COLUMNS).eq('id', responseId).not('submitted_at', 'is', null).maybeSingle()
  return (data as unknown as SubmittedRow | null) ?? null
}

/** The answers as they were asked: only the questions the respondent saw, in order. */
async function buildSubmitted(db: SupabaseClient, r: SubmittedRow): Promise<SubmittedResponse> {
  const [{ data: defRow }, { data: answers }] = await Promise.all([
    db.from('survey_definitions').select('definition').eq('id', r.definition_id).single(),
    db.from('survey_answers').select('question_key, value_text, value_numeric, value_options').eq('response_id', r.id),
  ])
  const def = normaliseDefinition(defRow!.definition)
  const ctx = r.context
  const byKey = new Map((answers ?? []).map((a) => [a.question_key as string, a]))

  const lines: AnswerLine[] = []
  // Visibility from the stored answers, so the page shows exactly what was asked.
  const asAnswers: Record<string, string | number | boolean | string[]> = {}
  for (const a of answers ?? []) {
    asAnswers[a.question_key as string] = (a.value_options as string[] | null) ?? (a.value_text as string | null) ?? (a.value_numeric as number)
  }
  for (const q of visibleQuestions(def, ctx, asAnswers)) {
    const label = (key: string | null) => q.options?.find((o) => o.key === key)?.label ?? key ?? ''
    if (q.type === 'grid') {
      const parts = (q.rows ?? []).map((row) => {
        const a = byKey.get(row.key)
        return a ? `${row.label}: ${label(a.value_text as string)}` : null
      }).filter(Boolean)
      if (parts.length) lines.push({ question: q, display: parts.join('\n') })
      continue
    }
    const a = byKey.get(q.key)
    if (!a) continue
    let display: string
    if (a.value_options) display = (a.value_options as string[]).map(label).join(', ')
    else if (q.type === 'boolean') display = a.value_text === 'true' ? 'Yes' : 'No'
    else if (q.type === 'nps' || q.type === 'number') display = `${a.value_numeric}${q.unit ? ` ${q.unit}` : ''}`
    else display = q.options ? label(a.value_text as string) : (a.value_text as string)
    lines.push({ question: q, display })
  }

  const hasQuotable = lines.some((l) => l.question.quotable || (!r.is_minor_at_submit && l.question.type === 'text_long'))
  const quotable = hasQuotable && !r.quote_withdrawn_at && (r.is_minor_at_submit ? r.no_quote !== true : r.quote_consent === 'named' || r.quote_consent === 'anonymous')
  return {
    item: {
      responseId: r.id,
      eventTitle: r.survey_distributions?.event_title ?? ctx?.event_title ?? r.event_slug ?? 'Event',
      eventSlug: r.event_slug,
      eventYear: r.event_year,
      submittedAt: r.submitted_at,
      quoteWithdrawn: !!r.quote_withdrawn_at,
    },
    lines,
    quotable,
    memberId: r.member_id,
    participantId: r.participant_id,
    distributionId: r.distribution_id,
    role: r.respondent_role,
  }
}

/** One submitted response, read-only, in the order it was asked. Only the member's own. */
export async function submittedResponseFor(db: SupabaseClient, memberId: string, responseId: string): Promise<SubmittedResponse | null> {
  const [participantIds, r] = await Promise.all([participantIdsFor(db, memberId), submittedRow(db, responseId)])
  if (!r || !responseBelongsTo({ memberId: r.member_id, participantId: r.participant_id }, memberId, participantIds)) return null
  return buildSubmitted(db, r)
}

/**
 * One submitted response for an admin: whoever it belongs to. The caller
 * checks it is the member being viewed, and records the view.
 */
export async function submittedResponseById(db: SupabaseClient, responseId: string): Promise<SubmittedResponse | null> {
  const r = await submittedRow(db, responseId)
  return r ? buildSubmitted(db, r) : null
}

/**
 * Every survey invitation of a member (by account or participant row), newest
 * first, with its distribution and response. Read-only: no backfill, so an
 * admin looking never changes the member's rows.
 */
export async function memberSurveyRows(db: SupabaseClient, memberId: string, participantIds?: string[]): Promise<MemberSurveyRow[]> {
  const ids = participantIds ?? (await participantIdsFor(db, memberId))
  const { data, error } = await db
    .from('survey_invitations')
    .select(
      'id, status, respondent_role, adult_relationship, send_via, created_at, survey_distributions!inner(id, event_slug, event_title, status, opens_at, closes_at), survey_responses(id, submitted_at)',
    )
    .or(ownership(memberId, ids))
    .order('created_at', { ascending: false })
  if (error) throw new Error(`Reading member surveys failed: ${error.message}`)
  type Resp = { id: string; submitted_at: string | null }
  return ((data ?? []) as unknown as {
    id: string
    status: string
    respondent_role: MemberSurveyRow['role']
    adult_relationship: MemberSurveyRow['adultRelationship']
    send_via: MemberSurveyRow['sendVia']
    created_at: string
    survey_distributions: { id: string; event_slug: string; event_title: string | null; status: MemberSurveyRow['distribution']['status']; opens_at: string; closes_at: string }
    survey_responses: Resp | Resp[] | null
  }[]).map((i) => {
    const resp = Array.isArray(i.survey_responses) ? i.survey_responses[0] : i.survey_responses
    const d = i.survey_distributions
    return {
      invitationId: i.id,
      status: i.status,
      role: i.respondent_role,
      adultRelationship: i.adult_relationship,
      sendVia: i.send_via,
      invitedAt: i.created_at,
      distribution: { id: d.id, eventSlug: d.event_slug, eventTitle: d.event_title, status: d.status, opensAt: d.opens_at, closesAt: d.closes_at },
      responseId: resp?.id ?? null,
      submittedAt: resp?.submitted_at ?? null,
    }
  })
}
