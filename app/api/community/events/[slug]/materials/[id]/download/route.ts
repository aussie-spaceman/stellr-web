import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, memberCanAccess, signedDownloadUrl } from '@/lib/community'
import { memberIsParticipant } from '@/lib/event-portal'

// GET /api/community/events/[slug]/materials/[id]/download
// Two-stage guard (FR-COM-13): the member must (1) be a participant of the event
// and (2) clear the entitlement/tier gate for the material, before we issue a
// short-lived signed URL.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { slug, id } = await params

  const event = await memberIsParticipant(member, slug)
  if (!event || !event.eventId) {
    return NextResponse.json({ error: 'Not a participant of this event' }, { status: 403 })
  }

  const db = supabaseServer()
  const { data: resource } = await db
    .from('community_resources')
    .select('id, storage_path, min_tier_rank, title, event_ref')
    .eq('id', id)
    .maybeSingle()

  // The material must belong to this event (prevents cross-event ref tampering).
  if (!resource || resource.event_ref !== event.eventId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const targetType = event.activityType === 'campaign' ? 'campaign_material' : 'event_material'
  const ok = await memberCanAccess(member, targetType, event.eventId, resource.min_tier_rank, 'download')
  if (!ok) return NextResponse.json({ error: 'Upgrade required' }, { status: 403 })

  const url = await signedDownloadUrl(resource.storage_path)
  if (!url) return NextResponse.json({ error: 'Could not generate link' }, { status: 500 })

  return NextResponse.json({ url, title: resource.title })
}
