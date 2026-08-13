import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { sendEmail } from '@/lib/email'

// GET /api/cron/lead-capture-failures — runs weekly (see vercel.json).
//
// `lead_capture_failures` is the dead-letter queue for leads that never reached
// HubSpot (migration 135). Until now it was written and never read: a row
// landing there meant a real person asked to hear from us and nobody has any
// record of it, and the only signal was an email sent at the moment of failure
// — which is exactly when mail is most likely to be the thing that is broken.
//
// So this is the backstop for the backstop. It reports only when there is
// something to report: a weekly "all clear" trains people to ignore it, and an
// ignored alert is the same as no alert.

export const dynamic = 'force-dynamic'

const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? 'hello@stellreducation.org'

/** Shown in the alert so the oldest unresolved item is visible at a glance. */
const SAMPLE_SIZE = 10

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabaseServer()

  const { data, error, count } = await db
    .from('lead_capture_failures')
    .select('id, created_at, email, source, reason', { count: 'exact' })
    .is('resolved_at', null)
    .order('created_at', { ascending: true })
    .limit(SAMPLE_SIZE)

  if (error) {
    console.error('[cron:lead-capture-failures] Query failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const unresolved = count ?? 0
  if (unresolved === 0) {
    return NextResponse.json({ unresolved: 0, alerted: false }, { status: 200 })
  }

  const rows = data ?? []
  const oldest = rows[0]?.created_at ?? null

  const list = rows
    .map((r) => `${r.created_at?.slice(0, 10)} · ${r.source} · ${r.email} · ${r.reason}`)
    .join('\n')

  const subject = `[Stellr] ${unresolved} lead capture${unresolved === 1 ? '' : 's'} never reached HubSpot`

  try {
    await sendEmail({
      to: CONTACT_EMAIL,
      subject,
      html:
        `<p><strong>${unresolved} lead capture${unresolved === 1 ? '' : 's'} failed to reach HubSpot and ${unresolved === 1 ? 'is' : 'are'} unresolved.</strong></p>` +
        `<p>Each row is a person who asked to hear from us and currently will not.</p>` +
        `<pre style="background:#f3f4f6;padding:12px;border-radius:8px;font-size:13px;white-space:pre-wrap">${list}</pre>` +
        (unresolved > rows.length ? `<p>…and ${unresolved - rows.length} more.</p>` : '') +
        `<p>Replay them into HubSpot, then set <code>resolved_at</code> on the rows in <code>lead_capture_failures</code>.</p>`,
      text:
        `${unresolved} lead capture(s) failed to reach HubSpot and are unresolved.\n\n` +
        `${list}\n` +
        (unresolved > rows.length ? `…and ${unresolved - rows.length} more.\n` : '') +
        `\nReplay them into HubSpot, then set resolved_at on the rows in lead_capture_failures.`,
    })
  } catch (err) {
    console.error('[cron:lead-capture-failures] Alert send failed:', err)
    return NextResponse.json({ unresolved, alerted: false, error: String(err) }, { status: 200 })
  }

  console.log(`[cron:lead-capture-failures] ${unresolved} unresolved, alerted ${CONTACT_EMAIL}`)
  return NextResponse.json({ unresolved, oldest, alerted: true }, { status: 200 })
}
