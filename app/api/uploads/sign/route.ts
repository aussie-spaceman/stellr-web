import { NextResponse } from 'next/server'
import { isUploadPurpose, signUpload, type UploadContext } from '@/lib/uploads'

// POST /api/uploads/sign — the single entry point for every file upload.
//
// Returns a short-lived Supabase signed upload URL so the browser can send the
// bytes STRAIGHT to storage. Vercel rejects a request body over 4.5MB before the
// function runs and no configuration changes that, so a file of any real size
// must never pass through a route handler. Only this metadata does.
//
// Authorisation per purpose lives in lib/uploads.ts; the route that later claims
// the object re-checks the object-level rule before recording anything.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}))

  if (!isUploadPurpose(b.purpose)) {
    return NextResponse.json({ error: 'Unknown upload purpose' }, { status: 400 })
  }
  const fileName = (typeof b.fileName === 'string' ? b.fileName : '').trim()
  if (!fileName) return NextResponse.json({ error: 'fileName is required' }, { status: 400 })

  const result = await signUpload({
    purpose: b.purpose,
    ctx: (b.context ?? {}) as UploadContext,
    fileName,
    fileSize: Number(b.fileSize),
    contentType: typeof b.contentType === 'string' ? b.contentType : '',
  })

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result)
}
