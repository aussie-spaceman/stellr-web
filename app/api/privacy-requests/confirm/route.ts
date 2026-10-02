import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { rateLimitGuard } from '@/lib/rate-limit'
import { readJson, requestMeta, sameOrigin } from '@/lib/esign/native/http'
import { confirmRequest } from '@/lib/privacy-requests'

// POST /api/privacy-requests/confirm — { token } from the emailed link's
// fragment. Confirms the request came from the address it names.

export async function POST(req: Request) {
  const limited = rateLimitGuard(req, 'privacy-request-confirm', { limit: 20, windowMs: 60_000 })
  if (limited) return limited
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await readJson<{ token?: unknown }>(req, 1_000)
  const state = typeof body?.token === 'string'
    ? await confirmRequest(supabaseServer(), body.token, { ip: requestMeta(req).ip })
    : 'invalid'
  return NextResponse.json({ state }, { status: state === 'invalid' ? 404 : 200, headers: { 'Cache-Control': 'private, no-store' } })
}
