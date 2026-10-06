/**
 * "May Stellr use this person's photo, video, name or work in promotion?" —
 * one answer, used by the admin Media do-not-use list and the roster export.
 * (Minors Agreement V2.3 §1.7 and §2; Terms §11.3; privacy runbook Part C.)
 *
 * It combines, in this order:
 *   1. A withdrawn consent (agreements.restricted_at)        → no
 *   2. "I do NOT consent to photo and media use" ticked on
 *      the person's agreement (guardian for a minor)        → no
 *   3. The student's own switch turned off                  → no
 *   4. A minor with no signed agreement on file             → no
 *   5. A minor whose form we cannot read the box from       → check by hand
 *   6. The student's own switch turned on                   → yes
 *   7. NY or CO, aged 13–17 (or a minor of unknown age)     → no until they opt in
 *   8. Otherwise                                            → yes
 *
 * Where the opt-out is read (2 Oct 2026):
 *   - Stellr-signed forms: the signers' checkbox values
 *     (agreement_recipients.signer_values.MediaOptOut).
 *   - `agreements.media_opt_out`, read back from DocuSign as well (#280,
 *     migration 20261002235609, in production since 3 Oct).
 *   - A form whose media box we can't see (DocuSign not read back, or an
 *     older Stellr template without it) is "check": open the
 *     signed PDF (Admin → Consent forms).
 * State is the school's state (no home state is collected); NY/CO applies if
 * any known school state is NY or CO, as runbook Part C says. Opt-outs sent by
 * email are not in the data; they stay on the manual list.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliseState } from '@/lib/locations'
import { ageIfKnown, isMinorPerPolicy } from './minor'

export type MediaStatus = 'yes' | 'no' | 'check'
export type MediaReason =
  | 'consent_withdrawn'
  | 'opted_out_on_agreement'
  | 'student_off'
  | 'no_agreement'
  | 'form_unread'
  | 'opted_in'
  | 'ny_co_default'
  | 'default'

export const MEDIA_REASON_LABEL: Record<MediaReason, string> = {
  consent_withdrawn: 'Consent withdrawn',
  opted_out_on_agreement: 'Opted out on the signed agreement',
  student_off: 'Turned photo/media off in their account',
  no_agreement: 'Minor with no signed agreement on file',
  form_unread: 'Media box not on file: check the signed form',
  opted_in: 'Turned photo/media on in their account',
  ny_co_default: 'NY/CO, 13–17: off until they opt in',
  default: 'No opt-out on file',
}

export interface MediaAgreementFacts {
  exists: boolean
  restricted: boolean
  optOut: boolean
  /** We can see the media box on this form (Stellr-signed, or read back from DocuSign). */
  optOutKnown: boolean
}

export interface MediaFacts {
  isMinor: boolean
  age: number | null
  /** Every state we know for the person's school(s). */
  states: (string | null | undefined)[]
  agreement: MediaAgreementFacts
  /** member_privacy_prefs.allow_media; null = the default. */
  studentAllowMedia: boolean | null
}

export interface MediaDecision {
  status: MediaStatus
  reason: MediaReason
}

const NO_AGREEMENT: MediaAgreementFacts = { exists: false, restricted: false, optOut: false, optOutKnown: false }

export function isNyCo(states: (string | null | undefined)[]): boolean {
  return states.some((s) => {
    const code = s ? normaliseState(s) : undefined
    return code === 'NY' || code === 'CO'
  })
}

/** The single rule. Pure; the loaders below gather the facts. */
export function mediaPermission(f: MediaFacts): MediaDecision {
  const a = f.agreement
  if (a.restricted) return { status: 'no', reason: 'consent_withdrawn' }
  if (a.optOut) return { status: 'no', reason: 'opted_out_on_agreement' }
  if (f.studentAllowMedia === false) return { status: 'no', reason: 'student_off' }
  if (f.isMinor && !a.exists) return { status: 'no', reason: 'no_agreement' }
  if (f.isMinor && !a.optOutKnown) return { status: 'check', reason: 'form_unread' }
  if (f.studentAllowMedia === true) return { status: 'yes', reason: 'opted_in' }
  const teen = f.age !== null ? f.age >= 13 && f.age <= 17 : f.isMinor
  if (teen && isNyCo(f.states)) return { status: 'no', reason: 'ny_co_default' }
  return { status: 'yes', reason: 'default' }
}

