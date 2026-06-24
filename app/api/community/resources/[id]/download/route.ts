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
    .select('id, storage_path, title, space_id')
    .eq('id', id)
    .maybeSingle()

  if (!resource) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!resource.storage_path) return NextResponse.json({ error: 'Not a downloadable file' }, { status: 400 })

  // Access is inherited from the container, not the file (decision 6b — no
  // per-resource ACL). Space-scoped files are gated by the space's
  // Open/Private/Secret model; standalone library files are open to members
  // (catalogue downloads of container-attached files go through the
  // container-gated attachment route instead).
  if (resource.space_id) {
    const access = await getSpaceAccessById(member, resource.space_id as string)
    if (!access?.canAccess) {
      return NextResponse.json({ error: 'No access to this resource' }, { status: 403 })
    }
  }

  const url = await signedDownloadUrl(resource.storage_path)
  if (!url) return NextResponse.json({ error: 'Could not generate download link' }, { status: 500 })

  return NextResponse.json({ url, title: resource.title })
}
