import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { loadComplianceForMember } from '@/lib/compliance'
import { actorFromAuth, logActivity } from '@/lib/activity-log'

// GET /api/members/compliance — the current member's clearance state (license +
// background check), so the account page can show status and the license form.
export async function GET() {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = supabaseServer()
  const summary = await loadComplianceForMember(db, member.id)
  return NextResponse.json({
    required: summary ? summary.state !== 'not_required' : false,
    state: summary?.state ?? 'not_required',
    detail: summary?.detail ?? null,
    license: summary?.license ?? null,
    check: summary?.check
      ? { status: summary.check.status, ordered_at: summary.check.ordered_at, expires_at: summary.check.expires_at }
      : null,
  })
}

const licenseSchema = z.object({
  license_number: z.string().trim().min(1, 'License number is required').max(120),
  licensing_state: z.string().trim().min(1, 'Licensing state is required').max(120),
  expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry date must be YYYY-MM-DD'),
})

// POST /api/members/compliance — the teacher enters/updates their license.
// One current license per member (unique member_id): an update replaces the row
// and RESETS verification, since the documentation changed and must be reviewed
// again by an admin.
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = licenseSchema.safeParse(await req.json().catch(() => null))
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

  const summary = await loadComplianceForMember(db, member.id)
  return NextResponse.json({ ok: true, state: summary?.state ?? 'in_process', license: summary?.license ?? null })
}
