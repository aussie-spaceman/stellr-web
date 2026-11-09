import { supabaseServer } from '@/lib/supabase'
import { submitLink, viewLink } from '@/lib/esign/email-changes'
import { invalidLink, json, readJson, sameOrigin, throttle } from '@/lib/esign/native/http'
import { withAudit } from '@/lib/audit/route'

// POST /api/sign/email — the one-time link in a bounce notice to the other
// signer on a two-person form (lib/esign/email-changes.ts).
//
//   body { token }           → what the page shows (the link is not spent)
//   body { token, email }    → a parent's correction (applied) or a student's
//                              suggestion (waits for an adult)
//
// The token travels in the body, never the URL, as the signing link does. A
// link that no longer works gets one answer whatever the reason.

// Signed out by design: the link is the key. The row records the answer, never the token.
const auditSpec = () => ({
  action: 'agreement.email_link.use' as const,
  actor: { session: true } as const,
  tenant: { stellr: true } as const,
  target: { table: 'agreement_email_changes', id: null },
})

export const POST = withAudit(auditSpec, useLink)

async function useLink(req: Request) {
  const limited = await throttle(req, 'email-change', 20)
  if (limited) return limited
  if (!sameOrigin(req)) return json({ error: 'Forbidden' }, 403)
  const body = await readJson<{ token?: unknown; email?: unknown }>(req)
  const db = supabaseServer()

  if (body?.email === undefined) {
    const view = await viewLink(db, body?.token)
    return view ? json({ state: 'ready', view }) : invalidLink()
  }

  const result = await submitLink(db, { token: body?.token, email: body.email })
  if (!result.ok) {
    if (result.code === 'LINK') return invalidLink()
    return json({ error: result.error, code: result.code }, result.status)
  }
  return json({ ok: true, outcome: result.outcome })
}
