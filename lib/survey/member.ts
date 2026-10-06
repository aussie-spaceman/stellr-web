/**
 * A signed-in member's surveys (handover A4, P3): the ones open for them now
 * (dashboard card) and the ones they've submitted (history, read-only).
 *
 * History needs an account: it is never reachable by token. A member sees
 * only their own responses — matched on member_id, or on a participant row
 * that is theirs (answers given before they had an account). Those older rows
 * are re-associated (member_id backfilled) as they are read; the database
 * trigger on participants does the same when an account is linked.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliseDefinition, type Question } from './definition'
import { visibleQuestions, type SurveyContext } from './branching'
import { statusNow, type DistributionRow } from './distributions'
import { participantIdsFor } from './access'

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

async function backfill(db: SupabaseClient, memberId: string, participantIds: string[]) {
  if (!participantIds.length) return
  await Promise.all([
    db.from('survey_invitations').update({ member_id: memberId }).in('participant_id', participantIds).is('member_id', null),
    db.from('survey_responses').update({ member_id: memberId }).in('participant_id', participantIds).is('member_id', null),
  ])
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

/** One submitted response, read-only, in the order it was asked. */
export async function submittedResponseFor(
  db: SupabaseClient,
  memberId: string,
  responseId: string,
): Promise<{ item: HistoryItem; lines: AnswerLine[]; quotable: boolean } | null> {
  const participantIds = await participantIdsFor(db, memberId)
  const { data: r } = await db
    .from('survey_responses')
    .select('id, member_id, participant_id, definition_id, event_slug, event_year, submitted_at, quote_withdrawn_at, context, no_quote, quote_consent, is_minor_at_submit, survey_distributions(event_title)')
    .eq('id', responseId)
    .not('submitted_at', 'is', null)
    .maybeSingle()
  if (!r) return null
  const mine = r.member_id === memberId || (r.participant_id && participantIds.includes(r.participant_id as string))
  if (!mine) return null

  const [{ data: defRow }, { data: answers }] = await Promise.all([
    db.from('survey_definitions').select('definition').eq('id', r.definition_id).single(),
    db.from('survey_answers').select('question_key, value_text, value_numeric, value_options').eq('response_id', r.id),
  ])
  const def = normaliseDefinition(defRow!.definition)
  const ctx = r.context as SurveyContext
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
  const dist = r.survey_distributions as unknown as { event_title: string | null } | null
  return {
    item: {
      responseId: r.id as string,
      eventTitle: dist?.event_title ?? ctx?.event_title ?? (r.event_slug as string) ?? 'Event',
      eventSlug: r.event_slug as string | null,
      eventYear: r.event_year as number | null,
      submittedAt: r.submitted_at as string,
      quoteWithdrawn: !!r.quote_withdrawn_at,
    },
    lines,
    quotable,
  }
}
