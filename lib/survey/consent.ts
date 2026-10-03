/**
 * What a minor's signed agreement allows the survey to do (Participation
 * Agreement – Minors V2.3, §1.1/§1.2 collection, §1.7/§2 quoting, §4 direct
 * digital communications), and quote eligibility at export time.
 *
 * Sources (2 Oct 2026):
 *   - Version: agreements.template_id → esign_templates.document_version.
 *     DocuSign-signed rows have no template and so no version: they never
 *     meet V2.3.
 *   - Opt-outs: the guardian's checkbox values on the original agreement
 *     (agreement_recipients.signer_values, 'true'/'false' by field name).
 *     DigitalCommsOptOut and MediaOptOut exist on today's minor template;
 *     QuoteOptOut is the name the V2.3 §2 checkbox must carry.
 *   - Withdrawal: an agreement restricted after a withdrawal or deletion
 *     request (agreements.restricted_at) no longer counts.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { agreementExpiry } from '@/lib/docusign-agreements'
import { normaliseState } from '@/lib/locations'

export const SURVEY_MIN_MINOR_AGREEMENT = 'V2.3'
export const QUOTE_OPT_OUT_FIELD = 'QuoteOptOut'
export const DIGITAL_COMMS_OPT_OUT_FIELD = 'DigitalCommsOptOut'
export const MEDIA_OPT_OUT_FIELD = 'MediaOptOut'

/** Compare "V2.3"-style labels; null sorts below everything. */
export function compareDocVersion(a: string | null | undefined, b: string | null | undefined): number {
  const parse = (v: string | null | undefined) => (v && /^V\d+(\.\d+)*$/.test(v) ? v.slice(1).split('.').map(Number) : null)
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return Math.sign(d)
  }
  return 0
}

export function meetsSurveyAgreement(version: string | null | undefined): boolean {
  return compareDocVersion(version, SURVEY_MIN_MINOR_AGREEMENT) >= 0
}

export interface MinorConsent {
  agreementId: string | null
  agreementVersion: string | null
  /** A current, unrestricted minor agreement at V2.3 or later. */
  coversSurveys: boolean
  restricted: boolean
  digitalCommsOptOut: boolean
  quoteOptOut: boolean
  mediaOptOut: boolean
  guardianEmail: string | null
  guardianName: string | null
}

export const NO_CONSENT: MinorConsent = {
  agreementId: null,
  agreementVersion: null,
  coversSurveys: false,
  restricted: false,
  digitalCommsOptOut: false,
  quoteOptOut: false,
  mediaOptOut: false,
  guardianEmail: null,
  guardianName: null,
}

const ticked = (values: Record<string, string> | null | undefined, field: string) => values?.[field] === 'true'

export interface ConsentSubject {
  key: string
  memberId: string | null
  participantId: string | null
}

interface AgreementRow {
  id: string
  member_id: string | null
  participant_id: string | null
  completed_at: string | null
  reused_from: string | null
  restricted_at: string | null
  template_id: string | null
}

/**
 * Minor-agreement facts for many people at once (a whole event roster).
 * Each subject's newest completed minor agreement, matched on member or
 * participant, resolved through `reused_from` to the agreement actually signed.
 */
export async function loadMinorConsents(
  db: SupabaseClient,
  subjects: ConsentSubject[],
  now = new Date(),
): Promise<Map<string, MinorConsent>> {
  const out = new Map<string, MinorConsent>()
  if (!subjects.length) return out
  const memberIds = [...new Set(subjects.map((s) => s.memberId).filter(Boolean))] as string[]
  const participantIds = [...new Set(subjects.map((s) => s.participantId).filter(Boolean))] as string[]

  const rows: AgreementRow[] = []
  const cols = 'id, member_id, participant_id, completed_at, reused_from, restricted_at, template_id'
  for (const [col, ids] of [['member_id', memberIds], ['participant_id', participantIds]] as const) {
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await db
        .from('agreements')
        .select(cols)
        .in(col, ids.slice(i, i + 200))
        .eq('envelope_type', 'minor')
        .eq('status', 'completed')
      if (error) throw new Error(`Reading minor agreements failed: ${error.message}`)
      rows.push(...((data ?? []) as AgreementRow[]))
    }
  }

  // Coverage rows point at the signed original.
  const rootIds = [...new Set(rows.map((r) => r.reused_from).filter(Boolean))] as string[]
  const roots = new Map<string, AgreementRow>()
  if (rootIds.length) {
    const { data, error } = await db.from('agreements').select(cols).in('id', rootIds).eq('status', 'completed')
    if (error) throw new Error(`Reading original agreements failed: ${error.message}`)
    for (const r of (data ?? []) as AgreementRow[]) roots.set(r.id, r)
  }
  const resolve = (r: AgreementRow) => (r.reused_from ? roots.get(r.reused_from) ?? null : r)

  const signed = new Map<string, AgreementRow>() // subject key → signed original
  for (const s of subjects) {
    const mine = rows
      .filter((r) => (s.memberId && r.member_id === s.memberId) || (s.participantId && r.participant_id === s.participantId))
      .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
    const top = mine[0] ? resolve(mine[0]) : null
    if (top?.completed_at && agreementExpiry(top.completed_at) > now) signed.set(s.key, top)
  }

  const templateIds = [...new Set([...signed.values()].map((r) => r.template_id).filter(Boolean))] as string[]
  const versions = new Map<string, string | null>()
  if (templateIds.length) {
    const { data, error } = await db.from('esign_templates').select('id, document_version').in('id', templateIds)
    if (error) throw new Error(`Reading template versions failed: ${error.message}`)
    for (const t of data ?? []) versions.set(t.id as string, (t.document_version as string | null) ?? null)
  }

  const signedIds = [...new Set([...signed.values()].map((r) => r.id))]
  const guardians = new Map<string, { email: string | null; name: string | null; values: Record<string, string> | null }>()
  for (let i = 0; i < signedIds.length; i += 200) {
    const { data, error } = await db
      .from('agreement_recipients')
      .select('envelope_row, role_name, email, name, signer_values')
      .in('envelope_row', signedIds.slice(i, i + 200))
      .ilike('role_name', 'guardian')
    if (error) throw new Error(`Reading guardian signers failed: ${error.message}`)
    for (const g of data ?? []) {
      guardians.set(g.envelope_row as string, {
        email: (g.email as string | null) ?? null,
        name: (g.name as string | null) ?? null,
        values: (g.signer_values as Record<string, string> | null) ?? null,
      })
    }
  }

  for (const s of subjects) {
    const a = signed.get(s.key)
    if (!a) {
      out.set(s.key, NO_CONSENT)
      continue
    }
    const version = a.template_id ? versions.get(a.template_id) ?? null : null
    const g = guardians.get(a.id)
    const restricted = !!a.restricted_at
    out.set(s.key, {
      agreementId: a.id,
      agreementVersion: version,
      coversSurveys: !restricted && meetsSurveyAgreement(version),
      restricted,
      digitalCommsOptOut: ticked(g?.values, DIGITAL_COMMS_OPT_OUT_FIELD),
      quoteOptOut: ticked(g?.values, QUOTE_OPT_OUT_FIELD),
      mediaOptOut: ticked(g?.values, MEDIA_OPT_OUT_FIELD),
      guardianEmail: g?.email ?? null,
      guardianName: g?.name ?? null,
    })
  }
  return out
}

