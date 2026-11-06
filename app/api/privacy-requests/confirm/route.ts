import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { rateLimitGuard } from '@/lib/rate-limit'
import { readJson, requestMeta, sameOrigin } from '@/lib/esign/native/http'
import { confirmRequest, readRequestLink, type RequestLink } from '@/lib/privacy-requests'
import { auditMutation } from '@/lib/audit/route'

// POST /api/privacy-requests/confirm — { token } from the emailed link's
// fragment. Confirms the request came from the address it names.
//
// The audit event (docs/TENANCY-S5.md, B18) names the row and how it ended. The token
// stays out, because it is the authority over the request, and so does the IP
// confirmRequest stores. A link followed again changes nothing, so it writes no event.

const noStore = { 'Cache-Control': 'private, no-store' }

export async function POST(req: Request) {
  const limited = rateLimitGuard(req, 'privacy-request-confirm', { limit: 20, windowMs: 60_000 })
  if (limited) return limited
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await readJson<{ token?: unknown }>(req, 1_000)
  const link: RequestLink = typeof body?.token === 'string'
    ? await readRequestLink(supabaseServer(), body.token)
    : { state: 'invalid' }
  if (link.state === 'invalid') return NextResponse.json({ state: link.state }, { status: 404, headers: noStore })
  if (link.state === 'already_confirmed') return NextResponse.json({ state: link.state }, { status: 200, headers: noStore })

  const { state, requestId } = await confirmRequest(supabaseServer(), link, { ip: requestMeta(req).ip })
  await auditMutation(
    {
      action: 'privacy.request.confirm',
      actor: { userId: null },
      tenant: { stellr: true },
      target: { table: 'privacy_requests', id: requestId },
      metadata: { state },
    },
    { afterResponse: true },
  )
  return NextResponse.json({ state }, { status: 200, headers: noStore })
}
