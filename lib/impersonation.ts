import { auth } from '@clerk/nextjs/server'
import { cookies } from 'next/headers'
import { createHmac, timingSafeEqual } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isAdminClaims } from '@/lib/admin-auth'
import { supabaseServer } from '@/lib/supabase'

// Admin "view as member", across the whole member portal.
//
// The admin keeps their OWN Clerk session; a signed cookie says which member the
// member-facing code should resolve to. Clerk's native sign-in-as was the
// alternative, but it mints a real session as that person — so every write is
// genuinely theirs — and it requires the member to have a Clerk account, which
// plenty do not (createPendingSpaceInvite exists precisely because invitees
// often have no account yet).
//
// Three things keep this safe:
//   1. The cookie is HMAC-signed, so it cannot be forged or retargeted.
//   2. isAdminClaims() is re-checked on EVERY request, not just when the cookie
//      is issued — a cookie surviving a sign-out or a role removal grants nothing.
//   3. getCurrentMember() forces isAdmin:false while impersonating, so the
//      admin's own claims can't make every gate pass and hide what the member
//      would actually see.
//
// Impersonation is READ ONLY: assertNotImpersonating() 403s member-facing
// mutations. See app/api/admin/impersonation.

const COOKIE = 'stellr_impersonate'

/** 30 minutes. Long enough to look around, short enough to forget safely. */
const TTL_SECONDS = 30 * 60

export interface ImpersonationTicket {
  /** The member being viewed. */
  memberId: string
  /** The admin doing the viewing (members.id), for the banner and the audit log. */
  adminMemberId: string | null
  issuedAt: number
}

function secret(): string | undefined {
  // Same fallback ladder as the marketing opt-out token, so this works in every
  // environment that already runs the app rather than failing closed on an env
  // var nobody knew to set.
  return process.env.IMPERSONATION_SECRET ?? process.env.CLERK_SECRET_KEY ?? process.env.CRON_SECRET
}

function sign(payload: string): string | null {
  const key = secret()
  if (!key) return null
  return createHmac('sha256', key).update(payload).digest('base64url')
}

/** Encode a ticket as `<base64url payload>.<signature>`. */
export function encodeTicket(ticket: ImpersonationTicket): string | null {
  const payload = Buffer.from(JSON.stringify(ticket)).toString('base64url')
  const sig = sign(payload)
  return sig ? `${payload}.${sig}` : null
}

/** Verify + decode. Returns null on a bad signature, bad JSON or an expired ticket. */
export function decodeTicket(raw: string | undefined): ImpersonationTicket | null {
  if (!raw) return null
  const idx = raw.lastIndexOf('.')
  if (idx <= 0) return null
  const payload = raw.slice(0, idx)
  const sig = raw.slice(idx + 1)

  const expected = sign(payload)
  if (!expected || !sig || expected.length !== sig.length) return null
  try {
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null
  } catch {
    return null
  }

  try {
    const ticket = JSON.parse(Buffer.from(payload, 'base64url').toString()) as ImpersonationTicket
    if (!ticket?.memberId || typeof ticket.issuedAt !== 'number') return null
    // Belt and braces: the cookie has its own maxAge, but a client can keep
    // sending an expired one, so the TTL is enforced on the value as well.
    if (Date.now() - ticket.issuedAt > TTL_SECONDS * 1000) return null
    return ticket
  } catch {
    return null
  }
}

export const IMPERSONATION_COOKIE = COOKIE
export const IMPERSONATION_TTL_SECONDS = TTL_SECONDS

/**
 * The active impersonation for this request, or null.
 *
 * Re-authorises on every call: a non-admin holding the cookie (role revoked,
 * signed out, or someone else's browser) gets null, not access.
 */
export async function getImpersonation(): Promise<ImpersonationTicket | null> {
  const jar = await cookies()
  const raw = jar.get(COOKIE)?.value
  if (!raw) return null

  const { userId, sessionClaims } = await auth()
  if (!userId || !isAdminClaims(sessionClaims)) return null

  return decodeTicket(raw)
}

/** The member id the member-facing code should act as, or null. */
export async function impersonatedMemberId(): Promise<string | null> {
  return (await getImpersonation())?.memberId ?? null
}

/**
 * Guard for member-facing WRITE paths. Returns a 403 Response when the caller is
 * impersonating, otherwise null.
 *
 *   const blocked = await assertNotImpersonating()
 *   if (blocked) return blocked
 *
 * Impersonation is a lens, not a login: an admin looking at someone's account
 * must not be able to spend their money, sign their documents or post as them.
 */
export async function assertNotImpersonating(): Promise<Response | null> {
  if (!(await getImpersonation())) return null
  return new Response(
    JSON.stringify({
      error: 'Read-only while viewing as a member. Exit view-as to make changes.',
      impersonating: true,
    }),
    { status: 403, headers: { 'Content-Type': 'application/json' } },
  )
}

/**
 * The signed-in member's id — or the impersonated one when an admin is viewing
 * as somebody. The single seam for API routes that resolve the caller straight
 * from Clerk instead of going through getCurrentMember().
 */
export async function currentMemberId(db?: SupabaseClient): Promise<string | null> {
  const impersonated = await impersonatedMemberId()
  if (impersonated) return impersonated

  const { userId } = await auth()
  if (!userId) return null
  const client = db ?? supabaseServer()
  const { data } = await client
    .from('members')
    .select('id')
    .eq('clerk_user_id', userId)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

// Resolves which member a /api/members/* request acts on.
//
// Normally that's the signed-in member (matched by Clerk user id). Admins may
// pass ?memberId=<uuid> to *read* another member's data — this backs the admin
// "view as member" page, which is read-only. A non-admin passing the param is
// ignored and falls through to their own record, so this grants no extra access.
//
// The impersonation cookie is honoured first, so these routes work inside a
// full-portal view-as session without every caller having to append the param.
//
// `columns` is the members select list the caller needs (e.g. 'id, email').
export async function resolveRequestMember<T = Record<string, unknown>>(
  req: Request,
  db: SupabaseClient,
  columns: string,
): Promise<{ member: T | null; unauthorised: boolean }> {
  const { userId, sessionClaims } = await auth()
  if (!userId) return { member: null, unauthorised: true }

  // An explicit ?memberId= wins over the cookie: the read-only mirror page names
  // the member it wants, and an admin who happens to hold a view-as ticket for
  // someone else must not be shown that other person's data here.
  const impersonateId =
    new URL(req.url).searchParams.get('memberId') ?? (await impersonatedMemberId())
  if (impersonateId && isAdminClaims(sessionClaims)) {
    const { data } = await db.from('members').select(columns).eq('id', impersonateId).maybeSingle()
    return { member: (data as T) ?? null, unauthorised: false }
  }

  const { data } = await db
    .from('members')
    .select(columns)
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()
  return { member: (data as T) ?? null, unauthorised: false }
}
