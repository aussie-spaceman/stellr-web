import { NextResponse } from 'next/server'
import { getCurrentMember, signedDownloadUrl } from '@/lib/community'
import { resolveDownloadableAttachment } from '@/lib/resources-catalogue'
import { logActivity } from '@/lib/activity-log'

// GET /api/community/resources/attachment/[id]/download
// Catalogue download: gates on CONTAINER access (the attachment's container
// roster + membership floor), re-checked at request time, then returns a
// short-lived signed URL. The storage path is never exposed to the client.
// Logs the viewing container for per-binary download analytics (decision 3).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const resolved = await resolveDownloadableAttachment(member, id)
  if (!resolved) return NextResponse.json({ error: 'No access to this resource' }, { status: 403 })

  const url = await signedDownloadUrl(resolved.storagePath)
  if (!url) return NextResponse.json({ error: 'Could not generate download link' }, { status: 500 })

  // Per-binary download signal, tagged with the attachment it was opened from.
  logActivity({
    memberId: member.id,
    category: 'community',
    action: 'resource_downloaded',
    summary: `Downloaded resource “${resolved.title}”`,
    metadata: { attachmentId: id },
    actorType: 'member',
  }).catch(() => {})

  return NextResponse.json({ url, title: resolved.title })
}
