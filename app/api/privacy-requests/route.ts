import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { rateLimitGuard } from '@/lib/rate-limit'
import { readJson, sameOrigin } from '@/lib/esign/native/http'
import { requestSchema, submitRequest } from '@/lib/privacy-requests'

// POST /api/privacy-requests — the public request form. Answers the same way
// whether or not the address is known to Stellr; the request counts only once
// the link emailed to that address is followed (/privacy/request/confirm).

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
  try {
    await submitRequest(supabaseServer(), parsed.data)
  } catch (err) {
    console.error('[privacy-requests] submit failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'We could not send the confirmation email. Please try again, or email privacy@stellreducation.org.' }, { status: 502, headers: noStore })
  }
  return NextResponse.json({ ok: true }, { headers: noStore })
}
