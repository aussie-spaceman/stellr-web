import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { teacherLicenseSchema, type TeacherLicenseInput } from '@/lib/teacher-license'
import { notifyLicenseVerified } from '@/lib/license-review'

// POST /api/admin/members/[id]/license
// Admin manually verifies (or un-verifies) the teacher license on file. This is
// the "I have checked the documentation Stellr received" action from the PRD.
//
// action 'save' enters or replaces the license details on the member's behalf
// (e.g. the teacher emailed a copy). Same validation as the member's own form
// and, like it, it RESETS verification: entering details is not verifying them.
// Mark verified stays a separate, deliberate click — which the admin can make
// straight after, against the version this save produced.
//
// deep review BG-9: a verify must name the exact license version the admin
// reviewed (licenseUpdatedAt). Between opening the panel and clicking "verify"
// the member can replace the number/expiry or re-upload the image — which bumps
// updated_at and already clears verified_at — so an unguarded verify would
// rubber-stamp data the admin never saw, and that action IS the clearance.
const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.enum(['verify', 'unverify']),
    /** The license's updated_at as rendered in the panel. Required to verify. */
    licenseUpdatedAt: z.string().optional(),
  }),
  teacherLicenseSchema.extend({ action: z.literal('save') }),
])

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    // Name the field for a save (the admin is typing into a form); keep the
    // generic answer for verify/unverify, which only a button sends.
    const issue = parsed.error.issues[0]
    const fromForm = issue && issue.path[0] !== 'action' && issue.path[0] !== 'licenseUpdatedAt'
    return NextResponse.json({ error: fromForm ? issue.message : 'Invalid request' }, { status: 400 })
  }

  const db = supabaseServer()
  if (parsed.data.action === 'save') return saveLicense(db, id, parsed.data)

  const { data: license } = await db
    .from('member_teacher_licenses')
    .select('id, expiry_date')
    .eq('member_id', id)
    .maybeSingle()
  if (!license) return NextResponse.json({ error: 'No license on file for this member' }, { status: 404 })

  const actor = await actorFromAuth()
  const now = new Date().toISOString()
  const verifying = parsed.data.action === 'verify'

  // BG-9: bind the verify to the reviewed version. Missing version → refuse
  // (fail closed). Unverify only removes clearance (the safe direction), so it is
  // not version-guarded.
  if (verifying && !parsed.data.licenseUpdatedAt) {
    return NextResponse.json({ error: 'Missing license version' }, { status: 400 })
  }

  let update = db
    .from('member_teacher_licenses')
    .update({
      verified_at: verifying ? now : null,
      verified_by: verifying ? actor.actorMemberId ?? null : null,
      verified_label: verifying ? actor.actorLabel ?? null : null,
      updated_at: now,
    })
    .eq('id', license.id)
  // The guarded .eq makes the write atomic: it matches no row when the member has
  // edited the license since the admin loaded the panel, so we can't certify the
  // unseen version — we 409 and ask them to re-review the current one.
  if (verifying) update = update.eq('updated_at', parsed.data.licenseUpdatedAt!)
  const { data: updatedRows, error } = await update.select('id')
  if (error) {
    console.error('[admin] license verify error:', error)
    return NextResponse.json({ error: 'Failed to update license' }, { status: 500 })
  }
  if (verifying && (!updatedRows || updatedRows.length === 0)) {
    return NextResponse.json(
      { error: 'This license was changed since you reviewed it. Reload and verify the current version.' },
      { status: 409 },
    )
  }

  await logActivity(
    {
      memberId: id,
      category: 'compliance',
      action: verifying ? 'license_verified' : 'license_unverified',
      summary: verifying ? 'Teacher license verified by admin' : 'Teacher license verification removed',
      ...actor,
    },
    db,
  )
  // Tell the teacher they're cleared (never throws).
  if (verifying) await notifyLicenseVerified(db, id, license.expiry_date as string)

  return NextResponse.json({ ok: true })
}

// Enter or replace the member's license as an admin. One row per member
// (unique member_id), so this is the same upsert the member's own form does.
async function saveLicense(db: SupabaseClient, memberId: string, input: TeacherLicenseInput) {
  const { data: member } = await db.from('members').select('id').eq('id', memberId).maybeSingle()
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const now = new Date().toISOString()
  const { error } = await db.from('member_teacher_licenses').upsert(
    {
      member_id: memberId,
      license_number: input.license_number,
      licensing_state: input.licensing_state,
      expiry_date: input.expiry_date,
      verified_at: null,
      verified_by: null,
      verified_label: null,
      updated_at: now,
    },
    { onConflict: 'member_id' },
  )
  if (error) {
    console.error('[admin] license save error:', error)
    return NextResponse.json({ error: 'Failed to save license' }, { status: 500 })
  }

  await logActivity(
    {
      memberId,
      category: 'compliance',
      action: 'license_submitted_by_admin',
      summary: `Teacher license entered by admin (${input.licensing_state}) — awaiting verification`,
      metadata: { licensing_state: input.licensing_state, expiry_date: input.expiry_date },
      ...(await actorFromAuth()),
    },
    db,
  )

  return NextResponse.json({ ok: true, licenseUpdatedAt: now })
}
