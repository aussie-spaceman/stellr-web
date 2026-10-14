import { NextResponse } from 'next/server'
import { sendEmail, MARKETING_FROM } from '@/lib/email'
import { LEAD_SOURCE_LIFECYCLE } from '@/lib/hubspot-fields'
import { captureLead, logLine, readHubspotCookie } from '@/lib/hubspot'
import { rateLimitGuard, HOUR_MS } from '@/lib/rate-limit'
import { isEmailLike } from '@/lib/utils'
import { GATED_ASSETS } from '@/lib/gated-assets'
import { LINK_TTL_SECONDS, gatedDownloadUrl } from '@/lib/gated-download-link'
import { gatedAssetEmailHtml, gatedAssetEmailText } from '@/lib/gated-asset-email'

const PAPER = GATED_ASSETS['white-paper']
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
const LINK_DAYS = Math.round(LINK_TTL_SECONDS / 86400)

/**
 * The /impact white paper. Like every gated download, the full file sits in
 * private storage and goes out only by email, as an expiring signed link
 * (lib/gated-download-link.ts) — never from the page.
 */
export async function POST(req: Request) {
  // Sends outbound email to the submitted address — an email-bomb vector, so
  // throttle harder than the CRM-only forms.
  const limited = rateLimitGuard(req, 'white-paper', { limit: 3, windowMs: HOUR_MS })
  if (limited) return limited
  try {
    const { name, email } = await req.json()

    const cleanName = typeof name === 'string' ? name.trim() : ''
    const cleanEmail = typeof email === 'string' ? email.trim() : ''
    if (!cleanName || !isEmailLike(cleanEmail)) {
      return NextResponse.json({ error: 'A name and valid email are required.' }, { status: 400 })
    }

    const downloadUrl = gatedDownloadUrl(SITE_URL, 'white-paper')
    if (!downloadUrl) {
      console.error('[white-paper] No signing secret configured — cannot issue a download link.')
      return NextResponse.json({ error: 'Downloads are unavailable right now.' }, { status: 503 })
    }

    const [firstName, ...rest] = cleanName.split(/\s+/)
    const lastName = rest.join(' ')

    // ── 1. Capture the lead in HubSpot (best-effort) ──────────────────────
    // Form submission + note engagement, so this shows up under Recent
    // Conversion and Last Activity rather than only as a mutated property.
    const crm = await captureLead({
      email: cleanEmail,
      firstName,
      lastName,
      source: 'white_paper',
      lifecycleStage: LEAD_SOURCE_LIFECYCLE.white_paper,
      activity: `${PAPER.note}.`,
      logEntry: logLine('white_paper', PAPER.title),
      context: {
        hutk: readHubspotCookie(req),
        pageUri: `${SITE_URL}${PAPER.pagePath}`,
        pageName: 'White paper — STEM Power Skills',
      },
    })

    // ── 2. Email the expiring link to the requester ──────────────────────
    // deep review PUB-2: the shared builder escapes the submitted name.
    let emailed = false
    try {
      await sendEmail({
        to: cleanEmail,
        from: MARKETING_FROM,
        subject: PAPER.subject,
        html: gatedAssetEmailHtml(firstName, PAPER.title, downloadUrl, LINK_DAYS),
        text: gatedAssetEmailText(firstName, PAPER.title, downloadUrl, LINK_DAYS),
      })
      emailed = true
    } catch (err) {
      console.error('[white-paper] Email send failed:', err)
    }

    // The link only ever travels by email, so a failed send is a failure.
    if (!emailed) return NextResponse.json({ error: 'We could not send the email.' }, { status: 502 })
    return NextResponse.json({ ok: true, emailed, crm: crm.ok })
  } catch (err) {
    console.error('[white-paper] Unexpected error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
