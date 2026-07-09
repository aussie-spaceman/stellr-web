import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'

// GET /api/members/exists?email= — does this email already have a usable Stellr
// account (a member row linked to a Clerk login)? Used by the group-join form to
// prompt an invited person who already has an account to sign in and connect it,
// rather than silently provisioning a second passwordless account.
//
// Must stay public (the join form runs logged-out), so — like members/lookup —
// enumeration is throttled per-IP rather than gated. Without a cap this is an
// account-existence oracle: an unauthenticated caller could confirm whether any
// email belongs to a member (a privacy leak about minors' families and a valid
// list for targeted phishing).
const BURST = { limit: 15, windowMs: 60_000 }          // 15 checks / minute
const SUSTAINED = { limit: 100, windowMs: 3_600_000 }  // 100 checks / hour

export async function GET(req: NextRequest) {
  const ip = clientIp(req)
  const burst = checkRateLimit(`exists:burst:${ip}`, BURST)
  const sustained = checkRateLimit(`exists:sustained:${ip}`, SUSTAINED)
  if (!burst.ok || !sustained.ok) {
    const retryAfter = Math.max(burst.retryAfterSeconds, sustained.retryAfterSeconds)
    return NextResponse.json(
      { hasAccount: false, error: 'Too many requests — please wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    )
  }

  const email = req.nextUrl.searchParams.get('email')?.trim().toLowerCase()
  if (!email) return NextResponse.json({ hasAccount: false })

  const db = supabaseServer()
  const { data } = await db
    .from('members')
    .select('id, clerk_user_id')
    .eq('email', email)
    .eq('is_active', true)
    .maybeSingle()

  return NextResponse.json({ hasAccount: !!data?.clerk_user_id })
}
