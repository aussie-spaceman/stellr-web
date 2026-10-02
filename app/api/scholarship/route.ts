import { NextResponse } from 'next/server'
import { z } from 'zod'
import { sendEmail } from '@/lib/email'
import { LEAD_SOURCE_LIFECYCLE } from '@/lib/hubspot-fields'
import { captureLead, logLine, readHubspotCookie } from '@/lib/hubspot'
import { rateLimitGuard, HOUR_MS } from '@/lib/rate-limit'
import { supabaseServer } from '@/lib/supabase'
import { getAllEvents, type StellarEvent } from '@/lib/sanity'
import { getCurrentMember } from '@/lib/community'
import { scholarshipReceivedEmail, scholarshipStaffAlertEmail } from '@/lib/scholarship-emails'

const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? 'hello@stellreducation.org'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
const APP_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

// Length caps keep a pasted essay (or a bot) from filling the table and the
// staff inbox; they sit well above anything a real application has used.
const schema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  activity: z.string().trim().min(1).max(200),
  school: z.string().trim().max(200).optional().or(z.literal('')),
  brief: z.string().trim().min(1).max(5000),
})

/** The event the applicant picked, by its title; null for "Not sure yet". */
async function resolveEvent(activity: string): Promise<{ slug: string; title: string } | null> {
  const events: StellarEvent[] = (await getAllEvents().catch(() => [])) ?? []
  const match = events.find((e) => e.title?.trim().toLowerCase() === activity.toLowerCase())
  return match?.slug?.current ? { slug: match.slug.current, title: match.title } : null
}

export async function POST(req: Request) {
  const limited = rateLimitGuard(req, 'scholarship', { limit: 3, windowMs: HOUR_MS })
  if (limited) return limited
  try {
    const parsed = schema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    const { firstName, lastName, email, activity, brief } = parsed.data
    const phone = parsed.data.phone || null
    const school = parsed.data.school || null
    const name = `${firstName} ${lastName}`

    // The application is saved before anything else, so the admin review queue
    // has it even if email or HubSpot fail. If the save itself fails we still
    // email the staff inbox (fail open — a lost application is the worst
    // outcome), just without a direct review link.
    const db = supabaseServer()
    const [event, member] = await Promise.all([
      resolveEvent(activity),
      getCurrentMember().catch(() => null),
    ])
    const { data: row, error: insertError } = await db
      .from('scholarship_applications')
      .insert({
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        school,
        brief,
        activity,
        event_slug: event?.slug ?? null,
        event_title: event?.title ?? null,
        // A signed-in applicant is linked straight away; otherwise the reviewer
        // links (or creates) the member when making the offer.
        member_id: member?.id ?? null,
      })
      .select('id')
      .single()
    if (insertError) console.error('[scholarship] application insert failed (emailing anyway):', insertError)

    const reviewUrl = row ? `${APP_URL}/admin/scholarships/${row.id}` : `${APP_URL}/admin/scholarships`
    const staff = scholarshipStaffAlertEmail({ name, email, phone, activity, school, brief, reviewUrl })
    await sendEmail({ to: CONTACT_EMAIL, replyTo: email, ...staff })

    // The applicant's acknowledgement. HubSpot sends nothing on this form
    // (checked 2 Oct 2026: neither applicant contact has ever been sent an
    // email). Non-fatal.
    try {
      await sendEmail({ to: email, ...scholarshipReceivedEmail({ firstName, activity }) })
    } catch (e) {
      console.error('[scholarship] acknowledgement email failed (non-fatal):', e)
    }

    // Capture the applicant as a marketing lead in HubSpot (best-effort —
    // never blocks the submission if the CRM is unreachable; a failed capture
    // is dead-lettered and alerted rather than lost).
    await captureLead({
      email,
      firstName,
      lastName,
      source: 'scholarship',
      lifecycleStage: LEAD_SOURCE_LIFECYCLE.scholarship,
      activity: `Scholarship application — ${activity}${school ? ` (${school})` : ''}.`,
      logEntry: logLine('scholarship', `${activity}${school ? ` · ${school}` : ''}`),
      context: {
        hutk: readHubspotCookie(req),
        pageUri: `${SITE_URL}/scholarship`,
        pageName: 'Scholarship application',
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[scholarship] Unexpected error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
