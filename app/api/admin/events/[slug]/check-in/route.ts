import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'

// Check-in management for an event (admins + assigned event managers).
//   GET  — settings + live list of checked-in participants (polled by the door screen)
//   POST — { action: 'open' } | { action: 'close' } | { action: 'regenerate' }
//          { action: 'manual', participantId } | { action: 'undo', participantId }

type Params = { params: Promise<{ slug: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const db = supabaseServer()
  const [{ data: settings }, { data: regs }, { data: merchRows }] = await Promise.all([
    db.from('event_settings').select('check_in_token, check_in_open').eq('event_slug', slug).maybeSingle(),
    db
      .from('registrations')
      .select('id, participants(id, member_id, first_name, last_name, event_role, t_shirt_size, checked_in_at, check_in_method, merch_collected, event_companies(number, name))')
      .eq('event_slug', slug)
      .neq('status', 'withdrawn'),
    // Event-merch line items (included + add-ons) keyed by member, to show at the desk.
    db
      .from('store_order_items')
      .select('name, qty, participant_member_id, store_orders!inner(event_slug)')
      .eq('store_orders.event_slug', slug)
      .not('participant_member_id', 'is', null),
  ])

  const merchByMember = new Map<string, { name: string; qty: number }[]>()
  for (const m of (merchRows ?? []) as { name: string; qty: number; participant_member_id: string }[]) {
    const list = merchByMember.get(m.participant_member_id) ?? []
    list.push({ name: m.name, qty: m.qty })
    merchByMember.set(m.participant_member_id, list)
  }

  const participants = (regs ?? []).flatMap((r) =>
    ((r.participants as Record<string, unknown>[]) ?? []).map((p) => ({
      id: p.id,
      firstName: p.first_name,
      lastName: p.last_name,
      eventRole: p.event_role,
      shirtSize: p.t_shirt_size ?? null,
      checkedInAt: p.checked_in_at ?? null,
      checkInMethod: p.check_in_method ?? null,
      company: p.event_companies ?? null,
      merch: p.member_id ? merchByMember.get(p.member_id as string) ?? [] : [],
      merchCollected: (p.merch_collected as boolean) ?? false,
    }))
  )

  return NextResponse.json({
    checkInOpen: settings?.check_in_open ?? false,
    checkInToken: settings?.check_in_token ?? null,
    participants,
  })
}

export async function POST(req: Request, { params }: Params) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = await req.json().catch(() => null)
  const action = body?.action
  const db = supabaseServer()

  if (action === 'open' || action === 'close' || action === 'regenerate') {
    const { data: settings } = await db
      .from('event_settings')
      .select('check_in_token')
      .eq('event_slug', slug)
      .maybeSingle()

    const update: Record<string, unknown> = { event_slug: slug }
    if (action === 'open') {
      update.check_in_open = true
      if (!settings?.check_in_token) update.check_in_token = randomBytes(16).toString('hex')
    } else if (action === 'close') {
      update.check_in_open = false
    } else {
      update.check_in_token = randomBytes(16).toString('hex')
    }

    const { error } = await db.from('event_settings').upsert(update, { onConflict: 'event_slug' })
    if (error) return NextResponse.json({ error: 'Database error' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'merch_collected' || action === 'merch_uncollected') {
    const participantId = body?.participantId
    if (typeof participantId !== 'string') {
      return NextResponse.json({ error: 'participantId required' }, { status: 400 })
    }
    const { data: row } = await db
      .from('participants')
      .select('id, registrations!inner(event_slug)')
      .eq('id', participantId)
      .eq('registrations.event_slug', slug)
      .maybeSingle()
    if (!row) return NextResponse.json({ error: 'Participant not found for this event' }, { status: 404 })

    const collected = action === 'merch_collected'
    const { error } = await db
      .from('participants')
      .update({ merch_collected: collected, merch_collected_at: collected ? new Date().toISOString() : null })
      .eq('id', participantId)
    if (error) return NextResponse.json({ error: 'Database error' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'manual' || action === 'undo') {
    const participantId = body?.participantId
    if (typeof participantId !== 'string') {
      return NextResponse.json({ error: 'participantId required' }, { status: 400 })
    }
    // Confirm the participant belongs to this event before touching them
    const { data: row } = await db
      .from('participants')
      .select('id, registrations!inner(event_slug)')
      .eq('id', participantId)
      .eq('registrations.event_slug', slug)
      .maybeSingle()
    if (!row) return NextResponse.json({ error: 'Participant not found for this event' }, { status: 404 })

    const { error } = await db
      .from('participants')
      .update(
        action === 'manual'
          ? { checked_in_at: new Date().toISOString(), check_in_method: 'manual' }
          : { checked_in_at: null, check_in_method: null }
      )
      .eq('id', participantId)
    if (error) return NextResponse.json({ error: 'Database error' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
