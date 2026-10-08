import type { SupabaseClient } from '@supabase/supabase-js'
import { distributionForEvent, statusNow } from '@/lib/survey/distributions'
import { surveyLink, surveyToken } from '@/lib/survey/tokens'

// What a participant sees on their check-in page: the confirmation screen at the
// door and, remembered on their phone, the page they come back to during the
// event. Company is the number only — that is what the room is organised by.

export type SurveyState =
  | { state: 'open'; url: string }
  /** A minor's invitation goes to their parent or guardian, never to the student. */
  | { state: 'guardian' }
  | { state: 'scheduled'; opensOn: string }
  | { state: 'submitted' }
  | { state: 'closed' }

export interface CheckInView {
  participantId: string
  firstName: string
  lastName: string
  checkedInAt: string | null
  shirtSize: string | null
  companyNumber: number | null
  resourcesUrl: string | null
  survey: SurveyState | null
}

export async function loadCheckInView(
  db: SupabaseClient,
  slug: string,
  participantId: string
): Promise<CheckInView | null> {
  const [{ data: p }, { data: settings }] = await Promise.all([
    db
      .from('participants')
      .select('id, first_name, last_name, t_shirt_size, checked_in_at, event_companies(number), registrations!inner(event_slug, status)')
      .eq('id', participantId)
      .eq('registrations.event_slug', slug)
      .neq('registrations.status', 'withdrawn')
      .maybeSingle(),
    db.from('event_settings').select('resources_url').eq('event_slug', slug).maybeSingle(),
  ])
  if (!p) return null

  const company = p.event_companies as unknown as { number: number } | null
  return {
    participantId: p.id,
    firstName: p.first_name,
    lastName: p.last_name,
    checkedInAt: p.checked_in_at ?? null,
    shirtSize: p.t_shirt_size || null,
    companyNumber: company?.number ?? null,
    resourcesUrl: settings?.resources_url ?? null,
    survey: await surveyStateFor(db, slug, p.id).catch(() => null),
  }
}

async function surveyStateFor(db: SupabaseClient, slug: string, participantId: string): Promise<SurveyState | null> {
  const d = await distributionForEvent(db, slug)
  if (!d) return null
  const status = statusNow(d)
  if (status === 'closed') return { state: 'closed' }
  // Paused by an admin: say nothing rather than a go-live date that has passed.
  if (status === 'paused') return null
  if (status === 'scheduled') {
    const opensOn = new Date(d.opens_at).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone: d.event_time_zone,
    })
    return { state: 'scheduled', opensOn }
  }

  const { data: inv } = await db
    .from('survey_invitations')
    .select('id, token_version, send_via, status')
    .eq('distribution_id', d.id)
    .eq('participant_id', participantId)
    .limit(1)
    .maybeSingle()
  // No invitation yet (e.g. a late registrant): the event survey page emails one.
  if (!inv) return { state: 'open', url: `/survey/event/${slug}` }
  if (inv.status === 'submitted') return { state: 'submitted' }
  if (inv.send_via === 'guardian') return { state: 'guardian' }
  // The token is derived, not stored, so this is the same link as their email.
  return { state: 'open', url: surveyLink(surveyToken(inv.id, inv.token_version)) }
}
