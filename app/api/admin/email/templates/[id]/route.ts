import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { unknownTokens } from '@/lib/email-tokens'
import { tiptapToPlainText } from '@/lib/community'

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  subject: z.string().trim().min(1).max(300).optional(),
  bodyJson: z.unknown().optional(),
})

// PATCH /api/admin/email/templates/[id] — edit a template.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { name, subject, bodyJson } = parsed.data

  if (subject !== undefined || bodyJson !== undefined) {
    const bad = unknownTokens(subject ?? '', bodyJson !== undefined ? tiptapToPlainText(bodyJson) : '')
    if (bad.length) return NextResponse.json({ error: `Unknown merge fields: ${bad.map((t) => `{{${t}}}`).join(', ')}` }, { status: 400 })
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (name !== undefined) update.name = name
  if (subject !== undefined) update.subject = subject
  if (bodyJson !== undefined) update.body_json = bodyJson

  const db = supabaseServer()
  const { error } = await db.from('email_templates').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE /api/admin/email/templates/[id] — soft-delete (archive). Blocked if a
// non-archived campaign still references it (FK is RESTRICT anyway).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params

  const db = supabaseServer()
  const { count } = await db
    .from('email_campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('template_id', id)
    .neq('status', 'archived')
  if (count && count > 0) {
    return NextResponse.json({ error: 'Template is used by an active campaign. Archive the campaign first.' }, { status: 409 })
  }

  const { error } = await db.from('email_templates').update({ is_archived: true }).eq('id', id)
  if (error) return NextResponse.json({ error: 'Failed to archive' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
