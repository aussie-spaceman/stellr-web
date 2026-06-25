import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { getQuote, bookFromAllocation } from '@/lib/entitlements'

// Book an offering using an INCLUDED allocation (the free path). Returns the
// booking id. If nothing is included (payable > 0) the caller must instead go
// through Stripe checkout, which confirms the paid booking via the webhook.
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { offeringId?: string; participantId?: string } | null
  if (!body?.offeringId) return NextResponse.json({ error: 'offeringId required' }, { status: 400 })

  try {
    // Guard: only allow the free path here; paid bookings must use checkout.
    const quote = await getQuote(member.id, body.offeringId)
    if (!quote.includedAvailable) {
      return NextResponse.json({ error: 'No included allocation — use checkout', payableCents: quote.payableCents }, { status: 409 })
    }
    const bookingId = await bookFromAllocation(member.id, body.offeringId, body.participantId ?? null)
    return NextResponse.json({ bookingId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not book'
    console.error('[entitlements/book]:', err)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
