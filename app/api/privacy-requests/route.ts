import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { rateLimitGuard } from '@/lib/rate-limit'
import { readJson, sameOrigin } from '@/lib/esign/native/http'
import { RequestEmailFailed, requestHeldBack, requestSchema, submitRequest } from '@/lib/privacy-requests'
import { auditMutation } from '@/lib/audit/route'

// POST /api/privacy-requests — the public request form. Answers the same way
// whether or not the address is known to Stellr; the request counts only once
// the link emailed to that address is followed (/privacy/request/confirm).
//
// The audit event (docs/TENANCY-S5.md, B18) holds the row's id and the kind of request.
// The requester's name and address and the child's name stay on the row, which is purged
// on its own schedule; this log is never purged. A request held back records nothing, so
// it writes no event. An email that failed keeps the row it was for.

const noStore = { 'Cache-Control': 'private, no-store' }

export async function POST(req: Request) {
  const limited = rateLimitGuard(req, 'privacy-request', { limit: 5, windowMs: 10 * 60_000 })
  if (limited) return limited
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: noStore })

  const parsed = requestSchema.safeParse(await readJson(req, 8_000))
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? 'form'), i.message]))
    return NextResponse.json({ error: 'Check the highlighted fields.', fieldErrors }, { status: 400, headers: noStore })
  }
  let requestId: string | null = null
  let failed = false
  try {
    const db = supabaseServer()
    if (await requestHeldBack(db, parsed.data)) return NextResponse.json({ ok: true }, { headers: noStore })
    requestId = await submitRequest(db, parsed.data)
  } catch (err) {
    console.error('[privacy-requests] submit failed:', err instanceof Error ? err.message : err)
    if (err instanceof RequestEmailFailed) requestId = err.requestId
    failed = true
  }
  await auditMutation(
    {
      action: 'privacy.request.create',
      actor: { userId: null },
      tenant: { stellr: true },
      target: { table: 'privacy_requests', id: requestId },
      metadata: { request_kind: parsed.data.kind, recorded: requestId !== null, status: failed ? 502 : 200 },
    },
    { afterResponse: true },
  )
  if (failed) {
    return NextResponse.json({ error: 'We could not send the confirmation email. Please try again, or email privacy@stellreducation.org.' }, { status: 502, headers: noStore })
  }
  return NextResponse.json({ ok: true }, { headers: noStore })
}
