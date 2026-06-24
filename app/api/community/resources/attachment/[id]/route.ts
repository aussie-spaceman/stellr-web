import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { canRenameAttachment } from '@/lib/resources-catalogue'

// PATCH /api/community/resources/attachment/[id]
// Rename an attachment (container_contents.display_name). Per-attachment naming
// (decision 1) — scoped to this one attachment, gated to the binary's uploader
// (handover §4.4). Sending an empty name clears the override (reverts to title).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const owner = await canRenameAttachment(member, id)
  if (!owner) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })

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
