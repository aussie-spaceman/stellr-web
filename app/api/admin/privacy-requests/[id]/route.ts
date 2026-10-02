import { auth, currentUser } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { resolveRequest, resolveSchema } from '@/lib/privacy-requests'

// PATCH /api/admin/privacy-requests/:id — { status, note }: mark a confirmed
// privacy request in progress, completed, or refused (with the reason). The
// note is the record of how it was answered.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId, sessionClaims } = await auth()
  if (!userId || !isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = resolveSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  const user = await currentUser().catch(() => null)
  const by = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || userId
  const ok = await resolveRequest(supabaseServer(), id, parsed.data, by)
  if (!ok) return NextResponse.json({ error: 'That request is not open (unconfirmed, or already answered).' }, { status: 409 })
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } })
}
