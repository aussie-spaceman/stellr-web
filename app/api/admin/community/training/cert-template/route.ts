import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { claimUpload } from '@/lib/uploads'

// Upload (or clear) a per-course certificate template PDF. When set, the member's
// certificate download overlays their details onto this PDF (see the certificate
// pdf route); otherwise a default Stellr certificate is generated.

async function requireAdmin() {
  const { sessionClaims } = await auth()
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // The PDF went browser → storage via /api/uploads/sign; only the path lands
  // here, and claimUpload verifies the object that actually arrived.
  const b = await req.json().catch(() => ({}))
  const moduleId = typeof b.moduleId === 'string' ? b.moduleId : null
  const path = typeof b.storagePath === 'string' ? b.storagePath : ''
  if (!moduleId || !path) {
    return NextResponse.json({ error: 'moduleId and storagePath required' }, { status: 400 })
  }
  if (!path.startsWith(`training/cert-templates/${moduleId}-`)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = supabaseServer()
  const claimed = await claimUpload({
    purpose: 'training-cert-template',
    storagePath: path,
    // This PDF is overlaid onto every certificate for the course, so confirm the
    // stored object really is a PDF rather than trusting the declared type.
    verify: (bytes) =>
      bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46,
    verifyError: 'Template must be a PDF',
  })
  if ('error' in claimed) return NextResponse.json({ error: claimed.error }, { status: claimed.status })

  const { error } = await db.from('training_modules').update({ cert_template_path: path }).eq('id', moduleId)
  if (error) return NextResponse.json({ error: 'Could not save template' }, { status: 500 })
  return NextResponse.json({ ok: true, path })
}

// DELETE ?moduleId= — clear the template (revert to the generated certificate).
export async function DELETE(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const moduleId = new URL(req.url).searchParams.get('moduleId')
  if (!moduleId) return NextResponse.json({ error: 'moduleId required' }, { status: 400 })
  const db = supabaseServer()
  const { error } = await db.from('training_modules').update({ cert_template_path: null }).eq('id', moduleId)
  if (error) return NextResponse.json({ error: 'Could not clear template' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
