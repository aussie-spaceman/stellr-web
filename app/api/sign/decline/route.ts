import { supabaseServer } from '@/lib/supabase'
import { declineAgreement } from '@/lib/esign/native/flow'
import { notifyCommunityAdmins } from '@/lib/notify'
import { isTenantRow } from '@/lib/event-emails/tenant-mail'
import { actingSession, clearSessionCookie, invalidLink, json, readJson, requestMeta, sameOrigin, signRef, throttle } from '@/lib/esign/native/http'

// POST /api/sign/decline — the signer chooses not to sign. Nobody is chased
// after a decline; admins are told so a person can follow up.

export async function POST(req: Request) {
  const limited = await throttle(req, 'decline', 10)
  if (limited) return limited
  if (!sameOrigin(req)) return json({ error: 'Forbidden' }, 403)
  const db = supabaseServer()
  const ctx = await actingSession(db, req, 'act')
  if (!ctx) return invalidLink()

  const body = await readJson<{ reason?: unknown }>(req)
  const reason = typeof body?.reason === 'string' ? body.reason : ''
  await declineAgreement(db, ctx, reason, requestMeta(req))

  // Another organiser's envelope is not Stellr's to follow up, and its names and
  // reason must not land in Stellr's admin alerts (S5: a tenant's alert contact is
  // an open owner decision, B17). A guardian's declined consent is settled by
  // declineAgreement itself.
  if (isTenantRow(ctx.envelope.tenant_id)) return clearSessionCookie(json({ ok: true }), signRef(req))

  await notifyCommunityAdmins({
    type: 'action',
    body: `${ctx.recipient.name} declined to sign the agreement for ${ctx.envelope.minor_name ?? ctx.envelope.signer_name ?? 'a participant'}${ctx.envelope.event_title ? ` (${ctx.envelope.event_title})` : ''}.${reason.trim() ? ` Reason given: ${reason.trim().slice(0, 300)}` : ''}`,
    referenceType: 'participant',
    referenceId: ctx.envelope.participant_id ?? undefined,
  }).catch(() => {})

  return clearSessionCookie(json({ ok: true }), signRef(req))
}
