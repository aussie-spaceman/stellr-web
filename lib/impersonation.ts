import { auth } from '@clerk/nextjs/server'
import { cookies } from 'next/headers'
import { createHmac, timingSafeEqual } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isAdminClaims } from '@/lib/admin-auth'
import { supabaseServer } from '@/lib/supabase'
import { IMPERSONATION_COOKIE } from '@/lib/impersonation-cookie'

// Admin "view as member", across the whole member portal.
//
// The admin keeps their OWN Clerk session; a signed cookie says which member the
// member-facing code should resolve to. Clerk's native sign-in-as was the
// alternative, but it mints a real session as that person — so every write is
// genuinely theirs — and it requires the member to have a Clerk account, which
// plenty do not (createPendingSpaceInvite exists precisely because invitees
// often have no account yet).
//
// Four things keep this safe:
//   1. The cookie is HMAC-signed with a key used for nothing else, so it cannot
//      be forged or retargeted.
//   2. isAdminClaims() is re-checked on EVERY request, not just when the cookie
//      is issued — a cookie surviving a sign-out or a role removal grants nothing.
//   3. Every ticket names the admin who issued it, and only that admin can use
//      it (getImpersonation).
//   4. getCurrentMember() forces isAdmin:false while impersonating, so the
//      admin's own claims can't make every gate pass and hide what the member
//      would actually see.
//
// Impersonation is READ ONLY: assertNotImpersonating() 403s member-facing
// mutations. Starting and ending it is audited, and neither happens unless the
// audit row is written. See app/api/admin/impersonation.

const COOKIE = IMPERSONATION_COOKIE

/** 30 minutes. Long enough to look around, short enough to forget safely. */
const TTL_SECONDS = 30 * 60

/** 32 characters: the floor for the repo's other HMAC secrets. */
const MIN_SECRET_LENGTH = 32

export interface ImpersonationTicket {
  /** The member being viewed. */
  memberId: string
  /** The admin doing the viewing (members.id): the only person the ticket works for. */
  adminMemberId: string
  issuedAt: number
}

export class ImpersonationNotConfiguredError extends Error {
  constructor() {
    super(
      'View as member is switched off on this deployment: IMPERSONATION_SECRET is not set ' +
        `(it must be its own random value of at least ${MIN_SECRET_LENGTH} characters).`,
    )
    this.name = 'ImpersonationNotConfiguredError'
  }
}

// S0 (Nov 2026): the key used to fall back to CLERK_SECRET_KEY, then
// CRON_SECRET. Either of those leaking (a cron URL in a log, a Clerk key in a
// screenshot) would have let anyone mint a ticket, and rotating one silently
// changed the other. The key is now dedicated: unset, too short, or a copy of
// one of those two, and view-as is off. Nothing else depends on it, so a
// deployment without it loses view-as and nothing more.
function secretOrNull(): string | null {
  const key = process.env.IMPERSONATION_SECRET
  if (!key || key.length < MIN_SECRET_LENGTH) return null
  if (key === process.env.CLERK_SECRET_KEY || key === process.env.CRON_SECRET) return null
  return key
}

/** Whether view-as can run on this deployment. The start route checks this first. */
export function impersonationConfigured(): boolean {
  return secretOrNull() !== null
}

/** The signing key. Throws ImpersonationNotConfiguredError when there isn't a usable one. */
export function impersonationSecret(): string {
  const key = secretOrNull()
  if (!key) throw new ImpersonationNotConfiguredError()
  return key
}

function sign(payload: string): string {
  return createHmac('sha256', impersonationSecret()).update(payload).digest('base64url')
}

/**
 * Encode a ticket as `<base64url payload>.<signature>`. Throws when view-as
 * isn't configured, or when the ticket names no issuing admin: an unbound
 * ticket would work for any admin who got hold of it.
 */
export function encodeTicket(ticket: ImpersonationTicket): string {
  if (!ticket.memberId || !ticket.adminMemberId) {
    throw new Error('An impersonation ticket needs both the member and the issuing admin.')
  }
  const payload = Buffer.from(JSON.stringify(ticket)).toString('base64url')
  return `${payload}.${sign(payload)}`
}

/**
 * Verify + decode. Returns null on a bad signature, bad JSON, an expired
 * ticket, a ticket with no issuing admin — and when view-as isn't configured,
 * so a stray cookie on a deployment without the key reads as no session rather
 * than an error on every member page.
 */
