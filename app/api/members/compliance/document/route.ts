import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { actorFromAuth, logActivity } from '@/lib/activity-log'

const BUCKET = 'teacher-licenses'
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB
const ALLOWED = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'application/pdf']

// POST — upload a photo/scan of the teacher's license (private bucket). Attaches
// to the member's existing license row; the image is sensitive and only ever
// served via short-lived signed URLs.
export async function POST(req: NextRequest) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = supabaseServer()
  const { data: license } = await db
    .from('member_teacher_licenses')
    .select('id, document_path')
    .eq('member_id', member.id)
    .maybeSingle()
  if (!license) {
    return NextResponse.json({ error: 'Add your license details first, then attach a photo.' }, { status: 400 })
  }

  const form = await req.formData()
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Choose a file to upload.' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File is larger than 10 MB.' }, { status: 400 })
  if (file.type && !ALLOWED.includes(file.type)) {
    return NextResponse.json({ error: 'Upload an image (PNG/JPG/WebP/HEIC) or PDF.' }, { status: 400 })
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${member.id}/${Date.now()}-${safeName}`
  const payload = new Uint8Array(await file.arrayBuffer())

  const { error: uploadError } = await db.storage.from(BUCKET).upload(storagePath, payload, {
    contentType: file.type || 'application/octet-stream',
    upsert: true,
  })
  if (uploadError) {
    console.error('[compliance/document] upload error:', uploadError)
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 })
  }

  // Remove any previous image so we don't orphan objects in the bucket.
  if (license.document_path && license.document_path !== storagePath) {
    await db.storage.from(BUCKET).remove([license.document_path as string])
  }

  // A fresh document resets verification — the admin must review the new image.
  const { error: updateError } = await db
    .from('member_teacher_licenses')
    .update({ document_path: storagePath, verified_at: null, verified_by: null, verified_label: null, updated_at: new Date().toISOString() })
    .eq('id', license.id)
  if (updateError) {
    console.error('[compliance/document] update error:', updateError)
    return NextResponse.json({ error: 'Failed to save document.' }, { status: 500 })
  }

  const actor = await actorFromAuth()
  await logActivity(
    { memberId: member.id, category: 'compliance', action: 'license_document_uploaded', summary: 'Teacher license image uploaded — awaiting verification', ...actor },
    db,
  )

  const { data: signed } = await db.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 10)
  return NextResponse.json({ ok: true, documentUrl: signed?.signedUrl ?? null })
}

// DELETE — the member removes their uploaded license image at any time.
export async function DELETE() {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = supabaseServer()
  const { data: license } = await db
    .from('member_teacher_licenses')
    .select('id, document_path')
    .eq('member_id', member.id)
    .maybeSingle()
  if (!license?.document_path) return NextResponse.json({ ok: true })

  await db.storage.from(BUCKET).remove([license.document_path as string])
  const { error } = await db
    .from('member_teacher_licenses')
    .update({ document_path: null, updated_at: new Date().toISOString() })
    .eq('id', license.id)
  if (error) {
    console.error('[compliance/document] delete error:', error)
    return NextResponse.json({ error: 'Failed to remove document.' }, { status: 500 })
  }

  const actor = await actorFromAuth()
  await logActivity(
    { memberId: member.id, category: 'compliance', action: 'license_document_deleted', summary: 'Teacher license image removed', ...actor },
    db,
  )

  return NextResponse.json({ ok: true })
}
