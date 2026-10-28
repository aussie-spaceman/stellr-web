import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { assertNotImpersonating } from '@/lib/impersonation'
import { claimUpload } from '@/lib/uploads'
import {
  LICENSE_DOCUMENT_URL_TTL_SECONDS,
  TEACHER_LICENSE_BUCKET,
  isLicenseDocumentType,
  licenseDocumentMagicMatches,
} from '@/lib/teacher-license'

const BUCKET = TEACHER_LICENSE_BUCKET

// POST — record a photo/scan of the teacher's license (private bucket) that the
// browser uploaded straight to storage via /api/uploads/sign. Attaches to the
// member's existing license row; the image is sensitive and only ever served
// via short-lived signed URLs.
export async function POST(req: NextRequest) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

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

  // The bytes went browser → storage via /api/uploads/sign; only the path lands
  // here. This document is sensitive, so the checks that used to run on the
  // request body now run on the STORED object — which is the only version that
  // matters, and the only one the browser can't misrepresent.
  const b = await req.json().catch(() => ({}))
  const storagePath = typeof b.storagePath === 'string' ? b.storagePath : ''
  const fileType = typeof b.fileType === 'string' ? b.fileType : ''
  if (!storagePath) return NextResponse.json({ error: 'Choose a file to upload.' }, { status: 400 })
  if (!fileType || !isLicenseDocumentType(fileType)) {
    return NextResponse.json({ error: 'Upload an image (PNG/JPG/WebP/HEIC) or PDF.' }, { status: 400 })
  }
  // Signed under this member's own prefix; refuse anything else outright.
  if (!storagePath.startsWith(`${member.id}/`)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Defence in depth: the declared type can be spoofed, so confirm the actual
  // leading bytes match a permitted format. A failed check deletes the object.
  const claimed = await claimUpload({
    purpose: 'compliance-document',
    storagePath,
    verify: licenseDocumentMagicMatches,
    verifyError: 'That file doesn’t look like a valid image or PDF.',
  })
  if ('error' in claimed) return NextResponse.json({ error: claimed.error }, { status: claimed.status })

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

  const { data: signed } = await db.storage.from(BUCKET).createSignedUrl(storagePath, LICENSE_DOCUMENT_URL_TTL_SECONDS)
  return NextResponse.json({ ok: true, documentUrl: signed?.signedUrl ?? null })
}

// DELETE — the member removes their uploaded license image at any time.
export async function DELETE() {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

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
