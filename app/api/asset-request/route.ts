import { NextResponse } from 'next/server'
import { sendEmail, MARKETING_FROM } from '@/lib/email'
import { upsertContact } from '@/lib/hubspot'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

/**
 * Registry of gated marketing assets. Each entry is emailed to the requester
 * and made available for direct download, and the requester is captured in
 * HubSpot as a `subscriber`. Add new gated downloads here and reference them by
 * key from an <AssetGate asset="…" /> on the relevant page.
 */
const ASSETS = {
  'student-rfp': {
    title: 'Example Student RFP',
    file: '/files/Stellr-Example-Student-RFP.pdf',
    subject: 'Your example student RFP',
    note: 'Requested example student RFP (Curriculum Campaigns page)',
  },
} as const

type AssetKey = keyof typeof ASSETS

export async function POST(req: Request) {
  try {
    const { name, email, asset } = await req.json()

    const config = ASSETS[asset as AssetKey]
    if (!config) {
      return NextResponse.json({ error: 'Unknown asset' }, { status: 400 })
    }

    const cleanName = typeof name === 'string' ? name.trim() : ''
    const cleanEmail = typeof email === 'string' ? email.trim() : ''
    if (!cleanName || !/\S+@\S+\.\S+/.test(cleanEmail)) {
      return NextResponse.json({ error: 'A name and valid email are required.' }, { status: 400 })
    }

    const [firstName, ...rest] = cleanName.split(/\s+/)
    const lastName = rest.join(' ')
    const downloadUrl = `${SITE_URL}${config.file}`

    // ── 1. Capture the lead in HubSpot as a subscriber (best-effort) ──────
    const crm = await upsertContact({
      email: cleanEmail,
      firstName,
      lastName,
      note: config.note,
      lifecycleStage: 'subscriber',
    })

    // ── 2. Email the asset to the requester (best-effort, link-only) ──────
    let emailed = false
    try {
      await sendEmail({
        to: cleanEmail,
        from: MARKETING_FROM,
        subject: config.subject,
        html: assetEmailHtml(firstName, config.title, downloadUrl),
        text: assetEmailText(firstName, config.title, downloadUrl),
      })
      emailed = true
    } catch (err) {
      console.error('[asset-request] Email send failed:', err)
    }

    return NextResponse.json({ ok: true, emailed, crm: crm.ok })
  } catch (err) {
    console.error('[asset-request] Unexpected error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

function assetEmailHtml(firstName: string, title: string, downloadUrl: string) {
  const greeting = firstName || 'there'
  return `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#F6F7FB;padding:32px 16px">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E4E7F2;border-radius:16px;overflow:hidden">
      <div style="background:#0E1330;padding:28px 32px">
        <div style="font-family:'Space Grotesk',sans-serif;font-weight:700;color:#fff;font-size:18px;letter-spacing:-.01em">Stellr Education</div>
      </div>
      <div style="padding:32px">
        <p style="color:#13183A;font-size:16px;margin:0 0 12px">Hi ${greeting},</p>
        <p style="color:#454B68;font-size:15px;line-height:1.6;margin:0 0 18px">
          Thanks for your interest — your copy of <strong>${title}</strong> is ready. Download it any
          time using the button below.
        </p>
        <p style="margin:24px 0">
          <a href="${downloadUrl}" style="display:inline-block;background:#3C6DF6;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:8px">Download now</a>
        </p>
        <p style="color:#6A708C;font-size:13px;line-height:1.6;margin:18px 0 0">
          You'll get the occasional update from the Stellr community — you can unsubscribe any time.
        </p>
      </div>
    </div>
  </div>`
}

function assetEmailText(firstName: string, title: string, downloadUrl: string) {
  return [
    `Hi ${firstName || 'there'},`,
    '',
    `Thanks for your interest — your copy of ${title} is ready. Download it here:`,
    downloadUrl,
    '',
    "You'll get the occasional update from the Stellr community — you can unsubscribe any time.",
    '',
    '— Stellr Education',
  ].join('\n')
}
