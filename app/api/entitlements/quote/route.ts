import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { getQuote } from '@/lib/entitlements'

// What will this offering cost the logged-in member (incl. their tier discount,
// an optional coupon, and account credit)? Read-only; safe to call from the UI.
export async function GET(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const url = new URL(req.url)
  const offering = url.searchParams.get('offering')
  const coupon = url.searchParams.get('coupon')
  if (!offering) return NextResponse.json({ error: 'offering required' }, { status: 400 })

  try {
    const quote = await getQuote(member.id, offering, coupon)
    return NextResponse.json({ quote })
  } catch (err) {
    console.error('[entitlements/quote]:', err)
    return NextResponse.json({ error: 'Could not price this offering' }, { status: 500 })
  }
}
