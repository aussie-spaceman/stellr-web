import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'

// POST /api/check-in — public, token-gated participant check-in (PRD 6.7).
// Body: { slug, token, email }. The token comes from the event QR code (in-person)
// or the attendance link (virtual events), so no login is required at the door.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : ''
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!slug || !token || !email) {
    return NextResponse.json({ error: 'Missing details' }, { status: 400 })
  }

  const db = supabaseServer()

  const { data: settings } = await db
    .from('event_settings')
    .select('check_in_token, check_in_open')
    .eq('event_slug', slug)
    .maybeSingle()
  if (!settings?.check_in_token || settings.check_in_token !== token) {
    return NextResponse.json({ error: 'Invalid check-in link' }, { status: 403 })
  }
  if (!settings.check_in_open) {
    return NextResponse.json({ error: 'Check-in is not open for this event yet' }, { status: 403 })
  }

  // Find this person among the event's active registrations
  const { data: regs } = await db
    .from('registrations')
    .select('id, status, participants(id, first_name, last_name, email, t_shirt_size, checked_in_at, event_companies(number, name))')
    .eq('event_slug', slug)
    .neq('status', 'withdrawn')

  let participant: Record<string, unknown> | null = null
  for (const reg of regs ?? []) {
    for (const p of (reg.participants as Record<string, unknown>[]) ?? []) {
      if ((p.email as string)?.toLowerCase() === email) {
        participant = p
        break
      }
    }
    if (participant) break
  }
  if (!participant) {
    return NextResponse.json(
      { error: 'No registration found for that email address. Please see the registration desk.' },
      { status: 404 }
    )
  }

  const alreadyCheckedIn = Boolean(participant.checked_in_at)
  if (!alreadyCheckedIn) {
    const event = await getEventBySlug(slug)
    const method = (event as { setting?: string } | null)?.setting === 'virtual' ? 'virtual' : 'qr'
    const { error } = await db
      .from('participants')
      .update({ checked_in_at: new Date().toISOString(), check_in_method: method })
      .eq('id', participant.id as string)
    if (error) {
      console.error('[check-in] update error:', error)
      return NextResponse.json({ error: 'Something went wrong — please see the registration desk.' }, { status: 500 })
    }
  }

  const company = participant.event_companies as { number: number; name: string | null } | null
  return NextResponse.json({
    firstName: participant.first_name,
    lastName: participant.last_name,
    shirtSize: participant.t_shirt_size ?? null,
    company: company ? (company.name ? `Company ${company.number} — ${company.name}` : `Company ${company.number}`) : null,
    alreadyCheckedIn,
  })
}
