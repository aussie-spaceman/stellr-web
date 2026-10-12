import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'

// GET /api/members/exists?email=&token= — does this email already have a usable
// Stellr account (a member row linked to a Clerk login)? Used by the group-join
// form to prompt an invited person who already has an account to sign in and
// connect it, rather than silently provisioning a second passwordless account.
//
// deep review AUTH-4: this is an account-existence oracle — answering for an
// ARBITRARY email let any unauthenticated caller confirm whether a given child's
// or parent's email belongs to a Stellr member (a privacy leak and a ready-made
// target list for phishing). The only legitimate caller is the group-join form,
// which always holds a live invite token, so we now require a valid, unexpired
// group_join_tokens row before answering. That turns a world-readable oracle into
// one reachable only by someone a group organiser actually invited, without
// changing the form's behaviour. The per-IP, per-instance in-memory cap stays as
// defence in depth (see lib/rate-limit.ts), but it is the token, not the cap,
// that closes the oracle. Fail closed: no/invalid/expired token → hasAccount:false.
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
  const token = req.nextUrl.searchParams.get('token')?.trim()
  if (!email || !token) return NextResponse.json({ hasAccount: false })

  const db = supabaseServer()

  // deep review AUTH-4: require a live invite token before the oracle answers.
  // Validate it the same way the group-join route does (exists + not expired).
  // Any failure path returns the same { hasAccount: false } as a real miss, so
  // the token check itself leaks nothing about which tokens are valid.
  const { data: tokenRow, error: tokenError } = await db
    .from('group_join_tokens')
    .select('expires_at')
    .eq('token', token)
    .maybeSingle()
  if (tokenError || !tokenRow || new Date(tokenRow.expires_at as string) < new Date()) {
    return NextResponse.json({ hasAccount: false })
  }

  const { data } = await db
    .from('members')
    .select('id, clerk_user_id')
    .eq('email', email)
    .eq('is_active', true)
    .maybeSingle()

  return NextResponse.json({ hasAccount: !!data?.clerk_user_id })
}
