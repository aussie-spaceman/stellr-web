import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email'
import { rateLimitGuard, HOUR_MS } from '@/lib/rate-limit'

const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? 'hello@stellreducation.org'

/** Escape user input before interpolating into notification-email HTML, so a
 *  submitted name/message can't inject markup or a scripted link into the inbox. */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function POST(req: Request) {
  const limited = rateLimitGuard(req, 'contact', { limit: 3, windowMs: HOUR_MS })
  if (limited) return limited
  try {
    const { name, email, type, message } = await req.json()

    if (!name || !email || !type || !message) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const subject = `[${type}] New enquiry from ${name}`
    const html = `
      <h2>New contact form submission</h2>
      <table style="border-collapse:collapse;width:100%;max-width:600px">
        <tr><td style="padding:8px;font-weight:bold;background:#f3f4f6">Name</td><td style="padding:8px">${esc(name)}</td></tr>
        <tr><td style="padding:8px;font-weight:bold;background:#f3f4f6">Email</td><td style="padding:8px"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
        <tr><td style="padding:8px;font-weight:bold;background:#f3f4f6">Enquiry Type</td><td style="padding:8px">${esc(type)}</td></tr>
        <tr><td style="padding:8px;font-weight:bold;background:#f3f4f6;vertical-align:top">Message</td><td style="padding:8px;white-space:pre-wrap">${esc(message)}</td></tr>
      </table>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px">Sent via the Stellr Education website contact form.</p>
    `
    const text = `New contact form submission\n\nName: ${name}\nEmail: ${email}\nEnquiry Type: ${type}\n\nMessage:\n${message}`

    await sendEmail({ to: CONTACT_EMAIL, replyTo: email, subject, html, text })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[contact] Unexpected error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
