import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SITE_URL, AUTH_APP_URL } from '@/lib/env'
import { rateLimitGuard } from '@/lib/rate-limit'
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from '@/lib/esign/native/tokens'
import { resolveSession, type RequestMeta, type SessionContext } from '@/lib/esign/native/flow'

// Shared plumbing for the public signing routes (/api/sign/*). None of them
// sits behind a login: the signer proves who they are with the emailed link,
// exchanged once for a short-lived, httpOnly, same-site session cookie.

export const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' }

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

/** The answer every refused link gets, so a stray link learns nothing. */
export function invalidLink(): NextResponse {
  return json({ state: 'invalid' }, 404)
}

/**
 * Same-origin check for state-changing requests. The session cookie is
 * SameSite=Strict already; this refuses anything a browser marks as coming
 * from another site, and anything naming a foreign origin.
 */
export function sameOrigin(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return false
  const origin = req.headers.get('origin')
  if (!origin) return true
  const allowed = new Set([new URL(SITE_URL).origin, new URL(AUTH_APP_URL).origin])
  if (process.env.NODE_ENV !== 'production') {
    try { if (new URL(origin).hostname === 'localhost') return true } catch { return false }
  }
  return allowed.has(origin)
}

/**
 * The signer's IP and browser, for the audit trail. On Vercel the platform
 * sets x-vercel-forwarded-for and overwrites x-forwarded-for, so neither can
 * be supplied by the client; elsewhere this is advisory only.
 */
export function requestMeta(req: Request): RequestMeta {
  const ip =
    req.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip')?.trim() ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    null
  return { ip, userAgent: req.headers.get('user-agent')?.slice(0, 400) ?? null }
}

/** Throttles the public signing endpoints per IP. */
export function throttle(req: Request, route: string, limit = 30): Response | null {
  return rateLimitGuard(req, `sign:${route}`, { limit, windowMs: 60_000 })
}

// deep review ES-1: one browser-wide signing cookie let a parent with two
// signing links open overwrite one child's session with the other's, so a
// consent/submit/decline from the first tab landed on the second child's form —
// recording one child's identity and opt-outs as the other's. Scope the cookie
// per recipient, so two open links keep separate sessions, and have each tab
// name the recipient it is acting for in the `x-sign-ref` header. A session can
// then only ever act on the agreement its own tab is showing.
const REF_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The session cookie name for a given recipient; the bare name when unknown. */
export function cookieName(ref?: string | null): string {
  if (typeof ref === 'string' && REF_RE.test(ref)) return `${SESSION_COOKIE}_${ref.replace(/-/g, '')}`
  return SESSION_COOKIE
}

/** The recipient this request's tab is acting for (its open document). */
export function signRef(req: Request): string | null {
  const ref = req.headers.get('x-sign-ref')
  return ref && REF_RE.test(ref) ? ref : null
}

export async function sessionCookie(ref?: string | null): Promise<string | undefined> {
  return (await cookies()).get(cookieName(ref))?.value
}

export function setSessionCookie(res: NextResponse, value: string, ref: string): NextResponse {
  res.cookies.set(cookieName(ref), value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
  return res
}

export function clearSessionCookie(res: NextResponse, ref?: string | null): NextResponse {
  res.cookies.set(cookieName(ref), '', { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 0 })
  return res
}

/**
 * Resolves the signing session for the recipient this tab is acting for
 * (deep review ES-1). The cookie is scoped per recipient, and we re-check that
 * the resolved recipient is the one the tab named, so a session minted for one
 * child can never act on another child's form. Fails closed: no ref, no scoped
 * cookie, or a mismatch all resolve to null, which every route refuses.
 */
export async function actingSession(
  db: SupabaseClient,
  req: Request,
  mode: 'act' | 'read',
): Promise<SessionContext | null> {
  const ref = signRef(req)
  const ctx = await resolveSession(db, await sessionCookie(ref), mode)
  if (!ctx) return null
  if (ref && ctx.recipient.id !== ref) return null
  return ctx
}

/** Reads and size-limits a JSON body. */
export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = 32_000): Promise<T | null> {
  const text = await req.text().catch(() => '')
  if (!text || text.length > maxBytes) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}
