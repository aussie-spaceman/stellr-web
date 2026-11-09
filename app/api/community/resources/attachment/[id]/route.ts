import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { communityWriteBlock } from '@/lib/community'
import { getOnboardedMember } from '@/lib/onboarded-member'
import { canRenameAttachment } from '@/lib/resources-catalogue'
import { assertNotImpersonating } from '@/lib/impersonation'
import { auditMutation } from '@/lib/audit/route'
import { noteAudit, selfServiceEvent, type SelfServiceAudit } from '@/lib/community/self-service-audit'

// PATCH /api/community/resources/attachment/[id]
// Rename an attachment (container_contents.display_name). Per-attachment naming
// (decision 1) — scoped to this one attachment, gated to the binary's uploader
// (handover §4.4). Sending an empty name clears the override (reverts to title).
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return audited(req, { action: 'community.resource_attachment.rename', table: 'container_contents' }, () => renameAttachment(req, ctx))
}

async function renameAttachment(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getOnboardedMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  // Decision 24: age and guardian-consent restrictions (lib/community).
  const restricted = await communityWriteBlock(member, 'upload')
  if (restricted) return restricted

  const { id } = await params
  const owner = await canRenameAttachment(member, id)
  if (!owner) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  noteAudit(req, { targetId: id })

  const body = (await req.json().catch(() => ({}))) as { name?: unknown }
  const raw = typeof body.name === 'string' ? body.name.trim() : ''
  if (raw.length > 200) {
    return NextResponse.json({ error: 'Name too long (max 200 characters)' }, { status: 400 })
  }
  const displayName = raw.length === 0 ? null : raw

  const db = supabaseServer()
  const { error } = await db.from('container_contents').update({ display_name: displayName }).eq('id', id)
  if (error) return NextResponse.json({ error: 'Could not rename' }, { status: 500 })

  return NextResponse.json({ ok: true, name: displayName })
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
