import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { declineRequest } from '@/lib/coaching-requests'
import { isAdminClaims } from '@/lib/admin-auth'

// Admin: decline a coaching request with a reason (surfaced to the member).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''

  const result = await declineRequest(id, reason)
  if (!result.ok) return NextResponse.json({ error: result.error ?? 'Could not decline' }, { status: 400 })
  return NextResponse.json({ ok: true })
}
