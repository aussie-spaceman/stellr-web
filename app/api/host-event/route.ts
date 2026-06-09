import { NextResponse } from 'next/server'

const RESEND_API_KEY = process.env.RESEND_API_KEY
const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? 'david.shaw@insimeducation.com'

export async function POST(req: Request) {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      address,
      companySchool,
      venueCapacity,
      preferredTiming,
      preferredDuration,
      funding,
      facilityOverheads,
    } = await req.json()

    if (!firstName || !lastName || !email || !phone || !address || !companySchool || !venueCapacity || !preferredTiming || !preferredDuration) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const name = `${firstName} ${lastName}`

    const htmlRows = [
      ['Name', name],
      ['Email', `<a href="mailto:${email}">${email}</a>`],
      ['Phone', phone],
      ['Organization', companySchool],
      ['Address', address],
      ['Venue Capacity', venueCapacity],
      ['Preferred Timing', preferredTiming],
      ['Preferred Duration', preferredDuration],
      ['Funding Available', funding || '—'],
      ['Facility Overheads', facilityOverheads || '—'],
    ]
      .map(
        ([label, value]) =>
          `<tr><td style="padding:8px;font-weight:bold;background:#f3f4f6">${label}</td><td style="padding:8px">${value}</td></tr>`
      )
      .join('')

    if (RESEND_API_KEY) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Stellr Website <david.shaw@insimeducation.com>',
          to: [CONTACT_EMAIL],
          reply_to: email,
          subject: `[Host An Event] Expression of interest from ${name} — ${companySchool}`,
          html: `
            <h2>New Host An Event submission</h2>
            <table style="border-collapse:collapse;width:100%;max-width:600px">${htmlRows}</table>
            <p style="color:#9ca3af;font-size:12px;margin-top:24px">Sent via the Stellr Education website Host An Event form.</p>
          `,
          text: [
            'New Host An Event submission',
            '',
            `Name: ${name}`,
            `Email: ${email}`,
            `Phone: ${phone}`,
            `Organization: ${companySchool}`,
            `Address: ${address}`,
            `Venue Capacity: ${venueCapacity}`,
            `Preferred Timing: ${preferredTiming}`,
            `Preferred Duration: ${preferredDuration}`,
            `Funding Available: ${funding || '—'}`,
            `Facility Overheads: ${facilityOverheads || '—'}`,
          ].join('\n'),
        }),
      })

      if (!res.ok) {
        const error = await res.text()
        console.error('[host-event] Resend error:', error)
        return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
      }
    } else {
      console.log('[host-event] No RESEND_API_KEY set. Would have sent:')
      console.log({ name, email, phone, companySchool, address, venueCapacity, preferredTiming, preferredDuration, funding, facilityOverheads })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[host-event] Unexpected error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