// ── Loading ──────────────────────────────────────────────────────────────────

const CHUNK = 200
const ticked = (v: unknown) => v === 'true' || v === true

async function inChunks<T>(ids: string[], read: (slice: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await read(ids.slice(i, i + CHUNK))))
  return out
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

interface ColumnFacts {
  media_opt_out: boolean | null
  form_data_read_at: string | null
  agreement_version: string | null
}

const AGREEMENT_COLS = 'id, member_id, participant_id, completed_at, reused_from, restricted_at, template_id'

/**
 * Agreement facts per subject. A subject's own participant row (the event's
 * agreement) wins over the member's newest, so a roster row reflects the form
 * signed for that event. Coverage rows resolve to the signed original.
 */
export async function loadMediaAgreements(
  db: SupabaseClient,
  subjects: { key: string; memberId: string | null; participantId: string | null }[],
): Promise<Map<string, MediaAgreementFacts>> {
  const out = new Map<string, MediaAgreementFacts>()
  if (!subjects.length) return out
  const memberIds = [...new Set(subjects.map((s) => s.memberId).filter(Boolean))] as string[]
  const participantIds = [...new Set(subjects.map((s) => s.participantId).filter(Boolean))] as string[]

  const rows: AgreementRow[] = []
  for (const [col, ids] of [['member_id', memberIds], ['participant_id', participantIds]] as const) {
    rows.push(
      ...(await inChunks(ids, async (slice) => {
        const { data, error } = await db.from('agreements').select(AGREEMENT_COLS).in(col, slice).eq('status', 'completed')
        if (error) throw new Error(`Reading agreements failed: ${error.message}`)
        return (data ?? []) as AgreementRow[]
      })),
    )
  }
  const rootIds = [...new Set(rows.map((r) => r.reused_from).filter(Boolean))] as string[]
  const roots = new Map<string, AgreementRow>()
  for (const r of await inChunks(rootIds, async (slice) => {
    const { data, error } = await db.from('agreements').select(AGREEMENT_COLS).in('id', slice).eq('status', 'completed')
    if (error) throw new Error(`Reading original agreements failed: ${error.message}`)
    return (data ?? []) as AgreementRow[]
  })) roots.set(r.id, r)

  const newest = (list: AgreementRow[]) => [...list].sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))[0]
  const chosen = new Map<string, AgreementRow>()
  for (const s of subjects) {
    const own = rows.filter((r) => s.participantId && r.participant_id === s.participantId)
    const theirs = own.length ? own : rows.filter((r) => s.memberId && r.member_id === s.memberId)
    const top = theirs.length ? newest(theirs) : undefined
    const signed = top ? (top.reused_from ? roots.get(top.reused_from) : top) : undefined
    // A coverage row whose original is gone still records that a form was signed.
    if (top) chosen.set(s.key, { ...(signed ?? top), restricted_at: top.restricted_at ?? signed?.restricted_at ?? null })
  }

  const ids = [...new Set([...chosen.values()].map((r) => r.id))]
  const values = new Map<string, Record<string, unknown>[]>()
  for (const r of await inChunks(ids, async (slice) => {
    const { data, error } = await db.from('agreement_recipients').select('envelope_row, signer_values').in('envelope_row', slice)
    if (error) throw new Error(`Reading agreement signers failed: ${error.message}`)
    return (data ?? []) as { envelope_row: string; signer_values: Record<string, unknown> | null }[]
  })) {
    if (r.signer_values) values.set(r.envelope_row, [...(values.get(r.envelope_row) ?? []), r.signer_values])
  }

  // agreements.media_opt_out and the read-back markers (#280).
  const columns = new Map<string, ColumnFacts>()
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await db.from('agreements').select('id, media_opt_out, form_data_read_at, agreement_version').in('id', ids.slice(i, i + CHUNK))
    if (error) break
    for (const r of (data ?? []) as unknown as (ColumnFacts & { id: string })[]) columns.set(r.id, r)
  }

  for (const s of subjects) {
    const a = chosen.get(s.key)
    if (!a) {
      out.set(s.key, NO_AGREEMENT)
      continue
    }
    const signerValues = values.get(a.id) ?? []
    const col = columns.get(a.id)
    const boxOnForm = signerValues.some((v) => 'MediaOptOut' in v)
    // DocuSign V2.3 forms carry the media box and are read back on completion.
    const readBack = !!col?.form_data_read_at && /^V?2\.(3|[4-9])|^V?[3-9]/.test(col.agreement_version ?? '')
    out.set(s.key, {
      exists: true,
      restricted: !!a.restricted_at,
      optOut: signerValues.some((v) => ticked(v.MediaOptOut)) || col?.media_opt_out === true,
      optOutKnown: (!!a.template_id && boxOnForm) || readBack,
    })
  }
  return out
}

