import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { actorFromAuth, logActivity } from '@/lib/activity-log'

// POST /api/admin/members/[id]/license
// Admin manually verifies (or un-verifies) the teacher license on file. This is
// the "I have checked the documentation Stellr received" action from the PRD.
const bodySchema = z.object({ action: z.enum(['verify', 'unverify']) })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const db = supabaseServer()
  const { data: license } = await db
    .from('member_teacher_licenses')
    .select('id')
    .eq('member_id', id)
    .maybeSingle()
  if (!license) return NextResponse.json({ error: 'No license on file for this member' }, { status: 404 })

  const actor = await actorFromAuth()
  const now = new Date().toISOString()
  const verifying = parsed.data.action === 'verify'

  const { error } = await db
    .from('member_teacher_licenses')
    .update({
      verified_at: verifying ? now : null,
      verified_by: verifying ? actor.actorMemberId ?? null : null,
      verified_label: verifying ? actor.actorLabel ?? null : null,
      updated_at: now,
    })
    .eq('id', license.id)
  if (error) {
    console.error('[admin] license verify error:', error)
    return NextResponse.json({ error: 'Failed to update license' }, { status: 500 })
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

  return NextResponse.json({ ok: true })
}
