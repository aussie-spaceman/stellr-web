import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'

// GET /api/members/lookup?membership_id=NNNNNNN
//
// Resolve a Stellr Member ID (a participant's membership_id) to the person's
// name so a group organiser can confirm a match before linking. Returns the name
// ONLY — never the internal member id or contact details — to limit what a
// sequential-ID guess can reveal. The actual linkage is resolved server-side from
// the same membership_id when the registration is submitted.
//
// The endpoint must stay public (group registration is used by logged-out
// teachers), so enumeration is throttled instead of gated: a per-IP burst window
// sized for a human filling in a 20-person roster, plus a sustained cap that
// bounds how many ID→name pairs one client can harvest per hour.
const BURST = { limit: 15, windowMs: 60_000 }          // 15 lookups / minute
const SUSTAINED = { limit: 100, windowMs: 3_600_000 }  // 100 lookups / hour

export async function GET(req: Request) {
  const ip = clientIp(req)
  const burst = checkRateLimit(`lookup:burst:${ip}`, BURST)
  const sustained = checkRateLimit(`lookup:sustained:${ip}`, SUSTAINED)
  if (!burst.ok || !sustained.ok) {
    const retryAfter = Math.max(burst.retryAfterSeconds, sustained.retryAfterSeconds)
    return NextResponse.json(
      { found: false, error: 'Too many lookups — please wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    )
  }

  const raw = new URL(req.url).searchParams.get('membership_id')?.trim() ?? ''
  // IDs are digits only (stored zero-padded to 7) — reject anything else without
  // touching the DB, and pad short numeric input so "18" finds "0000018".
  if (!/^\d{1,7}$/.test(raw)) return NextResponse.json({ found: false })
  const id = raw.padStart(7, '0')

  const db = supabaseServer()

  // Canonical path: the per-person id now lives on members (migration 036). Try it
  // first. The `.catch`-style error check keeps this working before the migration
  // is applied (column missing → fall through to the participants lookup below).
  const { data: member, error: memberErr } = await db
    .from('members')
    .select('first_name, last_name')
    .eq('membership_id', id)
    .maybeSingle()
  if (!memberErr && member) {
    return NextResponse.json({ found: true, first_name: member.first_name ?? '', last_name: member.last_name ?? '' })
  }

  // Fallback: a legacy participant id (an older badge/email may carry a per-event
  // id that isn't the member's canonical one) — resolve it to the person's name.
  const { data: participant } = await db
    .from('participants')
    .select('first_name, last_name, member_id')
    .eq('membership_id', id)
    .maybeSingle()
  if (!participant) return NextResponse.json({ found: false })

  let firstName = (participant.first_name as string | null) ?? ''
  let lastName = (participant.last_name as string | null) ?? ''
  if (participant.member_id) {
    const { data: linked } = await db
      .from('members')
      .select('first_name, last_name')
      .eq('id', participant.member_id)
      .maybeSingle()
    if (linked) {
      firstName = (linked.first_name as string | null) ?? firstName
      lastName = (linked.last_name as string | null) ?? lastName
    }
  }

  return NextResponse.json({ found: true, first_name: firstName, last_name: lastName })
}
