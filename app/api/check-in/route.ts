import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import { rateLimitGuard, checkRateLimit, HOUR_MS } from '@/lib/rate-limit'
import {
  CHECK_IN_COOKIE,
  CHECK_IN_COOKIE_MAX_AGE,
  checkInCookiePath,
  matchByEmail,
  matchByNameAndDob,
  normaliseName,
  signCheckIn,
  type CheckInCandidate,
} from '@/lib/check-in'
import { loadCheckInView } from '@/lib/check-in-view'

// POST /api/check-in — public, token-gated participant check-in (PRD 6.7).
// Body: { slug, token, firstName, lastName, dob } or { slug, token, email }.
// The token comes from the event QR code (in-person) or the attendance link
// (virtual events), so no login is required at the door. On success the phone
// is remembered for this event (signed cookie, lib/check-in.ts).
//
// DELETE /api/check-in?slug= — "Not you?": forget this phone.

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const slug = str(body?.slug)
  const token = str(body?.token)
  const email = str(body?.email).toLowerCase()
  const firstName = str(body?.firstName)
  const lastName = str(body?.lastName)
  const dob = str(body?.dob)
  const byName = Boolean(firstName && lastName && dob)
  if (!slug || !token || (!email && !byName)) {
    return NextResponse.json({ error: 'Missing details' }, { status: 400 })
  }

  // Keyed by slug+ip and set generously: a whole event legitimately checks in
  // from one venue's Wi-Fi (shared NAT IP), so this only stops bulk scraping.
  const limited = rateLimitGuard(req, 'check-in', { limit: 600, windowMs: HOUR_MS }, slug)
  if (limited) return limited
  // Guessing someone's birthday means many tries at one name; a real person
  // needs two or three. Keyed by name, so a busy shared IP is unaffected.
  if (byName) {
    const rl = checkRateLimit(`check-in-name:${slug}:${normaliseName(firstName)}:${normaliseName(lastName)}`, {
      limit: 10,
      windowMs: HOUR_MS,
    })
    if (!rl.ok) {
      return NextResponse.json({ error: 'Too many tries. Please see the registration desk.' }, { status: 429 })
    }
  }

  const db = supabaseServer()

  const { data: settings } = await db
    .from('event_settings')
    .select('check_in_token, check_in_open')
    .eq('event_slug', slug)
    .maybeSingle()
  if (!settings?.check_in_token || settings.check_in_token !== token) {
    return NextResponse.json({ error: 'This check-in code has expired. Please scan the QR code again.' }, { status: 403 })
  }
  if (!settings.check_in_open) {
    return NextResponse.json({ error: 'Check-in isn’t open yet.' }, { status: 403 })
  }

  const { data: regs } = await db
    .from('registrations')
    .select('id, participants(id, first_name, last_name, nickname, date_of_birth, email, checked_in_at)')
    .eq('event_slug', slug)
    .neq('status', 'withdrawn')
  const candidates = (regs ?? []).flatMap(
    (r) => (r.participants as unknown as (CheckInCandidate & { checked_in_at: string | null })[]) ?? []
  )

  let found: (CheckInCandidate & { checked_in_at: string | null }) | null = null
  if (byName) {
    const m = matchByNameAndDob(candidates, { firstName, lastName, dob })
    if (m.kind === 'need_email') {
      return NextResponse.json(
        { code: 'need_email', error: 'We need the email address you registered with to confirm it’s you.' },
        { status: 404 }
      )
    }
    if (m.kind === 'ambiguous') {
      return NextResponse.json(
        { code: 'ambiguous', error: 'We found more than one match. Please see the registration desk.' },
        { status: 409 }
      )
    }
    if (m.kind === 'match') found = m.candidate
  } else {
    found = matchByEmail(candidates, email)
  }
  if (!found) {
    return NextResponse.json(
      {
        code: 'none',
        error: byName
          ? 'We couldn’t match that name and date of birth. Check both, or try the email you registered with.'
          : 'We couldn’t find a registration for that email. Please see the registration desk.',
      },
      { status: 404 }
    )
  }

  const alreadyCheckedIn = Boolean(found.checked_in_at)
  if (!alreadyCheckedIn) {
    const event = await getEventBySlug(slug)
    const method = (event as { setting?: string } | null)?.setting === 'virtual' ? 'virtual' : 'qr'
    const { error } = await db
      .from('participants')
      .update({ checked_in_at: new Date().toISOString(), check_in_method: method })
      .eq('id', found.id)
      .is('checked_in_at', null)
    if (error) {
      console.error('[check-in] update error:', error)
      return NextResponse.json({ error: 'Something went wrong. Please see the registration desk.' }, { status: 500 })
    }
  }

  const view = await loadCheckInView(db, slug, found.id)
  if (!view) return NextResponse.json({ error: 'Something went wrong. Please see the registration desk.' }, { status: 500 })

  const res = NextResponse.json({ view, alreadyCheckedIn })
  const signed = signCheckIn(slug, found.id)
  if (signed) {
    res.cookies.set(CHECK_IN_COOKIE, signed, {
      path: checkInCookiePath(slug),
      maxAge: CHECK_IN_COOKIE_MAX_AGE,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    })
  }
  return res
}

export async function DELETE(req: Request) {
  const slug = new URL(req.url).searchParams.get('slug')?.trim()
  if (!slug) return NextResponse.json({ error: 'Missing slug' }, { status: 400 })
  const res = NextResponse.json({ ok: true })
  res.cookies.set(CHECK_IN_COOKIE, '', { path: checkInCookiePath(slug), maxAge: 0 })
  return res
}
