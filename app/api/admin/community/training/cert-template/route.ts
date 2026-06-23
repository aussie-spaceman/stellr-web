import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { RESOURCES_BUCKET } from '@/lib/community'

// Upload (or clear) a per-course certificate template PDF. When set, the member's
// certificate download overlays their details onto this PDF (see the certificate
// pdf route); otherwise a default Stellr certificate is generated.

async function requireAdmin() {
  const { sessionClaims } = await auth()
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const form = await req.formData()
  const moduleId = form.get('moduleId') as string | null
  const file = form.get('file') as File | null
  if (!moduleId || !file) return NextResponse.json({ error: 'moduleId and file required' }, { status: 400 })
  if (file.type && file.type !== 'application/pdf') {
    return NextResponse.json({ error: 'Template must be a PDF' }, { status: 400 })
  }

  const db = supabaseServer()
  const path = `training/cert-templates/${moduleId}-${Date.now()}.pdf`
  const { error: uploadError } = await db.storage
    .from(RESOURCES_BUCKET)
    .upload(path, file, { contentType: 'application/pdf', upsert: true })
  if (uploadError) {
    console.error('[training] cert template upload error:', uploadError)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }

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
