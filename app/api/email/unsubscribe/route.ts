import { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { upsertContact } from '@/lib/hubspot'
import { HS, NOTIFY_STATUS } from '@/lib/hubspot-fields'
import { verifyOptOutToken } from '@/lib/waitlist-optout'
import { escapeHtml } from '@/lib/email-layout'

// /api/email/unsubscribe — marketing opt-out (no auth, per CAN-SPAM/CASL).
// Flips marketing_consent=false; transactional mail (DocuSign, registration,
// notifications) is governed separately and is unaffected.
//
// deep review INT-10 / PUB-6: the opt-out is a STATE CHANGE, so it must not
// happen on a plain GET. K-12 districts run inbound link scanners (Microsoft
// Defender Safe Links, Mimecast, Barracuda) that fetch every URL in a message
// on delivery — a mutating GET let those scanners silently unsubscribe teachers
// the instant the campaign arrived. So:
//   • GET renders a confirmation page with a POST form — safe for scanners.
//   • POST performs the change. It also serves the RFC 8058 one-click request
//     (body `List-Unsubscribe=One-Click`), whose List-Unsubscribe-Post header
//     is set on campaign mail in lib/email-campaigns.ts.
//
// Two audiences, told apart by query key:
//   ?token=…      members (Supabase) — the original campaign flow
//   ?wl=…&e=…     event-waitlist contacts, who exist only in HubSpot and so
//                 have no member row to hold a stored token

/** Pull the opt-out parameters from the query string, falling back to a POSTed form. */
async function readParams(req: NextRequest): Promise<{ token?: string; wl?: string; e?: string }> {
  const sp = req.nextUrl.searchParams
  let token = sp.get('token') ?? undefined
  let wl = sp.get('wl') ?? undefined
  let e = sp.get('e') ?? undefined
  // The confirm-page form carries the identifiers in its body; the one-click
  // POST carries them in the URL (its body is just `List-Unsubscribe=One-Click`).
  if (!token && !wl) {
    const form = await req.formData().catch(() => null)
    if (form) {
      token = (form.get('token') as string) || token
      wl = (form.get('wl') as string) || wl
      e = (form.get('e') as string) || e
    }
  }
  return { token, wl, e }
}

export async function GET(req: NextRequest) {
  const { token, wl, e } = await readParams(req)
  if (wl && e) return confirmPage({ wl, e, kind: 'waitlist' })
  if (!token) return htmlResponse('Invalid unsubscribe link.', 400)
  return confirmPage({ token, kind: 'member' })
}

export async function POST(req: NextRequest) {
  const { token, wl, e } = await readParams(req)
  if (wl && e) return unsubscribeWaitlist(e, wl)
  if (!token) return htmlResponse('Invalid unsubscribe link.', 400)
  return unsubscribeMember(token)
}

async function unsubscribeMember(token: string): Promise<Response> {
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

  // deep review INT-10 / PUB-6: escape the echoed address — it is interpolated
  // straight into the page HTML, so an attacker-chosen address on a planted row
  // must not be able to inject markup for the token holder viewing the page.
  const who = member.email ? escapeHtml(member.email) : 'You'
  return htmlResponse(`${who} will no longer receive marketing emails from Stellr Education.`)
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

/**
 * The GET landing page: a one-button POST form. No state is changed here, so a
 * link scanner that fetches the URL does nothing. The form re-POSTs the same
 * identifiers (as hidden fields) to this route, where the opt-out is performed.
 */
function confirmPage(
  params: { kind: 'member'; token: string } | { kind: 'waitlist'; wl: string; e: string },
): Response {
  const hidden =
    params.kind === 'member'
      ? `<input type="hidden" name="token" value="${escapeHtml(params.token)}">`
      : `<input type="hidden" name="wl" value="${escapeHtml(params.wl)}"><input type="hidden" name="e" value="${escapeHtml(params.e)}">`
  const prompt =
    params.kind === 'member'
      ? 'Unsubscribe from Stellr Education marketing emails?'
      : 'Stop receiving event registration updates from Stellr Education?'
  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe — Stellr</title></head>
  <body style="font-family:-apple-system,Segoe UI,sans-serif;background:#f3f4f6;margin:0;padding:48px 16px">
    <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;text-align:center">
      <div style="font-size:18px;font-weight:600;color:#1e3a5f;margin-bottom:12px">Stellr Education</div>
      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px">${prompt}</p>
      <form method="POST">
        ${hidden}
        <button type="submit" style="background:#1e3a5f;color:#fff;border:0;border-radius:8px;padding:12px 24px;font-size:15px;font-weight:600;cursor:pointer">Unsubscribe</button>
      </form>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px">You will still receive essential account and registration emails.</p>
    </div>
  </body></html>`
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
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
