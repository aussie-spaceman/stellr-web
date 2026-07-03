import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { actorFromAuth } from '@/lib/activity-log'
import { grantVolunteerRole, revokeVolunteerRole } from '@/lib/volunteer'

// Admin toggle for the additive volunteer role (PRD §15: "update whether an
// account is a Volunteer or not"). Granting also puts the member on the
// Volunteer Space roster; revoking removes them.

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: Request, { params }: Ctx) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const db = supabaseServer()
  const actor = await actorFromAuth()
  await grantVolunteerRole(db, id, actor, 'admin')
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const db = supabaseServer()
  const actor = await actorFromAuth()
  await revokeVolunteerRole(db, id, actor)
  return NextResponse.json({ ok: true })
}
