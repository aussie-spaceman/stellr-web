import { NextResponse } from 'next/server'
import { sendEmail, MARKETING_FROM } from '@/lib/email'
import { LEAD_SOURCE_LIFECYCLE } from '@/lib/hubspot-fields'
import { captureLead, logLine, readHubspotCookie } from '@/lib/hubspot'
import { rateLimitGuard, HOUR_MS } from '@/lib/rate-limit'
import { isEmailLike } from '@/lib/utils'
import { GATED_ASSETS, isGatedAssetKey } from '@/lib/gated-assets'
import { gatedDownloadUrl } from '@/lib/gated-download-link'
import { gatedAssetEmailHtml, gatedAssetEmailText } from '@/lib/gated-asset-email'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
/**
 * Gated marketing downloads. The requester is captured in HubSpot as a
 * `subscriber` and emailed a signed link to the full file. The file
 * itself sits in private storage (lib/gated-assets.ts); no page, prop or
 * response from this route ever carries its location. Reference a key from an
 * <AssetGate asset="…" /> or a gated WorkCard.
 */
export async function POST(req: Request) {
  // Sends outbound email to the submitted address — an email-bomb vector.
  const limited = rateLimitGuard(req, 'asset-request', { limit: 3, windowMs: HOUR_MS })
  if (limited) return limited
  try {
    const { name, email, asset } = await req.json()

    if (!isGatedAssetKey(asset)) {
      return NextResponse.json({ error: 'Unknown asset' }, { status: 400 })
    }
    const config = GATED_ASSETS[asset]

    const cleanName = typeof name === 'string' ? name.trim() : ''
    const cleanEmail = typeof email === 'string' ? email.trim() : ''
    // Name is optional (README §8 one-field gate); only a valid email is required.
    if (!isEmailLike(cleanEmail)) {
      return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 })
    }

    const downloadUrl = gatedDownloadUrl(SITE_URL, asset)
    if (!downloadUrl) {
      console.error('[asset-request] No signing secret configured — cannot issue a download link.')
      return NextResponse.json({ error: 'Downloads are unavailable right now.' }, { status: 503 })
    }

    const [firstName, ...rest] = cleanName.split(/\s+/)
    const lastName = rest.join(' ')

    // ── 1. Capture the lead in HubSpot as a subscriber (best-effort) ──────
    // Form submission + note engagement, so the request is visible under
    // Recent Conversion and Last Activity rather than only as a mutated
    // property that the next lead route would overwrite.
    const crm = await captureLead({
      email: cleanEmail,
      firstName,
      lastName,
      source: 'asset_request',
      lifecycleStage: LEAD_SOURCE_LIFECYCLE.asset_request,
      activity: `${config.note}.`,
      logEntry: logLine('asset_request', config.title),
      context: {
        hutk: readHubspotCookie(req),
        pageUri: `${SITE_URL}${config.pagePath}`,
        pageName: `Asset request — ${config.title}`,
      },
    })

    // ── 2. Email the signed link to the requester ────────────────────────
    let emailed = false
    try {
      await sendEmail({
        to: cleanEmail,
        from: MARKETING_FROM,
        subject: config.subject,
        html: gatedAssetEmailHtml(firstName, config.title, downloadUrl),
        text: gatedAssetEmailText(firstName, config.title, downloadUrl),
      })
      emailed = true
    } catch (err) {
      console.error('[asset-request] Email send failed:', err)
    }

    // The link only ever travels by email, so a failed send is a failure.
    if (!emailed) return NextResponse.json({ error: 'We could not send the email.' }, { status: 502 })
    return NextResponse.json({ ok: true, emailed, crm: crm.ok })
  } catch (err) {
    console.error('[asset-request] Unexpected error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
