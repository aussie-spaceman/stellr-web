import { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { upsertContact } from '@/lib/hubspot'
import { HS, NOTIFY_STATUS } from '@/lib/hubspot-fields'
import { verifyOptOutToken } from '@/lib/waitlist-optout'

// GET /api/email/unsubscribe — one-click marketing opt-out (no auth, per
// CAN-SPAM/CASL). Flips marketing_consent=false; transactional mail (DocuSign,
// registration, notifications) is governed separately and is unaffected.
//
// Two audiences, told apart by query key:
//   ?token=…      members (Supabase) — the original campaign flow
//   ?wl=…&e=…     event-waitlist contacts, who exist only in HubSpot and so
//                 have no member row to hold a stored token
export async function GET(req: NextRequest) {
  const waitlistToken = req.nextUrl.searchParams.get('wl')
  const waitlistEmail = req.nextUrl.searchParams.get('e')
  if (waitlistToken && waitlistEmail) return unsubscribeWaitlist(waitlistEmail, waitlistToken)

  const token = req.nextUrl.searchParams.get('token')
  if (!token) return htmlResponse('Invalid unsubscribe link.', 400)

  const db = supabaseServer()
  const { data: member } = await db
    .from('members')
    .select('id, email')
    .eq('marketing_unsubscribe_token', token)
    .maybeSingle()

  if (!member) {
    // Don't leak whether a token is valid; show a neutral confirmation.
    return htmlResponse('You have been unsubscribed from marketing emails.')
  }

  await db
    .from('members')
    .update({ marketing_consent: false, marketing_unsubscribed_at: new Date().toISOString() })
    .eq('id', member.id)

  return htmlResponse(`${member.email ?? 'You'} will no longer receive marketing emails from Stellr Education.`)
}

/**
 * Opt a waitlist contact out in HubSpot, the source of truth for these leads.
 *
 * The link is public and carries the address it refers to, so the signature
 * must be checked before anything is written — otherwise the endpoint is a way
 * to unsubscribe anyone whose address you can guess. A bad signature gets the
 * same neutral confirmation as a good one: telling the caller which addresses
 * are on the list is itself a disclosure.
 */
async function unsubscribeWaitlist(email: string, token: string): Promise<Response> {
  const confirmation = 'You will no longer receive event registration updates from Stellr Education.'

  if (!verifyOptOutToken(email, token)) return htmlResponse(confirmation)

  // `Unsubscribed` rather than `Lapsed`: the send targets `Requested` only, so
  // this suppresses future mail by construction, and it stays distinguishable
  // from someone who simply never converted.
  const result = await upsertContact({
    email: email.trim().toLowerCase(),
    properties: { [HS.notifyStatus]: NOTIFY_STATUS.unsubscribed },
  })

  if (!result.ok) {
    // Never tell someone they're unsubscribed when they aren't — that turns a
    // failed write into continued unwanted mail with no way out.
    console.error('[unsubscribe] Waitlist opt-out failed to write to HubSpot:', email)
    return htmlResponse(
      'We could not complete your request just now. Please email hello@stellreducation.org and we will remove you.',
      502,
    )
  }

  return htmlResponse(confirmation)
}

function htmlResponse(message: string, status = 200): Response {
  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe — Stellr</title></head>
  <body style="font-family:-apple-system,Segoe UI,sans-serif;background:#f3f4f6;margin:0;padding:48px 16px">
    <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;text-align:center">
      <div style="font-size:18px;font-weight:600;color:#1e3a5f;margin-bottom:12px">Stellr Education</div>
      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0">${message}</p>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px">You will still receive essential account and registration emails.</p>
    </div>
  </body></html>`
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
