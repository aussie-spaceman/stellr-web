import { NextResponse } from 'next/server'
import { communityWriteBlock, getCurrentMember } from '@/lib/community'
import { requestSession } from '@/lib/coaching'
import { assertNotImpersonating } from '@/lib/impersonation'

// POST — a member requests a coaching session time; the coach is notified.
// Body: { workshopId, preferredDate?, preferredTime?, note? }
export async function POST(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  // Decision 24: age and guardian-consent restrictions (lib/community).
  const restricted = await communityWriteBlock(member, 'request')
  if (restricted) return restricted

  const { workshopId, preferredDate, preferredTime, note } = await req.json().catch(() => ({}))
  if (!workshopId) return NextResponse.json({ error: 'workshopId is required' }, { status: 400 })

  const ok = await requestSession(member, workshopId, {
    preferredDate: preferredDate ?? null,
    preferredTime: preferredTime ?? null,
    note: note ?? null,
  })
  if (!ok) return NextResponse.json({ error: 'Could not send request' }, { status: 400 })
  return NextResponse.json({ ok: true })
}
