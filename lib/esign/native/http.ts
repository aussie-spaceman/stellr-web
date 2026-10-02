import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { SITE_URL, AUTH_APP_URL } from '@/lib/env'
import { rateLimitGuard } from '@/lib/rate-limit'
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from '@/lib/esign/native/tokens'
import type { RequestMeta } from '@/lib/esign/native/flow'

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

export async function sessionCookie(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value
}

export function setSessionCookie(res: NextResponse, value: string): NextResponse {
  res.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
  return res
}

export function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 0 })
  return res
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
