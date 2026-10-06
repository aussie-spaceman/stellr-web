/**
 * Testimonials: which submitted answers may be quoted, and how they are
 * attributed — decided at export time, every time, never stored (V2.3 §1.7,
 * §2). A minor's quote needs a V2.3+ agreement, no parental quote opt-out, the
 * student's own setting on (default off for NY/CO 13–17), and no "Don't quote
 * this response"; adults need an explicit yes. Withdrawn quotes never export.
 *
 * Quotable answers: questions flagged `quotable` in the definition (students'
 * `highlight`), plus, for adults who said yes, their free-text comments.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliseDefinition, questionsFor, ROLES } from './definition'
import { attributionFor, loadMinorConsents, quoteEligibility } from './consent'
import { ageIfKnown } from './minor'

export interface TestimonialRow {
  responseId: string
  eventSlug: string | null
  eventYear: number | null
  role: string | null
  questionKey: string
  quote: string
  attribution: string
  attributionKind: 'minor' | 'minor_under_13' | 'named' | 'anonymous'
}

export interface Exclusion {
  responseId: string
  reason: string
}

interface RespRow {
  id: string
  definition_id: string
  event_slug: string | null
  event_year: number | null
  respondent_role: string | null
  participant_id: string | null
  member_id: string | null
  is_minor_at_submit: boolean | null
  quote_consent: 'named' | 'anonymous' | 'no' | null
  no_quote: boolean | null
  quote_withdrawn_at: string | null
  submitted_at: string
}

export async function testimonials(
  db: SupabaseClient,
  f: { eventSlug?: string | null; year?: number | null },
): Promise<{ rows: TestimonialRow[]; excluded: Exclusion[] }> {
  let q = db
    .from('survey_responses')
    .select('id, definition_id, event_slug, event_year, respondent_role, participant_id, member_id, is_minor_at_submit, quote_consent, no_quote, quote_withdrawn_at, submitted_at')
    .not('submitted_at', 'is', null)
    .eq('source', 'app')
  if (f.eventSlug) q = q.eq('event_slug', f.eventSlug)
  if (f.year) q = q.eq('event_year', f.year)
  const { data: resps, error } = await q
  if (error) throw new Error(`Reading responses failed: ${error.message}`)
  const responses = (resps ?? []) as RespRow[]
  if (!responses.length) return { rows: [], excluded: [] }

  // Quotable keys per definition.
  const defIds = [...new Set(responses.map((r) => r.definition_id))]
  const { data: defs } = await db.from('survey_definitions').select('id, definition').in('id', defIds)
  const quotable = new Map<string, { minor: Set<string>; adult: Set<string> }>()
  for (const d of defs ?? []) {
    const def = normaliseDefinition(d.definition)
    const minor = new Set<string>()
    const adult = new Set<string>()
    for (const role of ROLES) {
      for (const qn of questionsFor(def, role)) {
        if (qn.quotable) {
          minor.add(qn.key)
          adult.add(qn.key)
        }
        if (qn.type === 'text_long') adult.add(qn.key)
      }
    }
    quotable.set(d.id as string, { minor, adult })
  }

  const ids = responses.map((r) => r.id)
  const { data: answers } = await db.from('survey_answers').select('response_id, question_key, value_text').in('response_id', ids).not('value_text', 'is', null)

  // People: names, grade, DOB, school + state, the student's quote setting.
  const memberIds = [...new Set(responses.map((r) => r.member_id).filter(Boolean))] as string[]
  const participantIds = [...new Set(responses.map((r) => r.participant_id).filter(Boolean))] as string[]
  const [{ data: members }, { data: parts }, { data: prefs }, { data: schools }] = await Promise.all([
    memberIds.length ? db.from('members').select('id, first_name, last_name, grade, date_of_birth').in('id', memberIds) : Promise.resolve({ data: [] }),
    participantIds.length
      ? db.from('participants').select('id, first_name, last_name, grade, date_of_birth, school_name, registrations(school_address_state)').in('id', participantIds)
      : Promise.resolve({ data: [] }),
    memberIds.length ? db.from('member_privacy_prefs').select('member_id, allow_quotes').in('member_id', memberIds) : Promise.resolve({ data: [] }),
    memberIds.length ? db.from('member_schools').select('member_id, is_current, schools(name, state)').in('member_id', memberIds) : Promise.resolve({ data: [] }),
  ])
  const mById = new Map((members ?? []).map((m) => [m.id as string, m]))
  const pById = new Map((parts ?? []).map((p) => [p.id as string, p as Record<string, unknown>]))
  const prefBy = new Map((prefs ?? []).map((p) => [p.member_id as string, p.allow_quotes as boolean | null]))
  const schoolBy = new Map<string, { name: string | null; state: string | null }>()
  for (const s of (schools ?? []) as unknown as { member_id: string; is_current: boolean; schools: { name: string | null; state: string | null } | null }[]) {
    if (s.schools && (s.is_current || !schoolBy.has(s.member_id))) schoolBy.set(s.member_id, s.schools)
  }
  const consents = await loadMinorConsents(
    db,
    responses.filter((r) => r.is_minor_at_submit).map((r) => ({ key: r.id, memberId: r.member_id, participantId: r.participant_id })),
  )
  const employer = new Map((answers ?? []).filter((a) => a.question_key === 'employer').map((a) => [a.response_id as string, a.value_text as string]))

  const rows: TestimonialRow[] = []
  const excluded: Exclusion[] = []
  for (const r of responses) {
    const m = r.member_id ? mById.get(r.member_id) : undefined
    const p = r.participant_id ? pById.get(r.participant_id) : undefined
    const school = (r.member_id && schoolBy.get(r.member_id)) || null
    const state = school?.state ?? ((p?.registrations as { school_address_state?: string | null } | null)?.school_address_state ?? null)
    const dob = (m?.date_of_birth as string | null) ?? (p?.date_of_birth as string | null) ?? null
    const age = ageIfKnown(dob, r.submitted_at.slice(0, 10))
    const c = consents.get(r.id)
    const decision = quoteEligibility({
      isMinor: r.is_minor_at_submit === true,
      age,
      state,
      agreementVersion: c?.agreementVersion ?? null,
      agreementRestricted: c?.restricted ?? false,
      parentQuoteOptOut: c?.quoteOptOut ?? false,
      studentAllowQuotes: r.member_id ? prefBy.get(r.member_id) ?? null : null,
      noQuote: r.no_quote,
      quoteConsent: r.quote_consent,
      withdrawn: !!r.quote_withdrawn_at,
    })
    if (!decision.eligible) {
      excluded.push({ responseId: r.id, reason: decision.reason })
      continue
    }
    const keys = quotable.get(r.definition_id)
    const allowed = r.is_minor_at_submit ? keys?.minor : keys?.adult
    const attribution = attributionFor(decision, {
      firstName: (m?.first_name as string | null) ?? (p?.first_name as string | null) ?? null,
      lastName: (m?.last_name as string | null) ?? (p?.last_name as string | null) ?? null,
      grade: (m?.grade as string | null) ?? (p?.grade as string | null) ?? null,
      school: school?.name ?? (p?.school_name as string | null) ?? null,
      state,
      organisation: employer.get(r.id) ?? null,
    })
    for (const a of (answers ?? []).filter((x) => x.response_id === r.id && allowed?.has(x.question_key as string))) {
      const text = (a.value_text as string).trim()
      if (!text || text === '[redacted]') continue
      rows.push({
        responseId: r.id,
        eventSlug: r.event_slug,
        eventYear: r.event_year,
        role: r.respondent_role,
        questionKey: a.question_key as string,
        quote: text,
        attribution,
        attributionKind: decision.attribution,
      })
    }
  }
  return { rows, excluded }
}

