import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { externalCheckValidUntil, loadComplianceForMember } from '@/lib/compliance'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { assertNotImpersonating } from '@/lib/impersonation'
import { alertLicenseReview } from '@/lib/license-review'
import { recheckEventManagerClearance } from '@/lib/event-manager'
import { LICENSE_DOCUMENT_URL_TTL_SECONDS, TEACHER_LICENSE_BUCKET, teacherLicenseSchema } from '@/lib/teacher-license'
import { auditMutation } from '@/lib/audit/route'
import { selfServiceEvent, type SelfServiceAudit } from '@/lib/community/self-service-audit'

// GET /api/members/compliance — the current member's clearance state (license +
// background check), so the account page can show status and the license form.
export async function GET() {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = supabaseServer()
  const summary = await loadComplianceForMember(db, member.id)

  // Short-lived signed URL for the uploaded license image (private bucket).
  let documentUrl: string | null = null
  if (summary?.license?.document_path) {
    const { data: signed } = await db.storage
      .from(TEACHER_LICENSE_BUCKET)
      .createSignedUrl(summary.license.document_path, LICENSE_DOCUMENT_URL_TTL_SECONDS)
    documentUrl = signed?.signedUrl ?? null
  }

  // The member's own uploaded background check, with its document likewise.
  const external = summary?.external ?? null
  let externalDocumentUrl: string | null = null
  if (external?.document_path) {
    const { data: signed } = await db.storage
      .from(TEACHER_LICENSE_BUCKET)
      .createSignedUrl(external.document_path, LICENSE_DOCUMENT_URL_TTL_SECONDS)
    externalDocumentUrl = signed?.signedUrl ?? null
  }

  return NextResponse.json({
    external: external
      ? {
          issuer: external.issuer,
          completed_on: external.completed_on,
          document_expires_on: external.document_expires_on,
          verified: !!external.verified_at,
          valid_until: externalCheckValidUntil(external),
        }
      : null,
    externalDocumentUrl,
    required: summary ? summary.state !== 'not_required' : false,
    state: summary?.state ?? 'not_required',
    detail: summary?.detail ?? null,
    license: summary?.license ?? null,
    documentUrl,
    check: summary?.check
      ? { status: summary.check.status, ordered_at: summary.check.ordered_at, expires_at: summary.check.expires_at }
      : null,
  })
}

// POST /api/members/compliance — the teacher enters/updates their license.
// One current license per member (unique member_id): an update replaces the row
// and RESETS verification, since the documentation changed and must be reviewed
// again by an admin.
export async function POST(req: Request) {
  return audited(req, { action: 'member.compliance_license.update', table: 'member_teacher_licenses' }, () => saveLicense(req))
}

async function saveLicense(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = teacherLicenseSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }

  const db = supabaseServer()
  const now = new Date().toISOString()
  const { error } = await db.from('member_teacher_licenses').upsert(
    {
      member_id: member.id,
      license_number: parsed.data.license_number,
      licensing_state: parsed.data.licensing_state,
      expiry_date: parsed.data.expiry_date,
      // Re-entry always requires fresh admin verification.
      verified_at: null,
      verified_by: null,
      verified_label: null,
      updated_at: now,
    },
    { onConflict: 'member_id' },
  )
  if (error) {
    console.error('[compliance] license upsert error:', error)
    return NextResponse.json({ error: 'Failed to save license' }, { status: 500 })
  }

  const actor = await actorFromAuth()
  await logActivity(
    {
      memberId: member.id,
      category: 'compliance',
      action: 'license_submitted',
      summary: `Teacher license submitted (${parsed.data.licensing_state}) — awaiting verification`,
      metadata: { licensing_state: parsed.data.licensing_state, expiry_date: parsed.data.expiry_date },
      ...actor,
    },
    db,
  )
  // Staff are told there is a license to verify (never throws).
  await alertLicenseReview(db, member.id, 'details')
  // Re-entry clears verification: Event Manager access it supported ends now.
  await recheckEventManagerClearance(db, member.id, actor)

  const summary = await loadComplianceForMember(db, member.id)
  return NextResponse.json({ ok: true, state: summary?.state ?? 'awaiting_verification', license: summary?.license ?? null })
}

// The audit event for this route (docs/TENANCY-S5.md, B16): written after the response,
// never for a 4xx, ids and short codes only. lib/community/self-service-audit decides
// what is written; the call stays here because the coverage gate reads it here.
async function audited(req: Request, spec: SelfServiceAudit, run: () => Promise<Response>): Promise<Response> {
  let res: Response | undefined
  try {
    return (res = await run())
  } finally {
    await record(req, res, spec)
  }
}

async function record(req: Request, res: Response | undefined, spec: SelfServiceAudit) {
  const event = await selfServiceEvent(req, res, spec)
  if (!event) return
  await auditMutation(event, { afterResponse: true })
}