// ── Quoting (V2.3 §1.7, §2) ──────────────────────────────────────────────────

/** NY and CO 13–17-year-olds start with quoting off until they turn it on. */
export function defaultAllowQuotes(age: number | null, state: string | null | undefined): boolean {
  const code = state ? normaliseState(state) : undefined
  if (age !== null && age >= 13 && age <= 17 && (code === 'NY' || code === 'CO')) return false
  return true
}

export interface QuoteFacts {
  isMinor: boolean
  age: number | null
  state: string | null
  /** Minors: agreement facts at export time. */
  agreementVersion: string | null
  agreementRestricted: boolean
  parentQuoteOptOut: boolean
  /** Student's account toggle; null = the default for their age and state. */
  studentAllowQuotes: boolean | null
  /** "Don't quote this response" (minors). */
  noQuote: boolean | null
  /** Explicit answer (adults, adult students). */
  quoteConsent: 'named' | 'anonymous' | 'no' | null
  withdrawn: boolean
}

export type QuoteDecision =
  | { eligible: false; reason: string }
  | { eligible: true; attribution: 'minor' | 'minor_under_13' | 'named' | 'anonymous' }

/** Computed at export time, never stored. */
export function quoteEligibility(f: QuoteFacts): QuoteDecision {
  if (f.withdrawn) return { eligible: false, reason: 'withdrawn' }
  if (!f.isMinor) {
    if (f.quoteConsent === 'named') return { eligible: true, attribution: 'named' }
    if (f.quoteConsent === 'anonymous') return { eligible: true, attribution: 'anonymous' }
    return { eligible: false, reason: 'no consent' }
  }
  if (!meetsSurveyAgreement(f.agreementVersion)) return { eligible: false, reason: `agreement below ${SURVEY_MIN_MINOR_AGREEMENT}` }
  if (f.agreementRestricted) return { eligible: false, reason: 'agreement restricted' }
  if (f.parentQuoteOptOut) return { eligible: false, reason: 'parent opted out' }
  if (f.noQuote) return { eligible: false, reason: "ticked don't quote" }
  const under13 = f.age !== null && f.age < 13
  if (!under13) {
    const allow = f.studentAllowQuotes ?? defaultAllowQuotes(f.age, f.state)
    if (!allow) return { eligible: false, reason: 'student quoting off' }
  }
  return { eligible: true, attribution: under13 ? 'minor_under_13' : 'minor' }
}

export function gradeLabel(grade: string | null | undefined): string | null {
  if (!grade) return null
  const m = /(\d{1,2})/.exec(grade)
  if (m && /grade|^\d/.test(grade.toLowerCase())) return `Grade ${Number(m[1])}`
  const college: Record<string, string> = {
    college_freshman: 'College freshman',
    college_sophomore: 'College sophomore',
    college_junior: 'College junior',
    college_senior: 'College senior',
    grad_phd: 'Graduate student',
  }
  return college[grade] ?? null
}

/**
 * §2's fixed format: first name + last initial, grade, and school or state —
 * "Jordan M., Grade 11, Nebraska". Under-13s get nothing identifying. Never
 * a full name, contact details or a date of birth.
 */
export function attributionFor(
  decision: Extract<QuoteDecision, { eligible: true }>,
  p: { firstName: string | null; lastName: string | null; grade: string | null; school: string | null; state: string | null; organisation?: string | null },
): string {
  const first = p.firstName?.trim() ?? ''
  const initial = p.lastName?.trim()?.[0]?.toUpperCase()
  switch (decision.attribution) {
    case 'minor_under_13':
    case 'anonymous':
      return ''
    case 'named':
      return [first, p.organisation ?? p.school].filter(Boolean).join(', ')
    case 'minor': {
      const name = initial ? `${first} ${initial}.` : first
      return [name, gradeLabel(p.grade), p.school || p.state].filter(Boolean).join(', ')
    }
  }
}
