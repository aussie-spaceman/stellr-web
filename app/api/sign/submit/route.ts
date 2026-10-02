import { supabaseServer } from '@/lib/supabase'
import { resolveSession, submitSignature } from '@/lib/esign/native/flow'
import { sendInvites } from '@/lib/esign/outbox'
import { invalidLink, json, readJson, requestMeta, sameOrigin, sessionCookie, throttle } from '@/lib/esign/native/http'

// POST /api/sign/submit — the signature. Records the signer's field values and
// typed name, then either emails the next signer (a student, after their
// parent) or, when everyone has signed, seals and stores the agreement.

export const maxDuration = 60

export async function POST(req: Request) {
  const limited = throttle(req, 'submit', 10)
  if (limited) return limited
  if (!sameOrigin(req)) return json({ error: 'Forbidden' }, 403)
  const db = supabaseServer()
  const ctx = await resolveSession(db, await sessionCookie(), 'act')
  if (!ctx) return invalidLink()

  const body = await readJson<{ values?: unknown; signature?: unknown; confirmDifferentName?: unknown }>(req)
  const values = body?.values
  if (!body || typeof values !== 'object' || values === null || Array.isArray(values) || typeof body.signature !== 'string') {
    return json({ error: 'Invalid request' }, 400)
  }

  const result = await submitSignature(
    db,
    ctx,
    { values: values as Record<string, unknown>, signatureText: body.signature, confirmDifferentName: body.confirmDifferentName === true },
    requestMeta(req),
  )
  // A different name is a question for the signer, not a failure.
  if (!result.ok && result.error === 'name_differs') {
    return json({ ok: false, error: result.error, fieldErrors: result.fieldErrors, nameOnRecord: result.nameOnRecord })
  }
  if (!result.ok) return json({ error: result.error, fieldErrors: result.fieldErrors, nameOnRecord: result.nameOnRecord }, result.status)

  if (result.activated.length) await sendInvites(db, result.activated)
  return json({ ok: true, complete: result.agreementComplete })
}
