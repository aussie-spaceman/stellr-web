import { NextResponse } from 'next/server'
import { z } from 'zod'
import { sendEmail } from '@/lib/email'
import { rateLimitGuard, HOUR_MS } from '@/lib/rate-limit'
import { supabaseServer } from '@/lib/supabase'
import { getAllEvents, type StellarEvent } from '@/lib/sanity'
import { getCurrentMember } from '@/lib/community'
import { assertNotImpersonating } from '@/lib/impersonation'
import { scholarshipReceivedEmail, scholarshipStaffAlertEmail } from '@/lib/scholarship-emails'
import { auditMutation } from '@/lib/audit/route'

const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? 'hello@stellreducation.org'
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
  // View-as is read only. getCurrentMember() below resolves to the member an
  // admin is viewing as, so without this an admin's submission would be filed
  // as that member's application.
  const blocked = await assertNotImpersonating()
  if (blocked) return blocked
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const { response, applicationId } = await fileApplication(parsed.data)

  // docs/TENANCY-S5.md, B18. An applicant may be a child, and the form asks no age, so
  // the event holds the row's id and nothing from the form.
  await auditMutation(
    {
      action: 'scholarship.application.create',
      actor: { session: true },
      tenant: { stellr: true },
      target: { table: 'scholarship_applications', id: applicationId },
      metadata: { saved: applicationId !== null, status: response.status },
    },
    { afterResponse: true },
  )
  return response
}

/** Save and email an application. Never throws: a failure is the 500 it answers with. */
async function fileApplication(input: z.infer<typeof schema>): Promise<{ response: Response; applicationId: string | null }> {
  let applicationId: string | null = null
  try {
    const { firstName, lastName, email, activity, brief } = input
    const phone = input.phone || null
    const school = input.school || null
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
    applicationId = row?.id ?? null

    const reviewUrl = row ? `${APP_URL}/admin/scholarships/${row.id}` : `${APP_URL}/admin/scholarships`
    const staff = scholarshipStaffAlertEmail({ name, email, phone, activity, school, brief, reviewUrl })
    await sendEmail({ to: CONTACT_EMAIL, replyTo: email, ...staff })

    // The applicant's acknowledgement. Non-fatal.
    try {
      await sendEmail({ to: email, ...scholarshipReceivedEmail({ firstName, activity }) })
    } catch (e) {
      console.error('[scholarship] acknowledgement email failed (non-fatal):', e)
    }

    // deep review MP-8: do NOT push scholarship applicants into the marketing
    // CRM. The form is addressed to students ("Any student…") and asks no age,
    // so an applicant may well be a child (some under 13). captureLead created a
    // HubSpot contact with a marketing lifecycle stage and attached the
    // `hubspotutk` tracking cookie, joining a child's browsing on www to a
    // marketing profile — outside the "service providers we need to run our
    // programs" carve-out in Privacy §9.4. The application is already stored in
    // `scholarship_applications` and emailed to staff for review, so nothing is
    // lost by not marketing-capturing it.

    return { response: NextResponse.json({ ok: true }), applicationId }
  } catch (err) {
    console.error('[scholarship] Unexpected error:', err)
    return { response: NextResponse.json({ error: 'Server error' }, { status: 500 }), applicationId }
  }
}
