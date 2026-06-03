import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const { email } = await req.json()
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
    }

    // TODO Phase 3: wire up to Loops (or Mailchimp / ConvertKit)
    // const res = await fetch('https://app.loops.so/api/v1/contacts/create', {
    //   method: 'POST',
    //   headers: { Authorization: `Bearer ${process.env.LOOPS_API_KEY}`, 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ email, source: 'website-subscribe' }),
    // })

    console.log(`[subscribe] New subscriber: ${email}`)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
