import type { SupabaseClient } from '@supabase/supabase-js'
import { classifyAgreement } from '@/lib/docusign'
import { ISSUE_FAILED_PREFIX } from '@/lib/docusign-agreements'
import { getEventsBySlugs } from '@/lib/sanity'

// "Needs paperwork": participants of upcoming events who need an agreement and
// have nothing in flight. Awaiting a signature is not on the list: that has a
// link out and reminders running. What is on it needs a person: an agreement
// never issued, one that failed on both engines, one voided (including expired
// Stellr signing requests), or one the signer declined.

export type GapReason = 'not_issued' | 'issue_failed' | 'voided' | 'declined'

export interface PaperworkGap {
  participantId: string
  name: string
  eventSlug: string
  eventTitle: string
  eventDate: string
  reason: GapReason
  /** The issue error, or the decline reason, when there is one. */
  detail: string | null
  since: string | null
}

export interface GapParticipant {
  id: string
  name: string
  dateOfBirth: string | null
  eventRole: string | null
  eventSlug: string
  eventTitle: string
  eventDate: string
}

export interface GapEnvelope {
  participant_id: string
  envelope_id: string
  status: string
  issue_error: string | null
  created_at: string
  updated_at: string | null
}

/** Pure core: participants plus their agreement rows in, the ones needing a person out. */
export function findGaps(participants: GapParticipant[], envelopes: GapEnvelope[]): PaperworkGap[] {
  const byParticipant = new Map<string, GapEnvelope[]>()
  for (const e of envelopes) {
    const list = byParticipant.get(e.participant_id) ?? []
    list.push(e)
    byParticipant.set(e.participant_id, list)
  }

  const gaps: PaperworkGap[] = []
  for (const p of participants) {
    if (!classifyAgreement(p.eventRole, p.dateOfBirth)) continue
    const rows = (byParticipant.get(p.id) ?? []).sort((a, b) => b.created_at.localeCompare(a.created_at))
    // Signed (or covered by paperwork on file), or out for signature: nothing to do.
    if (rows.some((r) => ['completed', 'sent', 'delivered', 'created'].includes(r.status))) continue

    const base = { participantId: p.id, name: p.name, eventSlug: p.eventSlug, eventTitle: p.eventTitle, eventDate: p.eventDate }
    const latest = rows[0]
    if (!latest) { gaps.push({ ...base, reason: 'not_issued', detail: null, since: null }); continue }
    const failed = latest.envelope_id.startsWith(ISSUE_FAILED_PREFIX)
    gaps.push({
      ...base,
      reason: failed ? 'issue_failed' : latest.status === 'declined' ? 'declined' : 'voided',
      detail: latest.issue_error,
      since: latest.updated_at ?? latest.created_at,
    })
  }
  return gaps.sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.name.localeCompare(b.name))
}

export async function loadPaperworkGaps(db: SupabaseClient, now = new Date()): Promise<PaperworkGap[]> {
  // Event dates are Mountain-time calendar dates.
  const today = now.toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
  const { data: slugRows, error: slugError } = await db.from('registrations').select('event_slug').neq('status', 'withdrawn')
  if (slugError) throw new Error(`Registration lookup failed: ${slugError.message}`)
  const slugs = [...new Set((slugRows ?? []).map((r) => r.event_slug as string).filter(Boolean))]
  const upcoming = new Map(
    (await getEventsBySlugs(slugs))
      .filter((e) => e.date && e.date.slice(0, 10) >= today)
      .map((e) => [e.slug.current, { title: e.title, date: (e.date as string).slice(0, 10) }]),
  )
  if (!upcoming.size) return []

  const { data: regs, error } = await db
    .from('registrations')
    .select('event_slug, event_title, participants(id, first_name, last_name, date_of_birth, event_role)')
    .neq('status', 'withdrawn')
    .in('event_slug', [...upcoming.keys()])
  if (error) throw new Error(`Participant lookup failed: ${error.message}`)

  const participants: GapParticipant[] = (regs ?? []).flatMap((r) => {
    const event = upcoming.get(r.event_slug as string)!
    return ((r.participants as Record<string, unknown>[] | null) ?? []).map((p) => ({
      id: p.id as string,
      name: [p.first_name, p.last_name].filter(Boolean).join(' '),
      dateOfBirth: (p.date_of_birth as string | null) ?? null,
      eventRole: (p.event_role as string | null) ?? null,
      eventSlug: r.event_slug as string,
      eventTitle: event.title ?? (r.event_title as string),
      eventDate: event.date,
    }))
  })
  if (!participants.length) return []

  const envelopes: GapEnvelope[] = []
  const ids = participants.map((p) => p.id)
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error: envError } = await db
      .from('docusign_envelopes')
      .select('participant_id, envelope_id, status, issue_error, created_at, updated_at')
      .in('participant_id', ids.slice(i, i + 200))
    if (envError) throw new Error(`Agreement lookup failed: ${envError.message}`)
    envelopes.push(...((data ?? []) as GapEnvelope[]))
  }
  return findGaps(participants, envelopes)
}
