import { NextResponse } from 'next/server'
import { requireEventAccess } from '@/lib/event-access'
import { supabaseServer } from '@/lib/supabase'
import { claimUpload, discardUpload } from '@/lib/uploads'
import { EDITABLE, getEventEmail } from '@/lib/event-emails/store'

// POST /api/admin/events/[slug]/emails/[id]/attachments — attach a file the
// browser has already uploaded straight to storage (purpose
// 'event-email-attachment'). body: { storagePath, filename, contentType }

type Ctx = { params: Promise<{ slug: string; id: string }> }

/** Resend caps a message at 40MB after base64 (≈4/3 growth). */
const MAX_TOTAL_BYTES = 25 * 1024 * 1024

export async function POST(req: Request, { params }: Ctx) {
  const { slug, id } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const b = await req.json().catch(() => ({}))
  const storagePath = typeof b.storagePath === 'string' ? b.storagePath : ''
  const filename = (typeof b.filename === 'string' ? b.filename : '').trim().slice(0, 200)
  if (!storagePath || !filename) return NextResponse.json({ error: 'storagePath and filename required' }, { status: 400 })
  // Only objects issued for THIS event's emails.
  if (!storagePath.startsWith(`event-email/${slug}/`)) {
    return NextResponse.json({ error: 'That upload is not one we issued for this event' }, { status: 400 })
  }

  const db = supabaseServer()
  const email = await getEventEmail(db, slug, id)
  if (!email) return NextResponse.json({ error: 'Email not found' }, { status: 404 })
  if (!EDITABLE.includes(email.status)) return NextResponse.json({ error: 'This email has already been sent' }, { status: 409 })

  const claimed = await claimUpload({ purpose: 'event-email-attachment', storagePath })
  if ('error' in claimed) return NextResponse.json({ error: claimed.error }, { status: claimed.status })

  const total = email.attachments.reduce((n, a) => n + a.size, 0) + claimed.bytes.byteLength
  if (total > MAX_TOTAL_BYTES) {
    await discardUpload(claimed.bucket, storagePath)
    return NextResponse.json({ error: 'Attachments on one email are limited to 25MB in total' }, { status: 413 })
  }

  const attachment = {
    path: storagePath,
    filename,
    size: claimed.bytes.byteLength,
    contentType: typeof b.contentType === 'string' && b.contentType ? b.contentType : 'application/octet-stream',
  }
  const { data, error } = await db
    .from('event_emails')
    .update({ attachments: [...email.attachments, attachment] })
    .eq('id', id)
    .in('status', EDITABLE)
    .select('*')
    .maybeSingle()
  if (error || !data) {
    await discardUpload(claimed.bucket, storagePath)
    return NextResponse.json({ error: 'Could not attach the file' }, { status: 409 })
  }
  return NextResponse.json({ email: data })
}
