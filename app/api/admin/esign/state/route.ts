import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { applyStateUpdate, loadEngineSummary, stateUpdateSchema } from '@/lib/esign/state'

// GET  /api/admin/esign/state — the signing-engine card: which engine new
//       agreements go to, DocuSign allowance used, archive and storage health.
// PATCH /api/admin/esign/state — change the mode, cap, reserve, enabled types,
//       canary allowlist, or clear the "allowance spent" flag.

const noStore = { 'Cache-Control': 'private, no-store' }

export async function GET() {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const summary = await loadEngineSummary(supabaseServer())
  return NextResponse.json(summary, { headers: noStore })
}

export async function PATCH(req: NextRequest) {
  const { userId, sessionClaims } = await auth()
  if (!userId || !isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = stateUpdateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid settings', issues: parsed.error.flatten() }, { status: 400 })
  }

  const db = supabaseServer()
  await applyStateUpdate(db, parsed.data, `admin:${userId}`)
  console.info(`[esign-state] updated by ${userId}:`, JSON.stringify(parsed.data))
  return NextResponse.json(await loadEngineSummary(db), { headers: noStore })
}