export interface MediaPerson {
  key: string
  memberId: string | null
  participantId: string | null
  firstName: string
  lastName: string
  role: string | null
  eventSlug: string | null
  eventTitle: string | null
  school: string | null
  states: string[]
  age: number | null
  isMinor: boolean
  decision: MediaDecision
}

interface ParticipantRow {
  id: string
  member_id: string | null
  first_name: string | null
  last_name: string | null
  date_of_birth: string | null
  grade: string | null
  event_role: string | null
  school_name: string | null
  registrations: { event_slug: string | null; event_title: string | null; school_name: string | null; school_address_state: string | null } | null
}

interface MemberRow {
  id: string
  first_name: string | null
  last_name: string | null
  date_of_birth: string | null
  grade: string | null
  age_bracket: string | null
  event_role: string | null
}

const PARTICIPANT_COLS =
  'id, member_id, first_name, last_name, date_of_birth, grade, event_role, school_name, registrations(event_slug, event_title, school_name, school_address_state)'
const MEMBER_COLS = 'id, first_name, last_name, date_of_birth, grade, age_bracket, event_role'

/** Decide for participant rows (and, with `memberOnlyIds`, members with no participant row). */
async function decide(db: SupabaseClient, parts: ParticipantRow[], memberOnlyIds: string[] = []): Promise<MediaPerson[]> {
  const memberIds = [...new Set([...parts.map((p) => p.member_id).filter(Boolean), ...memberOnlyIds])] as string[]
  const members = new Map<string, MemberRow>()
  const prefs = new Map<string, boolean | null>()
  const memberStates = new Map<string, { name: string | null; state: string | null }[]>()
  await inChunks(memberIds, async (slice) => {
    const [m, p, s] = await Promise.all([
      db.from('members').select(MEMBER_COLS).in('id', slice),
      db.from('member_privacy_prefs').select('member_id, allow_media').in('member_id', slice),
      db.from('member_schools').select('member_id, is_current, schools(name, state)').in('member_id', slice),
    ])
    for (const e of [m.error, p.error, s.error]) if (e) throw new Error(`Reading people failed: ${e.message}`)
    for (const r of (m.data ?? []) as MemberRow[]) members.set(r.id, r)
    for (const r of p.data ?? []) prefs.set(r.member_id as string, (r.allow_media as boolean | null) ?? null)
    for (const r of (s.data ?? []) as unknown as { member_id: string; is_current: boolean; schools: { name: string | null; state: string | null } | null }[]) {
      if (!r.schools) continue
      const list = memberStates.get(r.member_id) ?? []
      if (r.is_current) list.unshift(r.schools)
      else list.push(r.schools)
      memberStates.set(r.member_id, list)
    }
    return []
  })

  type Subject = { key: string; memberId: string | null; participantId: string | null; p?: ParticipantRow; m?: MemberRow }
  const subjects: Subject[] = [
    ...parts.map((p) => ({ key: `participant:${p.id}`, memberId: p.member_id, participantId: p.id, p, m: p.member_id ? members.get(p.member_id) : undefined })),
    ...memberOnlyIds.map((id) => ({ key: `member:${id}`, memberId: id, participantId: null, m: members.get(id) })),
  ]
  const agreements = await loadMediaAgreements(db, subjects)

  return subjects.map((s) => {
    const p = s.p
    const m = s.m
    const schools = s.memberId ? memberStates.get(s.memberId) ?? [] : []
    const states = [...new Set([...schools.map((x) => x.state), p?.registrations?.school_address_state].filter(Boolean))] as string[]
    const dob = p?.date_of_birth ?? m?.date_of_birth ?? null
    const role = p?.event_role ?? m?.event_role ?? null
    const student = role === 'participant' || m?.age_bracket === 'high_school' || m?.age_bracket === 'college'
    const isMinor = isMinorPerPolicy({
      dateOfBirth: dob,
      state: states[0],
      ageBracket: m?.age_bracket ?? null,
      grade: p?.grade ?? m?.grade ?? null,
      presumeMinorIfUnknown: student,
    })
    const age = ageIfKnown(dob)
    return {
      key: s.key,
      memberId: s.memberId,
      participantId: s.participantId,
      firstName: p?.first_name ?? m?.first_name ?? '',
      lastName: p?.last_name ?? m?.last_name ?? '',
      role,
      eventSlug: p?.registrations?.event_slug ?? null,
      eventTitle: p?.registrations?.event_title ?? null,
      school: p?.school_name ?? p?.registrations?.school_name ?? schools[0]?.name ?? null,
      states,
      age,
      isMinor,
      decision: mediaPermission({
        isMinor,
        age,
        states,
        agreement: agreements.get(s.key) ?? NO_AGREEMENT,
        studentAllowMedia: s.memberId ? prefs.get(s.memberId) ?? null : null,
      }),
    }
  })
}

