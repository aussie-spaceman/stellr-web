import { NextResponse } from 'next/server'

const RESEND_API_KEY = process.env.RESEND_API_KEY
const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? 'contact@stellreducation.org'

export async function POST(req: Request) {
  try {
    const { name, email, type, message } = await req.json()

    // Basic validation
    if (!name || !email || !type || !message) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (RESEND_API_KEY) {
      // Send via Resend
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Stellr Website <noreply@stellreducation.org>',
          to: [CONTACT_EMAIL],
          reply_to: email,
          subject: `[${type}] New enquiry from ${name}`,
          html: `
            <h2>New contact form submission</h2>
            <table style="border-collapse:collapse;width:100%;max-width:600px">
              <tr><td style="padding:8px;font-weight:bold;background:#f3f4f6">Name</td><td style="padding:8px">${name}</td></tr>
              <tr><td style="padding:8px;font-weight:bold;background:#f3f4f6">Email</td><td style="padding:8px"><a href="mailto:${email}">${email}</a></td></tr>
              <tr><td style="padding:8px;font-weight:bold;background:#f3f4f6">Enquiry Type</td><td style="padding:8px">${type}</td></tr>
              <tr><td style="padding:8px;font-weight:bold;background:#f3f4f6;vertical-align:top">Message</td><td style="padding:8px;white-space:pre-wrap">${message}</td></tr>
            </table>
            <p style="color:#9ca3af;font-size:12px;margin-top:24px">Sent via the Stellr Education website contact form.</p>
          `,
          text: `New contact form submission\n\nName: ${name}\nEmail: ${email}\nEnquiry Type: ${type}\n\nMessage:\n${message}`,
        }),
      })

      if (!res.ok) {
        const error = await res.text()
        console.error('[contact] Resend error:', error)
        return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
      }
    } else {
      // Resend not configured yet — log to console (development / pre-Phase 3)
      console.log('[contact] No RESEND_API_KEY set. Would have sent:')
      console.log({ name, email, type, message })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[contact] Unexpected error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
