import { NextResponse } from 'next/server'
import { sendEmail, MARKETING_FROM } from '@/lib/email'
import { upsertContact } from '@/lib/hubspot'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
// Where the gated files live. Empty → self-hosted on the site (SITE_URL/files).
// Set NEXT_PUBLIC_MEDIA_BASE_URL (same var the manifest uses) once /files moves
// to a bucket/CDN, and the emailed download links follow automatically.
const MEDIA_BASE = (process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? '').replace(/\/+$/, '')

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
  'sponsorship-prospectus': {
    title: 'Sponsorship Prospectus',
    file: '/files/Stellr-Sponsorship-Prospectus.pdf',
    subject: 'Your Stellr Sponsorship Prospectus',
    note: 'Requested Sponsorship Prospectus (Network / Why Stellr page)',
  },
  // Media-rollout gated competition material (T4). Files self-hosted in /public.
  'jsc-2025-program-book': {
    title: '2025 JSC — Program Book',
    file: '/files/jsc-2025-program-book.pdf',
    subject: 'Your copy of the 2025 JSC Program Book',
    note: 'Requested 2025 JSC Program Book (Educators page)',
  },
  'jsc-2025-student-presentation': {
    title: '2025 JSC — Student Presentation',
    file: '/files/jsc-2025-student-presentation.pdf',
    subject: 'Your copy of the 2025 JSC Student Presentation',
    note: 'Requested 2025 JSC Student Presentation (Educators page)',
  },
  'south-west-2022-student-presentation': {
    title: '2022 South West — Student Presentation',
    file: '/files/south-west-2022-student-presentation.pdf',
    subject: 'Your copy of the 2022 South West Student Presentation',
    note: 'Requested 2022 South West Student Presentation (Events page)',
  },
  'south-west-2025-rfp': {
    title: '2025 South West — RFP',
    file: '/files/south-west-2025-rfp.pdf',
    subject: 'Your copy of the 2025 South West RFP',
    note: 'Requested 2025 South West RFP (Events page)',
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
    // Name is optional (README §8 one-field gate); only a valid email is required.
    if (!/\S+@\S+\.\S+/.test(cleanEmail)) {
      return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 })
    }

    const [firstName, ...rest] = cleanName.split(/\s+/)
    const lastName = rest.join(' ')
    const downloadUrl = `${MEDIA_BASE || SITE_URL}${config.file}`

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