/** Media decisions for an event's roster, keyed by participant id. */
export async function mediaForParticipants(db: SupabaseClient, participantIds: string[]): Promise<Map<string, MediaDecision>> {
  const parts = await inChunks(participantIds, async (slice) => {
    const { data, error } = await db.from('participants').select(PARTICIPANT_COLS).in('id', slice)
    if (error) throw new Error(`Reading participants failed: ${error.message}`)
    return (data ?? []) as unknown as ParticipantRow[]
  })
  return new Map((await decide(db, parts)).map((r) => [r.participantId as string, r.decision]))
}

/**
 * Everyone whose image must not be used (status no), and everyone to check by
 * hand (status check): one row per event participation, plus members who
 * turned media off and have no participant row. Optionally one event.
 */
export async function mediaDoNotUseList(db: SupabaseClient, f: { eventSlug?: string | null } = {}): Promise<{ rows: MediaPerson[]; considered: number }> {
  const parts: ParticipantRow[] = []
  if (f.eventSlug) {
    const { data, error } = await db.from('participants').select(`${PARTICIPANT_COLS.replace('registrations(', 'registrations!inner(')}`).eq('registrations.event_slug', f.eventSlug)
    if (error) throw new Error(`Reading participants failed: ${error.message}`)
    parts.push(...((data ?? []) as unknown as ParticipantRow[]))
  } else {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from('participants').select(PARTICIPANT_COLS).order('id').range(from, from + 999)
      if (error) throw new Error(`Reading participants failed: ${error.message}`)
      parts.push(...((data ?? []) as unknown as ParticipantRow[]))
      if (!data || data.length < 1000) break
    }
  }

  let memberOnly: string[] = []
  if (!f.eventSlug) {
    const { data, error } = await db.from('member_privacy_prefs').select('member_id').eq('allow_media', false)
    if (error) throw new Error(`Reading privacy settings failed: ${error.message}`)
    const withParticipant = new Set(parts.map((p) => p.member_id).filter(Boolean))
    memberOnly = (data ?? []).map((r) => r.member_id as string).filter((id) => !withParticipant.has(id))
  }

  const people = await decide(db, parts, memberOnly)
  const rank: Record<MediaStatus, number> = { no: 0, check: 1, yes: 2 }
  const rows = people
    .filter((p) => p.decision.status !== 'yes')
    .sort((a, b) => rank[a.decision.status] - rank[b.decision.status] || a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))
  return { rows, considered: people.length }
}

export const MEDIA_STATUS_LABEL: Record<MediaStatus, string> = { no: 'Do not use', check: 'Check form', yes: 'OK' }

/** The list as CSV rows (header first), for the admin download. */
export function mediaListRows(rows: MediaPerson[]): (string | number | null)[][] {
  return [
    ['media_ok', 'Reason', 'First Name', 'Last Name', 'Role', 'Age', 'Event', 'School', 'School State'],
    ...rows.map((r) => [
      r.decision.status,
      MEDIA_REASON_LABEL[r.decision.reason],
      r.firstName,
      r.lastName,
      r.role,
      r.age,
      r.eventTitle ?? r.eventSlug,
      r.school,
      r.states.join('; '),
    ]),
  ]
}
