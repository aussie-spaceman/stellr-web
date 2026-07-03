import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { getEventBySlug } from '@/lib/sanity'
import { isVolunteer } from '@/lib/volunteer'
import { logActivity } from '@/lib/activity-log'

/**
 * POST { eventSlug, interested } — a volunteer raising (or withdrawing) their
 * hand to support an event or campaign. Assignment stays manual: admins see the
 * interest on the event's Volunteers panel and assign from there.
 */
export async function POST(req: NextRequest) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!(await isVolunteer(member.id))) {
    return NextResponse.json({ error: 'Only volunteers can offer event support.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const eventSlug = String(body.eventSlug ?? '').trim()
  const interested = body.interested !== false
  if (!eventSlug) return NextResponse.json({ error: 'eventSlug required' }, { status: 400 })

  // Content comes from Sanity — verify the slug is a real published event/campaign.
  const event = await getEventBySlug(eventSlug).catch(() => null)
  const eventTitle = (event as { title?: string } | null)?.title
  if (!eventTitle) return NextResponse.json({ error: 'Event not found.' }, { status: 404 })

  const db = supabaseServer()
  const { error } = await db.from('volunteer_event_interest').upsert(
    {
      member_id: member.id,
      event_slug: eventSlug,
      event_title: eventTitle,
      status: interested ? 'interested' : 'withdrawn',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'member_id,event_slug' },
  )
  if (error) {
    console.error('[volunteer/interest] upsert error:', error)
    return NextResponse.json({ error: 'Could not save your interest.' }, { status: 500 })
  }

  await logActivity({
    memberId: member.id,
    category: 'event',
    action: interested ? 'volunteer_interest_offered' : 'volunteer_interest_withdrawn',
    summary: interested
      ? `Offered to volunteer at ${eventTitle}`
      : `Withdrew volunteer offer for ${eventTitle}`,
    metadata: { eventSlug, eventTitle },
    actorType: 'member',
    actorMemberId: member.id,
  }, db)

  return NextResponse.json({ ok: true, interested })
}
