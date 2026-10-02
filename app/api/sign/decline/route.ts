import { supabaseServer } from '@/lib/supabase'
import { declineAgreement, resolveSession } from '@/lib/esign/native/flow'
import { notifyCommunityAdmins } from '@/lib/notify'
import { clearSessionCookie, invalidLink, json, readJson, requestMeta, sameOrigin, sessionCookie, throttle } from '@/lib/esign/native/http'

// POST /api/sign/decline — the signer chooses not to sign. Nobody is chased
// after a decline; admins are told so a person can follow up.

export async function POST(req: Request) {
  const limited = throttle(req, 'decline', 10)
  if (limited) return limited
  if (!sameOrigin(req)) return json({ error: 'Forbidden' }, 403)
  const db = supabaseServer()
  const ctx = await resolveSession(db, await sessionCookie(), 'act')
  if (!ctx) return invalidLink()

  const body = await readJson<{ reason?: unknown }>(req)
  const reason = typeof body?.reason === 'string' ? body.reason : ''
  await declineAgreement(db, ctx, reason, requestMeta(req))

  await notifyCommunityAdmins({
    type: 'action',
    body: `${ctx.recipient.name} declined to sign the agreement for ${ctx.envelope.minor_name ?? ctx.envelope.signer_name ?? 'a participant'}${ctx.envelope.event_title ? ` (${ctx.envelope.event_title})` : ''}.${reason.trim() ? ` Reason given: ${reason.trim().slice(0, 300)}` : ''}`,
    referenceType: 'participant',
    referenceId: ctx.envelope.participant_id ?? undefined,
  }).catch(() => {})

  return clearSessionCookie(json({ ok: true }))
}
