import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { RESOURCES_BUCKET } from '@/lib/community'
import { MAX_DIRECT_UPLOAD_BYTES } from '@/lib/upload-client'

// POST /api/admin/community/resources/upload-url — issue a short-lived signed
// upload URL so the browser can send a file STRAIGHT to storage.
//
// Vercel rejects a request body over 4.5MB before the function runs, and that
// cannot be configured away, so any upload larger than that must not pass
// through a route handler at all. Only this metadata does; the bytes go
// browser → Supabase Storage, and the caller then posts the returned path to
// the resource endpoint, which watermarks the object and records the row.
export async function POST(req: Request) {
  const { sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const b = await req.json().catch(() => ({}))
  const fileName = (typeof b.fileName === 'string' ? b.fileName : '').trim()
  const fileSize = Number(b.fileSize)
  const spaceId = (typeof b.spaceId === 'string' && b.spaceId) || null

  if (!fileName) return NextResponse.json({ error: 'fileName is required' }, { status: 400 })
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return NextResponse.json({ error: 'That file came through empty — please try again.' }, { status: 400 })
  }
  if (fileSize > MAX_DIRECT_UPLOAD_BYTES) {
    const limitMb = (MAX_DIRECT_UPLOAD_BYTES / (1024 * 1024)).toFixed(0)
    return NextResponse.json(
      { error: `File too large (max ${limitMb}MB) — add it as a link instead.` },
      { status: 413 },
    )
  }

  // Same path conventions the through-function routes used, so nothing
  // downstream has to care how a resource arrived.
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = spaceId
    ? `community-resources/${spaceId}/${Date.now()}-${safeName}`
    : `resources/${Date.now()}-${safeName}`

  const db = supabaseServer()
  const { data, error } = await db.storage.from(RESOURCES_BUCKET).createSignedUploadUrl(path)
  if (error || !data) {
    console.error('[community] signed upload url error:', error)
    return NextResponse.json({ error: 'Could not start the upload.' }, { status: 500 })
  }

  return NextResponse.json({ bucket: RESOURCES_BUCKET, path: data.path ?? path, token: data.token })
}
