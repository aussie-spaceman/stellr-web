import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { claimUpload } from '@/lib/uploads'
import {
  LICENSE_DOCUMENT_URL_TTL_SECONDS,
  TEACHER_LICENSE_BUCKET,
  isLicenseDocumentType,
  licenseDocumentMagicMatches,
} from '@/lib/teacher-license'

export const dynamic = 'force-dynamic'

// /api/admin/members/[id]/license/document — the member's teaching license
// photo/scan, for the admin member page. Admins only.
//
//   GET  → 302 to a fresh 10-minute signed URL, so the admin can see what they
//          are verifying. Signed per click rather than baked into the page, so a
//          page left open past the TTL still opens the document.
//   POST { storagePath, fileType } → claim a file the admin uploaded on the
//          member's behalf (purpose 'compliance-document-admin'), replacing any
//          previous one. Like the member's own upload, a new document RESETS
//          verification: the admin verifies it as a separate step.

async function requireAdmin(): Promise<NextResponse | null> {
  const { sessionClaims } = await auth()
  return isAdminClaims(sessionClaims) ? null : NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  const db = supabaseServer()
  const { data: license } = await db
    .from('member_teacher_licenses')
    .select('document_path')
    .eq('member_id', id)
    .maybeSingle()
  const path = (license?.document_path as string | null | undefined) ?? null
  if (!path) return NextResponse.json({ error: 'No license document on file for this member' }, { status: 404 })

  const { data: signed } = await db.storage
    .from(TEACHER_LICENSE_BUCKET)
    .createSignedUrl(path, LICENSE_DOCUMENT_URL_TTL_SECONDS)
  if (!signed?.signedUrl) {
    return NextResponse.json({ error: 'The document could not be opened. Try again.' }, { status: 502 })
  }
  const res = NextResponse.redirect(signed.signedUrl, 302)
  res.headers.set('Cache-Control', 'private, no-store')
  return res
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  const db = supabaseServer()
  const { data: license } = await db
    .from('member_teacher_licenses')
    .select('id, document_path')
    .eq('member_id', id)
    .maybeSingle()
  if (!license) {
    return NextResponse.json({ error: 'Save the license details first, then attach the document.' }, { status: 400 })
  }

  const b = await req.json().catch(() => ({}))
  const storagePath = typeof b.storagePath === 'string' ? b.storagePath : ''
  const fileType = typeof b.fileType === 'string' ? b.fileType : ''
  if (!storagePath) return NextResponse.json({ error: 'Choose a file to upload.' }, { status: 400 })
  if (!fileType || !isLicenseDocumentType(fileType)) {
    return NextResponse.json({ error: 'Upload an image (PNG/JPG/WebP/HEIC) or PDF.' }, { status: 400 })
  }

  // Signed under THIS member's folder; expectedPrefix refuses any other path
  // (another member's license included) before storage is touched. The leading
  // bytes are checked too, since the declared type can be spoofed.
  const claimed = await claimUpload({
    purpose: 'compliance-document-admin',
    storagePath,
    expectedPrefix: `${id}/`,
    verify: licenseDocumentMagicMatches,
    verifyError: 'That file doesn’t look like a valid image or PDF.',
  })
  if ('error' in claimed) return NextResponse.json({ error: claimed.error }, { status: claimed.status })

  if (license.document_path && license.document_path !== storagePath) {
    await db.storage.from(TEACHER_LICENSE_BUCKET).remove([license.document_path as string])
  }

  const now = new Date().toISOString()
  const { error } = await db
    .from('member_teacher_licenses')
    .update({ document_path: storagePath, verified_at: null, verified_by: null, verified_label: null, updated_at: now })
    .eq('id', license.id)
  if (error) {
    console.error('[admin] license document update error:', error)
    return NextResponse.json({ error: 'Failed to save document.' }, { status: 500 })
  }

  await logActivity(
    {
      memberId: id,
      category: 'compliance',
      action: 'license_document_uploaded_by_admin',
      summary: 'Teacher license image uploaded by admin — awaiting verification',
      ...(await actorFromAuth()),
    },
    db,
  )

  return NextResponse.json({ ok: true, licenseUpdatedAt: now })
}
