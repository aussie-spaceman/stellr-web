import { NextResponse } from 'next/server'
import { upsertContact } from '@/lib/hubspot'

// Newsletter / "Get Notified" subscriber capture. Accepts an email plus an
// optional name and context (`source`, `event`) — used by the footer
// SubscribeForm (email only) and the event-detail notify modal (name + email).
export async function POST(req: Request) {
  try {
    const { email, name, source, event } = await req.json()
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
    }

    const trimmedName = typeof name === 'string' ? name.trim() : ''
    const [firstName, ...rest] = trimmedName.split(/\s+/)
    const noteParts = [
      source === 'event-notify' ? 'Requested event registration updates' : 'Website subscriber',
      typeof event === 'string' && event ? `(event: ${event})` : '',
    ].filter(Boolean)

    // Best-effort CRM capture (no-op without HUBSPOT_ACCESS_TOKEN) — same
    // pattern as the white-paper / asset-request lead flows.
    await upsertContact({
      email: email.trim(),
      firstName: firstName || undefined,
      lastName: rest.join(' ') || undefined,
      note: noteParts.join(' '),
    })

    console.log(`[subscribe] New subscriber: ${email}${trimmedName ? ` (${trimmedName})` : ''}`)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
