import { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

// GET /api/email/unsubscribe?token=… — one-click marketing opt-out (no auth, per
// CAN-SPAM/CASL). Flips marketing_consent=false; transactional mail (DocuSign,
// registration, notifications) is governed separately and is unaffected.
export async function GET(req: NextRequest) {
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
