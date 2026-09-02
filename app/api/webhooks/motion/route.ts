import { NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { HS } from '@/lib/hubspot-fields'
import { createNote, getContactByEmail, upsertContact } from '@/lib/hubspot'

/**
 * Motion booking confirmation → HubSpot.
 *
 * Motion knows whether a time was actually booked; HubSpot does not. Without
 * this the landing-page funnel reads "submitted" and then stops, which makes
 * the decision to require a call on every enquiry unmeasurable — and there is
 * no other join available, because Motion's booking page does not accept
 * prefill parameters, so the only thing tying a booking to a submission is the
 * email address the visitor types on both.
 *
 * Deliberately tolerant about shape and strict about identity. Motion may be
 * wired here directly or through Zapier/Make, and each sends a different
 * envelope; all this needs from the payload is an email address. What it will
 * not do is trust an unsigned request — an endpoint that stamps
 * "call booked" on any contact named in a POST is an open write to the CRM.
 */

const SECRET = process.env.MOTION_WEBHOOK_SECRET

/** Constant-time compare that cannot throw on a length mismatch. */
function signatureMatches(raw: string, provided: string): boolean {
  if (!SECRET) return false
  const expected = createHmac('sha256', SECRET).update(raw).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(provided.replace(/^sha256=/, '').trim(), 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Pull an email out of whichever envelope arrived. */
function findEmail(payload: unknown): string | undefined {
  const seen = new Set<unknown>()
  const stack: unknown[] = [payload]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object' || seen.has(node)) continue
    seen.add(node)
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === 'string' && /email/i.test(key) && value.includes('@')) {
        return value.trim().toLowerCase()
      }
      if (value && typeof value === 'object') stack.push(value)
    }
  }
  return undefined
}

function findWhen(payload: unknown): string | undefined {
  const node = payload as Record<string, unknown> | null
  for (const key of ['startTime', 'start', 'scheduledAt', 'when', 'start_time']) {
    const value = node?.[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

export async function POST(req: Request) {
  if (!SECRET) {
    console.error('[motion-webhook] MOTION_WEBHOOK_SECRET is not set — refusing to write')
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  // The raw body is needed for the signature, so it is read as text and parsed
  // afterwards — req.json() would consume the stream and leave nothing to hash.
  const raw = await req.text()
  const provided =
    req.headers.get('x-motion-signature') ??
    req.headers.get('x-signature') ??
    req.headers.get('x-hub-signature-256') ??
    ''

  if (!provided || !signatureMatches(raw, provided)) {
    return NextResponse.json({ error: 'Bad signature' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Malformed body' }, { status: 400 })
  }

  const email = findEmail(payload)
  if (!email) {
    console.error('[motion-webhook] No email in payload — cannot attribute the booking')
    return NextResponse.json({ error: 'No email in payload' }, { status: 422 })
  }

  // Only ever update someone we already know. Creating a contact here would let
  // a booking from any source invent a landing-page lead that never existed.
  const existing = await getContactByEmail(email, [HS.lpAudience])
  if (!existing) {
    console.warn('[motion-webhook] Booking for an unknown contact:', email)
    return NextResponse.json({ ok: true, matched: false })
  }

  const when = findWhen(payload)
  const written = await upsertContact({
    email,
    properties: { [HS.lpCallBooked]: 'true' },
  })

  // The note is what makes the booking visible on the timeline; the property is
  // what makes it countable. Both, because the funnel needs one and the person
  // picking up the call needs the other.
  await createNote(
    existing.id,
    `Booked an intro call via Motion${when ? ` for ${when}` : ''}.`,
  )

  return NextResponse.json({ ok: written.ok, matched: true })
}
