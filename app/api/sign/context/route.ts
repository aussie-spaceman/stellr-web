import { supabaseServer } from '@/lib/supabase'
import { resolveSession, signingView } from '@/lib/esign/native/flow'
import { invalidLink, json, sessionCookie, throttle } from '@/lib/esign/native/http'

// GET /api/sign/context — what the signer in this session sees: the document,
// their fields with any pre-filled values, the disclosure version, and whether
// they have already agreed to sign electronically.

export async function GET(req: Request) {
  const limited = throttle(req, 'context', 60)
  if (limited) return limited
  const db = supabaseServer()
  const ctx = await resolveSession(db, await sessionCookie(), 'read')
  if (!ctx) return invalidLink()

  if (ctx.recipient.status === 'completed') {
    return json({ state: 'signed', completed: ctx.envelope.status === 'completed' })
  }
  if (!['sent', 'delivered'].includes(ctx.recipient.status) || !['sent', 'delivered'].includes(ctx.envelope.status)) {
    return invalidLink()
  }
  return json({ state: 'ready', view: await signingView(db, ctx) })
}
