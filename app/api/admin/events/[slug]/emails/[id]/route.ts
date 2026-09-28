import { NextResponse } from 'next/server'
import { requireEventAccess } from '@/lib/event-access'
import { supabaseServer } from '@/lib/supabase'
import { EDITABLE, getEventEmail } from '@/lib/event-emails/store'
import { unknownTokens } from '@/lib/event-emails/render'
import { isAudienceKey, type EventEmailAttachment } from '@/lib/event-emails/types'
import { RESOURCES_BUCKET } from '@/lib/community'

// PATCH  /api/admin/events/[slug]/emails/[id] — edit, schedule, unschedule.
//   body: any of { name, subject, body_json, audiences, resend_docusign,
//                  schedule_days_before, attachments, status: 'draft'|'scheduled'|'cancelled' }
// DELETE — remove an unsent email (its attachments go with it). Sent emails stay,
//          because the history refers to them.

type Ctx = { params: Promise<{ slug: string; id: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  const { slug, id } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const db = supabaseServer()
  const email = await getEventEmail(db, slug, id)
  if (!email) return NextResponse.json({ error: 'Email not found' }, { status: 404 })
  if (!EDITABLE.includes(email.status)) {
    return NextResponse.json({ error: 'This email has already been sent — duplicate it to send again' }, { status: 409 })
  }

  const b = await req.json().catch(() => ({}))
  const update: Record<string, unknown> = {}

  if (typeof b.name === 'string') update.name = b.name.trim().slice(0, 200) || 'Untitled email'
  if (typeof b.subject === 'string') update.subject = b.subject.slice(0, 300)
  if (b.body_json !== undefined) update.body_json = b.body_json
  if (typeof b.resend_docusign === 'boolean') update.resend_docusign = b.resend_docusign
  if (Array.isArray(b.audiences)) {
    if (!b.audiences.every(isAudienceKey)) return NextResponse.json({ error: 'Unknown group' }, { status: 400 })
    update.audiences = [...new Set(b.audiences as string[])]
  }
  if (b.schedule_days_before !== undefined) {
    const n = b.schedule_days_before
    if (n !== null && !(Number.isInteger(n) && n >= 0 && n <= 365)) {
      return NextResponse.json({ error: 'Days before the event must be a whole number from 0 to 365' }, { status: 400 })
    }
    update.schedule_days_before = n
  }
  if (Array.isArray(b.attachments)) {
    // Removal only — files are added through the attachments route, which
    // verifies them. Keep just the ones already on this email.
    const keep = new Set((b.attachments as EventEmailAttachment[]).map((a) => a?.path))
    const kept = email.attachments.filter((a) => keep.has(a.path))
    const removed = email.attachments.filter((a) => !keep.has(a.path))
    if (removed.length) await db.storage.from(RESOURCES_BUCKET).remove(removed.map((a) => a.path))
    update.attachments = kept
  }
  if (b.status !== undefined) {
    if (!['draft', 'scheduled', 'cancelled'].includes(b.status)) {
      return NextResponse.json({ error: 'Unknown status' }, { status: 400 })
    }
    if (b.status === 'scheduled') {
      const next = { ...email, ...update } as typeof email
      if (next.schedule_days_before == null) return NextResponse.json({ error: 'Choose how many days before the event to send it' }, { status: 400 })
      if (!next.audiences.length) return NextResponse.json({ error: 'Choose at least one group to send to' }, { status: 400 })
      if (!next.subject.trim()) return NextResponse.json({ error: 'Add a subject first' }, { status: 400 })
      const bad = unknownTokens(next.subject, next.body_json)
      if (bad.length) return NextResponse.json({ error: `Unknown merge field: ${bad.map((t) => `{{${t}}}`).join(', ')}` }, { status: 400 })
    }
    update.status = b.status
  }

  // The status guard in the WHERE stops an edit racing a send that just claimed the row.
  const { data, error } = await db
    .from('event_emails')
    .update(update)
    .eq('id', id)
    .in('status', EDITABLE)
    .select('*')
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'This email is sending now and can no longer be edited' }, { status: 409 })
  return NextResponse.json({ email: data })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { slug, id } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const db = supabaseServer()
  const email = await getEventEmail(db, slug, id)
  if (!email) return NextResponse.json({ error: 'Email not found' }, { status: 404 })
  if (!EDITABLE.includes(email.status)) {
    return NextResponse.json({ error: 'Sent emails are kept for the history' }, { status: 409 })
  }
  if (email.attachments.length) await db.storage.from(RESOURCES_BUCKET).remove(email.attachments.map((a) => a.path))
  await db.from('event_emails').delete().eq('id', id).in('status', EDITABLE)
  return NextResponse.json({ ok: true })
}
