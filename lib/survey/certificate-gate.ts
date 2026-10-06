/**
 * D1: gate an event certificate behind the post-event survey — per event,
 * default off, admins only (handover §11 D1). Gating lifts response rates but
 * biases answers and is coercive for minors, so the gate is narrow:
 *
 *   - only an event credential whose event has a distribution with
 *     `gate_certificate` on,
 *   - only while that survey is open (never once it has closed or is paused),
 *   - only for a person who was invited and has not yet submitted.
 *
 * Never invited → never gated. The decision is a pure function; the loader
 * below reads the rows it needs.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { effectiveStatus, type DistributionStatus } from './schedule'
import { participantIdsFor } from './access'

export interface GateDistribution {
  id: string
  event_slug: string
  event_title: string | null
  gate_certificate: boolean
  status: DistributionStatus
  opens_at: string
  closes_at: string
}

export interface GateInvitation {
  id: string
  distribution_id: string
  status: string
}

export type CertificateGate =
  | { gated: false }
  | { gated: true; invitationId: string; eventTitle: string; closesAt: string; surveyUrl: string }

/** Invitation states that no longer hold a certificate back. */
const CLEARS_GATE = new Set(['submitted', 'expired'])

export function surveyUrlFor(invitationId: string): string {
  return `/community/surveys/open/${invitationId}`
}

export function certificateGate(
  eventSlug: string | null | undefined,
  distributions: GateDistribution[],
  invitations: GateInvitation[],
  now: Date = new Date(),
): CertificateGate {
  if (!eventSlug) return { gated: false }
  for (const d of distributions) {
    if (d.event_slug !== eventSlug || !d.gate_certificate) continue
    if (effectiveStatus(d, now) !== 'open') continue
    const inv = invitations.find((i) => i.distribution_id === d.id && !CLEARS_GATE.has(i.status))
    if (inv) {
      return {
        gated: true,
        invitationId: inv.id,
        eventTitle: d.event_title ?? d.event_slug,
        closesAt: d.closes_at,
        surveyUrl: surveyUrlFor(inv.id),
      }
    }
  }
  return { gated: false }
}

/**
 * Gates for a member's event credentials, keyed by event slug. One query when
 * no event has the gate on (the usual case); the member's invitations are read
 * only for gated events.
 */
export async function certificateGatesFor(
  db: SupabaseClient,
  memberId: string,
  eventSlugs: (string | null | undefined)[],
  now: Date = new Date(),
): Promise<Map<string, CertificateGate>> {
  const out = new Map<string, CertificateGate>()
  const slugs = [...new Set(eventSlugs.filter(Boolean))] as string[]
  if (!slugs.length) return out

  const { data: dists, error } = await db
    .from('survey_distributions')
    .select('id, event_slug, event_title, gate_certificate, status, opens_at, closes_at')
    .in('event_slug', slugs)
    .eq('gate_certificate', true)
  if (error) throw new Error(`Reading survey gates failed: ${error.message}`)
  const distributions = (dists ?? []) as GateDistribution[]
  if (!distributions.length) return out

  const participantIds = await participantIdsFor(db, memberId)
  const owner = participantIds.length
    ? `member_id.eq.${memberId},participant_id.in.(${participantIds.join(',')})`
    : `member_id.eq.${memberId}`
  const { data: invs, error: e2 } = await db
    .from('survey_invitations')
    .select('id, distribution_id, status')
    .in('distribution_id', distributions.map((d) => d.id))
    .or(owner)
  if (e2) throw new Error(`Reading survey invitations failed: ${e2.message}`)
  const invitations = (invs ?? []) as GateInvitation[]

  for (const slug of slugs) {
    const gate = certificateGate(slug, distributions, invitations, now)
    if (gate.gated) out.set(slug, gate)
  }
  return out
}

/** The gate for one credential, or not gated for anything but an event credential. */
export async function certificateGateFor(
  db: SupabaseClient,
  memberId: string,
  cred: { source: string | null; event_slug: string | null },
  now: Date = new Date(),
): Promise<CertificateGate> {
  if (cred.source !== 'event' || !cred.event_slug) return { gated: false }
  return (await certificateGatesFor(db, memberId, [cred.event_slug], now)).get(cred.event_slug) ?? { gated: false }
}
