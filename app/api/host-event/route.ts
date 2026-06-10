import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email'

const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? 'hello@stellreducation.org'

export async function POST(req: Request) {
  try {
    const {
      firstName, lastName, email, phone,
      companySchool, address, venueCapacity,
      preferredTiming, preferredDuration,
      funding, facilityOverheads,
    } = await req.json()

    if (!firstName || !lastName || !email || !phone || !companySchool || !venueCapacity || !preferredTiming || !preferredDuration) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const name = `${firstName} ${lastName}`
    const rows: [string, string][] = [
      ['Name', name],
      ['Email', `<a href="mailto:${email}">${email}</a>`],
      ['Phone', phone],
      ['Organization', companySchool],
      ['Address', address || '—'],
      ['Venue Capacity', venueCapacity],
      ['Preferred Timing', preferredTiming],
      ['Preferred Duration', preferredDuration],
      ['Funding Available', funding || '—'],
      ['Facility Overheads', facilityOverheads || '—'],
    ]
    const htmlRows = rows
      .map(([label, value]) => `<tr><td style="padding:8px;font-weight:bold;background:#f3f4f6">${label}</td><td style="padding:8px">${value}</td></tr>`)
      .join('')

    const subject = `[Host An Event] Expression of interest from ${name} — ${companySchool}`
    const html = `
      <h2>New Host An Event submission</h2>
      <table style="border-collapse:collapse;width:100%;max-width:600px">${htmlRows}</table>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px">Sent via the Stellr Education website Host An Event form.</p>
    `
    const text = [
      'New Host An Event submission', '',
      `Name: ${name}`, `Email: ${email}`, `Phone: ${phone}`,
      `Organization: ${companySchool}`, `Address: ${address || '—'}`,
      `Venue Capacity: ${venueCapacity}`, `Preferred Timing: ${preferredTiming}`,
      `Preferred Duration: ${preferredDuration}`,
      `Funding Available: ${funding || '—'}`, `Facility Overheads: ${facilityOverheads || '—'}`,
    ].join('\n')

    await sendEmail({ to: CONTACT_EMAIL, replyTo: email, subject, html, text })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[host-event] Unexpected error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
