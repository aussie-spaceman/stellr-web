import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { registrationIsOpen, type RegistrationGateSource } from '@/lib/registration'
import { refuse, temporarilyUnavailable, type Refusable } from '../refusal'

// POST /api/register/group-join, whether this link admits anyone right now. Only
// reads. Nothing about the person joining is looked at here: every refusal is the
// same for everyone holding the link.

/** The event fields this route reads. */
export type GroupJoinEvent = RegistrationGateSource & { date?: string | null }

/** What the gate established, for every step that follows. */
export interface GroupJoinLink {
  /** The registration the link belongs to, whole. */
  reg: Record<string, unknown>
  registrationId: string
  eventSlug: string
  eventTitle: string
  schoolName: string
  memberPaysIndividually: boolean
  /** S0 (2 Nov 2026): ages are taken on the event's start date (else today). */
  eventDate: string | null
}

/**
 * The route hands in the Sanity getter, as it hands in the service-role client: it
 * stays the one file that takes them, so test/baselines/** still list it for both.
 */
export async function gateGroupJoinLink(
  db: SupabaseClient,
  token: string,
  getEvent: (slug: string) => Promise<GroupJoinEvent | null>,
): Promise<Refusable<{ link: GroupJoinLink }>> {
  // Validate token
  const { data: tokenRow, error: tokenError } = await db
    .from('group_join_tokens')
    .select('*, registrations(*)')
    .eq('token', token)
    .maybeSingle()

  if (tokenError || !tokenRow) {
    return refuse(NextResponse.json({ error: 'Invalid or expired registration link' }, { status: 404 }))
  }
  if (new Date(tokenRow.expires_at) < new Date()) {
    return refuse(NextResponse.json({ error: 'This registration link has expired' }, { status: 410 }))
  }

  const reg = tokenRow.registrations as Record<string, unknown>
  const eventSlug = tokenRow.event_slug as string

  // Token validity alone is not enough: a still-unexpired link must not admit new
  // participants into a registration the organiser has WITHDRAWN, nor after the
  // event's registration window has CLOSED (the group route enforces the window on
  // create; the join path previously did neither). Both add real participants with
  // DocuSign envelopes, Space grants and payment emails, so gate here too.
  if (reg.status === 'withdrawn' || reg.withdrawn_at != null) {
    return refuse(NextResponse.json(
      { error: 'This group registration has been withdrawn and is no longer accepting participants.' },
      { status: 410 },
    ))
  }
  // deep review REG-4: fail closed. The old `getEventBySlug(...).catch(() => null)`
  // + `if (joinEvent && ...)` admitted new participants during a Sanity outage (or
  // if the event vanished from the CMS) by skipping the window gate entirely —
  // each join adds a real participant with a DocuSign envelope, Space grant and
  // payment email. A transient failure is a retryable 503; an unresolved event
  // can't be confirmed open, so refuse rather than admit.
  let joinEvent: GroupJoinEvent | null
  try {
    joinEvent = await getEvent(eventSlug)
  } catch (e) {
    console.error('[register/group-join] event lookup failed:', e)
    return refuse(temporarilyUnavailable())
  }
  if (!joinEvent || !registrationIsOpen(joinEvent)) {
    return refuse(NextResponse.json(
      { error: 'Registration for this event is closed.' },
      { status: 403 },
    ))
  }

  return {
    ok: true,
    link: {
      reg,
      registrationId: tokenRow.registration_id as string,
      eventSlug,
      eventTitle: tokenRow.event_title as string,
      schoolName: (reg.school_name as string) ?? '',
      memberPaysIndividually: (reg.member_pays_individually as boolean) ?? false,
      eventDate: joinEvent.date ?? null,
    },
  }
}