export function decodeTicket(raw: string | undefined): ImpersonationTicket | null {
  if (!raw) return null
  const idx = raw.lastIndexOf('.')
  if (idx <= 0) return null
  const payload = raw.slice(0, idx)
  const sig = raw.slice(idx + 1)

  if (!impersonationConfigured()) return null
  const expected = sign(payload)
  if (!sig || expected.length !== sig.length) return null
  try {
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null
  } catch {
    return null
  }

  try {
    const ticket = JSON.parse(Buffer.from(payload, 'base64url').toString()) as ImpersonationTicket
    if (!ticket?.memberId || typeof ticket.issuedAt !== 'number') return null
    if (typeof ticket.adminMemberId !== 'string' || !ticket.adminMemberId) return null
    // Belt and braces: the cookie has its own maxAge, but a client can keep
    // sending an expired one, so the TTL is enforced on the value as well.
    if (Date.now() - ticket.issuedAt > TTL_SECONDS * 1000) return null
    return ticket
  } catch {
    return null
  }
}

export { IMPERSONATION_COOKIE }
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

  const ticket = decodeTicket(raw)
  if (!ticket) return null

  // deep review AUTH-9: bind the ticket to the admin who issued it. isAdminClaims
  // alone would let ANY admin — or a leaked cookie replayed in another admin's
  // browser — drive a view-as ticket minted for someone else. Require the caller
  // to BE the issuer: resolve the caller's member id and fail closed on any
  // mismatch, including an unresolvable caller row or a failed read.
  //
  // S0 (Nov 2026): this used to be skipped for a ticket with no adminMemberId
  // (an admin with no member row). Such tickets are no longer issued, and
  // decodeTicket rejects them, so the binding always runs.
  //
  // This DB read only runs while a view-as cookie is present, i.e. for the admin
  // actively viewing-as, never on the normal member path.
  const { data, error } = await supabaseServer()
    .from('members')
    .select('id')
    .eq('clerk_user_id', userId)
    .maybeSingle()
  if (error) return null
  const callerMemberId = (data as { id: string } | null)?.id ?? null
  if (!callerMemberId || callerMemberId !== ticket.adminMemberId) return null

  return ticket
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

// Resolves which member a /api/members/* request acts on: the member an admin is
// viewing as, while they hold a valid view-as ticket (getImpersonation), and
// otherwise the signed-in member (matched by Clerk user id). `impersonating`
// tells the route it is serving a read-only view-as, so it can skip any write a
// GET would otherwise make on the member's behalf.
//
// S0 (Nov 2026): admins could also pass ?memberId=<uuid> to read any member's
// billing and teams — no ticket, so no audit row, and no is_active filter. That
// override is gone. The admin account summary page now starts a view-as
// session instead, which is audited and bound to the admin who started it.
//
// A member acting as themselves needs an active row. View-as does not: it is an
// admin's oversight lens, already audited and bound to that admin, and the
// account summary's Teams and Billing tabs run on it — an admin answering a
// refund request from a family that deleted its account (Clerk user.deleted
// sets is_active=false) must still see that member's invoices. The full-portal
// view-as path (lib/community resolveMember) has no is_active filter either.
//
// `columns` is the members select list the caller needs (e.g. 'id, email').
export async function resolveRequestMember<T = Record<string, unknown>>(
  db: SupabaseClient,
  columns: string,
): Promise<{ member: T | null; unauthorised: boolean; impersonating: boolean }> {
  const { userId } = await auth()
  if (!userId) return { member: null, unauthorised: true, impersonating: false }

  const viewAsId = await impersonatedMemberId()
  const { data } = await (viewAsId
    ? db.from('members').select(columns).eq('id', viewAsId)
    : db.from('members').select(columns).eq('clerk_user_id', userId).eq('is_active', true)
  ).maybeSingle()
  return { member: (data as T) ?? null, unauthorised: false, impersonating: !!viewAsId }
}

/**
 * What the view-as banner needs, or null when nobody is being viewed as.
 * `member` is getCurrentMember()'s result, which is already the impersonated
 * member; the admin behind it is named from the ticket.
 */
export async function viewAsBannerProps(
  member: { first_name: string | null; last_name: string | null; email: string | null } | null,
): Promise<{ memberId: string; memberName: string; adminName: string | null } | null> {
  const impersonation = await getImpersonation()
  if (!impersonation || !member) return null
  const memberName = [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email || 'this member'
  const { data } = await supabaseServer()
    .from('members')
    .select('first_name, last_name, email')
    .eq('id', impersonation.adminMemberId)
    .maybeSingle()
  const a = data as { first_name: string | null; last_name: string | null; email: string | null } | null
  const adminName = a ? [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email : null
  return { memberId: impersonation.memberId, memberName, adminName }
}
