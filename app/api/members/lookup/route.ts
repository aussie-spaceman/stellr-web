import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'

// GET /api/members/lookup?membership_id=NNNNNNN&last_name=Smith
//
// Resolve a Stellr Member ID (a participant's membership_id) to the person's
// name so a group organiser can confirm a match before linking. The actual
// linkage is resolved server-side from the same membership_id when the
// registration is submitted.
//
// deep review AUTH-4: membership_id is a zero-padded sequential counter, so a
// lookup that answered on the id ALONE was a walkable directory of members'
// (minors included) names. The endpoint must stay public (group registration is
// used by logged-out teachers), so instead of gating it we require the caller to
// ALSO supply the person's last name and match it server-side: a legitimate
// organiser linking one of their own group members already knows it, but a
// sequential-id scraper does not, so enumeration no longer yields names. We only
// echo the matched name back once the supplied last name is correct — i.e. to a
// caller who already possessed it — never the internal member id or contacts.
//
// Enumeration is additionally throttled: a per-IP burst window sized for a human
// filling in a 20-person roster, plus a sustained cap. (That limiter is
// per-instance in-memory — see lib/rate-limit.ts — so the last-name gate, not the
// cap, is what actually closes the harvest.)
const BURST = { limit: 15, windowMs: 60_000 }          // 15 lookups / minute
const SUSTAINED = { limit: 100, windowMs: 3_600_000 }  // 100 lookups / hour

/** Case-insensitive, whitespace-trimmed surname compare for the confirm gate. */
function surnameMatches(supplied: string, onFile: string | null | undefined): boolean {
  const a = supplied.trim().toLowerCase()
  const b = (onFile ?? '').trim().toLowerCase()
  // Fail closed: an empty supplied name (or an empty on-file name) never matches,
  // so a blank last_name can't be used to bypass the confirm gate.
  return a.length > 0 && a === b
}

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

  const params = new URL(req.url).searchParams
  const raw = params.get('membership_id')?.trim() ?? ''
  const suppliedLastName = params.get('last_name')?.trim() ?? ''
  // deep review AUTH-4: a confirm needs both the id AND the surname. Without a
  // surname there is nothing to match against, so refuse before touching the DB
  // (same shape as a miss — no oracle signal about whether the id exists).
  if (!suppliedLastName) return NextResponse.json({ found: false })
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
    // deep review AUTH-4: only confirm (and echo the name) when the surname the
    // caller supplied matches the record; otherwise it's a miss.
    if (!surnameMatches(suppliedLastName, member.last_name as string | null)) {
      return NextResponse.json({ found: false })
    }
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

  // deep review AUTH-4: same surname gate on the legacy path.
  if (!surnameMatches(suppliedLastName, lastName)) {
    return NextResponse.json({ found: false })
  }
  return NextResponse.json({ found: true, first_name: firstName, last_name: lastName })
}
