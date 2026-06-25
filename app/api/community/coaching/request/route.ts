import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { requestSession } from '@/lib/coaching'

// POST — a member requests a coaching session time; the coach is notified.
// Body: { workshopId, preferredDate?, preferredTime?, note? }
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

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
