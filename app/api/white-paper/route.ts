import { NextResponse } from 'next/server'
import { sendEmail, MARKETING_FROM } from '@/lib/email'
import { upsertContact } from '@/lib/hubspot'

const PDF_FILE = 'Stellr-STEM-Power-Skills-White-Paper.pdf'
const PDF_PUBLIC_PATH = `/files/${PDF_FILE}`
const PAPER_TITLE = 'From “Soft Skills” to STEM Power Skills'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

export async function POST(req: Request) {
  try {
    const { name, email } = await req.json()

    const cleanName = typeof name === 'string' ? name.trim() : ''
    const cleanEmail = typeof email === 'string' ? email.trim() : ''
    if (!cleanName || !/\S+@\S+\.\S+/.test(cleanEmail)) {
      return NextResponse.json({ error: 'A name and valid email are required.' }, { status: 400 })
    }

    const [firstName, ...rest] = cleanName.split(/\s+/)
    const lastName = rest.join(' ')
    const downloadUrl = `${SITE_URL}${PDF_PUBLIC_PATH}`

    // ── 1. Capture the lead in HubSpot (best-effort) ──────────────────────
    const crm = await upsertContact({
      email: cleanEmail,
      firstName,
      lastName,
      note: `Requested white paper: ${PAPER_TITLE} (impact page)`,
    })

    // ── 2. Email the paper to the requester (best-effort, link-only) ──────
    let emailed = false
    try {
      await sendEmail({
        to: cleanEmail,
        from: MARKETING_FROM,
        subject: `Your white paper: ${PAPER_TITLE}`,
        html: whitePaperEmailHtml(firstName, downloadUrl),
        text: whitePaperEmailText(firstName, downloadUrl),
      })
      emailed = true
    } catch (err) {
      console.error('[white-paper] Email send failed:', err)
    }

    return NextResponse.json({ ok: true, emailed, crm: crm.ok })
  } catch (err) {
    console.error('[white-paper] Unexpected error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

function whitePaperEmailHtml(firstName: string, downloadUrl: string) {
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
          Thanks for your interest — your copy of <strong>${PAPER_TITLE}</strong> is ready. Download it any
          time using the button below.
        </p>
        <p style="margin:24px 0">
          <a href="${downloadUrl}" style="display:inline-block;background:#3C6DF6;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:8px">Download the white paper</a>
        </p>
        <p style="color:#6A708C;font-size:13px;line-height:1.6;margin:18px 0 0">
          You'll get the occasional update from the Stellr community — you can unsubscribe any time.
        </p>
      </div>
    </div>
  </div>`
}

function whitePaperEmailText(firstName: string, downloadUrl: string) {
  return [
    `Hi ${firstName || 'there'},`,
    '',
    `Thanks for your interest — your copy of ${PAPER_TITLE} is ready. Download it here:`,
    downloadUrl,
    '',
    "You'll get the occasional update from the Stellr community — you can unsubscribe any time.",
    '',
    '— Stellr Education',
  ].join('\n')
}
