import { NextResponse } from 'next/server'
import { requireEventRoute } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { claimUpload, discardUpload } from '@/lib/uploads'
import { isLiteralStoragePath } from '@/lib/storage-path'
import { contentTypeFor, fileExtension, nameMatchesFormat, shortenFileName } from '@/lib/file-sniff'
import { EDITABLE } from '@/lib/event-emails/store'
import type { EventEmailRow } from '@/lib/event-emails/types'
import { loadEventRecord, loadScopedRows, refuseOutsideStellr, scopedRowWrite } from '@/lib/tenancy/load-scoped'

// POST /api/admin/events/[slug]/emails/[id]/attachments — attach a file the
// browser has already uploaded straight to storage (purpose
// 'event-email-attachment'). body: { storagePath, filename, contentType? }
//
// S0 content safety: every registrant (minors included) receives this file
// under the name and type stored here, so neither comes from the request. The
// type is derived from the sniffed bytes, and the name must carry an extension
// that matches them — a CSV can't go out as `schedule.html` / text/html. The
// posted contentType is ignored. A path some email already holds is refused
// untouched: a refusal deletes the object, and it may be another email's file.
//
// A tenant's objects go under its own folder (lib/tenancy/storage.ts) and upload signing
// still writes Stellr's legacy paths, so attaching waits on that. Refused until then.

const ROUTE = '/api/admin/events/[slug]/emails/[id]/attachments'

type Ctx = { params: Promise<{ slug: string; id: string }> }

/** Resend caps a message at 40MB after base64 (≈4/3 growth). */
const MAX_TOTAL_BYTES = 25 * 1024 * 1024

/** The longest name an attachment is stored and sent under. */
const MAX_FILENAME = 200

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event_email.attachment.add', ...auditSubject(req, 'event_emails') }),
  attachFile,
)

async function attachFile(req: Request, { params }: Ctx) {
  const { slug, id } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug, id })
  const refused = refuseOutsideStellr(crew.scope)
  if (refused) return refused

  const b = await req.json().catch(() => ({}))
  const storagePath = typeof b.storagePath === 'string' ? b.storagePath : ''
  // Judged whole; shortened (keeping the extension) only once it passes. Cut
  // first, a 230-character `….pdf` lost its extension and was refused.
  const filename = (typeof b.filename === 'string' ? b.filename : '').trim()
  if (!storagePath || !filename) return NextResponse.json({ error: 'storagePath and filename required' }, { status: 400 })
  // Only objects issued for THIS event's emails. Both this and the holder check
  // below compare strings, so the path must be one storage reads as written:
  // `event-email/<slug>/%2e%2e/<other>/…` is another event's file, and
  // `…/./<held>` another name for one an email already holds.
  if (!isLiteralStoragePath(storagePath) || !storagePath.startsWith(`event-email/${slug}/`)) {
    return NextResponse.json({ error: 'That upload is not one we issued for this event' }, { status: 400 })
  }

  const db = supabaseServer()
  const loaded = await loadEventRecord<EventEmailRow>(crew, 'event_emails', id, {
    db,
    notFound: () => NextResponse.json({ error: 'Email not found' }, { status: 404 }),
    label: ROUTE,
  })
  if (!loaded.ok) return loaded.response
  const email = loaded.row
  if (!EDITABLE.includes(email.status)) return NextResponse.json({ error: 'This email has already been sent' }, { status: 409 })

  // Only an object no email holds yet. Every refusal from here on deletes the
  // object it was given, so a path already attached — to this email or another,
  // sent ones included — is turned away before anything touches it. Attaching it
  // twice would also share one file between emails: deleting either email, or
  // removing the attachment from it, would take it from the other.
  const { data: held, error: heldError } = await loadScopedRows(crew.scope, 'event_emails', {
    db,
    select: 'id, attachments',
    match: { event_slug: slug },
    label: ROUTE,
  })
  if (heldError) return NextResponse.json({ error: 'Could not check that upload. Please try again.' }, { status: 500 })
  const attached = ((held ?? []) as unknown as { attachments: { path: string }[] | null }[]).some((row) =>
    (row.attachments ?? []).some((a) => a?.path === storagePath),
  )
  if (attached) {
    return NextResponse.json(
      { error: 'That file is already attached to an email. Upload it again to attach it here.' },
      { status: 409 },
    )
  }

  const claimed = await claimUpload({ purpose: 'event-email-attachment', storagePath })
  if ('error' in claimed) return NextResponse.json({ error: claimed.error }, { status: claimed.status })

  if (!fileExtension(filename) || !nameMatchesFormat(filename, claimed.format, true)) {
    await discardUpload(claimed.bucket, storagePath)
    return NextResponse.json(
      { error: 'The file name must end in an extension that matches the file, such as .pdf, .docx or .csv.' },
      { status: 415 },
    )
  }

  const total = email.attachments.reduce((n, a) => n + a.size, 0) + claimed.bytes.byteLength
  if (total > MAX_TOTAL_BYTES) {
    await discardUpload(claimed.bucket, storagePath)
    return NextResponse.json({ error: 'Attachments on one email are limited to 25MB in total' }, { status: 413 })
  }

  const sentAs = shortenFileName(filename, MAX_FILENAME)
  const attachment = {
    path: storagePath,
    filename: sentAs,
    size: claimed.bytes.byteLength,
    contentType: contentTypeFor(claimed.format, sentAs),
  }
  const { data, error } = await scopedRowWrite(crew.scope, 'event_emails', id, { db })
    .update({ attachments: [...email.attachments, attachment] })
    .in('status', EDITABLE)
    .select('*')
    .maybeSingle()
  if (error || !data) {
    await discardUpload(claimed.bucket, storagePath)
    return NextResponse.json({ error: 'Could not attach the file' }, { status: 409 })
  }
  return NextResponse.json({ email: data })
}
