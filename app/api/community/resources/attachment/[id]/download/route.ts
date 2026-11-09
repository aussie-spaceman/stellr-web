import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { signedDownloadUrl } from '@/lib/community'
import { getOnboardedMember } from '@/lib/onboarded-member'
import { resolveDownloadableAttachment } from '@/lib/resources-catalogue'
import { logActivity } from '@/lib/activity-log'
import { mayBeViewingAs } from '@/lib/impersonation'
import { auditMutation } from '@/lib/audit/route'
import { noteAudit, selfServiceEvent, type SelfServiceAudit } from '@/lib/community/self-service-audit'

// GET /api/community/resources/attachment/[id]/download
// Catalogue download: gates on CONTAINER access (the attachment's container
// roster + membership floor), re-checked at request time, then returns a
// short-lived signed URL. The storage path is never exposed to the client.
// Logs the viewing container for per-binary download analytics (decision 3).
//
// S0 (Nov 2026): under an admin's view-as the file is still served (view-as is
// a read lens), but nothing is counted or logged: the row would put the admin's
// click on the member's own timeline, as the member.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return audited(req, { action: 'community.resource.download', table: 'container_contents' }, () => downloadAttachment(req, ctx))
}

async function downloadAttachment(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await getOnboardedMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const resolved = await resolveDownloadableAttachment(member, id)
  if (!resolved) return NextResponse.json({ error: 'No access to this resource' }, { status: 403 })
  noteAudit(req, { targetId: id })

  // Files stream via a short-lived signed URL; links open to their destination.
  let url: string | null
  if (resolved.kind === 'link') {
    url = resolved.url
  } else {
    url = await signedDownloadUrl(resolved.storagePath)
    if (!url) return NextResponse.json({ error: 'Could not generate download link' }, { status: 500 })
  }

  // Per-binary open/download signal: bump the aggregate counter + log the event.
  if (!(await mayBeViewingAs())) {
    const db = supabaseServer()
    db.rpc('increment_resource_download', { rid: resolved.binaryId }).then(() => {}, () => {})
    logActivity({
      memberId: member.id,
      category: 'community',
      action: 'resource_downloaded',
      summary: `Opened resource “${resolved.title}”`,
      metadata: { attachmentId: id, binaryId: resolved.binaryId, kind: resolved.kind },
      actorType: 'member',
    }).catch(() => {})
  }

  return NextResponse.json({ url, title: resolved.title, kind: resolved.kind })
}

// The audit event for this route (docs/TENANCY-S5.md, B16): written after the response,
// never for a 4xx, ids and short codes only. lib/community/self-service-audit decides
// what is written; the call stays here because the coverage gate reads it here.
async function audited(req: Request, spec: SelfServiceAudit, run: () => Promise<Response>): Promise<Response> {
  let res: Response | undefined
  try {
    return (res = await run())
  } finally {
    await record(req, res, spec)
  }
}

async function record(req: Request, res: Response | undefined, spec: SelfServiceAudit) {
  const event = await selfServiceEvent(req, res, spec)
  if (!event) return
  await auditMutation(event, { afterResponse: true })
}
