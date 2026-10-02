import { supabaseServer } from '@/lib/supabase'
import { recordConsent, resolveSession } from '@/lib/esign/native/flow'
import { invalidLink, json, readJson, requestMeta, sameOrigin, sessionCookie, throttle } from '@/lib/esign/native/http'

// POST /api/sign/consent — the signer agrees to sign electronically, having
// read the disclosure (and, for a parent, confirms they are the child's parent
// or legal guardian). Recorded with the disclosure version they saw.

export async function POST(req: Request) {
  const limited = throttle(req, 'consent', 20)
  if (limited) return limited
  if (!sameOrigin(req)) return json({ error: 'Forbidden' }, 403)
  const db = supabaseServer()
  const ctx = await resolveSession(db, await sessionCookie(), 'act')
  if (!ctx) return invalidLink()

  const body = await readJson<{ disclosureVersion?: unknown; attest?: unknown }>(req)
  if (!body || typeof body.disclosureVersion !== 'string') return json({ error: 'Invalid request' }, 400)

  const result = await recordConsent(db, ctx, { disclosureVersion: body.disclosureVersion, attest: body.attest === true }, requestMeta(req))
  return result.ok ? json({ ok: true }) : json({ error: result.error }, 409)
}
