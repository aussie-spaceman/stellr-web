import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, signedDownloadUrl } from '@/lib/community'
import { getSpaceAccessById } from '@/lib/spaces'

// GET /api/community/resources/[id]/download
// Validates the member's tier, then returns a short-lived signed URL.
// The storage path is never exposed to the client directly (FR-COM-03).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const db = supabaseServer()

  const { data: resource } = await db
    .from('community_resources')
    .select('id, storage_path, title, space_id, event_ref')
    .eq('id', id)
    .maybeSingle()

  if (!resource) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!resource.storage_path) return NextResponse.json({ error: 'Not a downloadable file' }, { status: 400 })

  // deep review MEM-12: this generic route only gated space-scoped rows, so
  // event materials (event_ref set, space_id null) and container-attached
  // contributions (space_id null, but attached to a Cohort/Workshop/Event
  // container) were downloadable by ANY signed-in member who learned the id —
  // bypassing the participant + tier check in the event-materials route and the
  // container-roster check in the attachment route. Those rows must be fetched
  // through their own gated routes; fail closed here.
  if (resource.event_ref) {
    // An event/campaign material — only reachable to participants via
    // /api/community/events/[slug]/materials/[id]/download.
    return NextResponse.json({ error: 'No access to this resource' }, { status: 403 })
  }

  // Access is inherited from the container, not the file (decision 6b — no
  // per-resource ACL). Space-scoped files are gated by the space's
  // Open/Private/Secret model; genuinely standalone library files are open to
  // members (catalogue downloads of container-attached files go through the
  // container-gated attachment route instead).
  if (resource.space_id) {
    const access = await getSpaceAccessById(member, resource.space_id as string)
    if (!access?.canAccess) {
      return NextResponse.json({ error: 'No access to this resource' }, { status: 403 })
    }
  } else {
    // No space and no event_ref: either a truly standalone library file (open to
    // members) or a container-attached contribution. If it is attached to any
    // container it is NOT standalone — it must be downloaded through the
    // container-gated attachment route, which checks the member is actually in a
    // container that holds it. Refuse here rather than leaking it.
    const { data: attachments } = await db
      .from('container_contents')
      .select('container_id')
      .eq('content_type', 'resource')
      .eq('content_ref', id)
      .limit(1)
    if (attachments && attachments.length > 0) {
      return NextResponse.json({ error: 'No access to this resource' }, { status: 403 })
    }
  }

  const url = await signedDownloadUrl(resource.storage_path)
  if (!url) return NextResponse.json({ error: 'Could not generate download link' }, { status: 500 })

  return NextResponse.json({ url, title: resource.title })
}
