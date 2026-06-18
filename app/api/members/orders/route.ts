import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { currentStoreMember } from '@/lib/store/auth'

export const dynamic = 'force-dynamic'

// The signed-in member's store orders (storefront + event merch) with line items,
// for the account "Orders" view. A member only ever sees their own.
export async function GET() {
  const member = await currentStoreMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = supabaseServer()
  const { data, error } = await db
    .from('store_orders')
    .select('id, status, channel, event_slug, total_cents, tracking_url, created_at, items:store_order_items(name, qty, line_source, fulfillment_status)')
    .eq('member_id', member.id)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: 'Could not load orders' }, { status: 500 })

  // Has this member already collected the event merch on each event order? (so the
  // UI only offers reship for genuinely uncollected event merch).
  const { data: parts } = await db
    .from('participants')
    .select('member_id, merch_collected, registrations!inner(event_slug)')
    .eq('member_id', member.id)
  const collectedByEvent = new Map<string, boolean>()
  for (const p of (parts ?? []) as { merch_collected: boolean; registrations: { event_slug: string } | { event_slug: string }[] }[]) {
    const reg = Array.isArray(p.registrations) ? p.registrations[0] : p.registrations
    if (reg?.event_slug) collectedByEvent.set(reg.event_slug, p.merch_collected)
  }

  const orders = (data ?? []).map((o) => ({
    ...o,
    merchCollected: o.event_slug ? collectedByEvent.get(o.event_slug) ?? false : false,
  }))
  return NextResponse.json({ orders })
}
