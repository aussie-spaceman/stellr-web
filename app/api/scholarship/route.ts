import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email'

const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? 'hello@stellreducation.org'

export async function POST(req: Request) {
  try {
    const { firstName, lastName, email, phone, activity, school, brief } = await req.json()

    if (!firstName || !lastName || !email || !activity || !brief) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const name = `${firstName} ${lastName}`
    const rows: [string, string][] = [
      ['Name', name],
      ['Email', `<a href="mailto:${email}">${email}</a>`],
      ['Phone', phone || '—'],
      ['Stellr activity', activity],
      ['School', school || '—'],
      ['Application brief', brief],
    ]
    const htmlRows = rows
      .map(
        ([label, value]) =>
          `<tr><td style="padding:8px;font-weight:bold;background:#f3f4f6;vertical-align:top">${label}</td><td style="padding:8px">${value}</td></tr>`,
      )
      .join('')

    const subject = `Scholarship Application — ${name}`
    const html = `
      <h2>New scholarship application</h2>
      <table style="border-collapse:collapse;width:100%;max-width:600px">${htmlRows}</table>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px">Sent via the Stellr Education website scholarship form.</p>
    `
    const text = [
      'New scholarship application',
      '',
      `Name: ${name}`,
      `Email: ${email}`,
      `Phone: ${phone || '—'}`,
      `Stellr activity: ${activity}`,
      `School: ${school || '—'}`,
      '',
      'Application brief:',
      brief,
    ].join('\n')

    await sendEmail({ to: CONTACT_EMAIL, replyTo: email, subject, html, text })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[scholarship] Unexpected error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
