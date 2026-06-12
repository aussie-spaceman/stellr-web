import { NextResponse } from 'next/server'
import { requireEventAccess } from '@/lib/event-access'
import { getEventRoster } from '@/lib/event-admin'
import { getEventBySlug, type StellarEvent } from '@/lib/sanity'
import { sendEmail, outstandingItemsReminderEmail } from '@/lib/email'

// POST /api/admin/events/[slug]/remind — one-click reminder emails for the
// participants matching the roster filters (admins + assigned event managers).
//   body: { payment: boolean, docusign: boolean }  (at least one true)
// Filter semantics mirror the roster UI: when both flags are set only
// participants failing BOTH checks are emailed, and the email covers both.
// Recipients: the participant; CC the emergency contact for minors and the
// teacher / student manager for group registrations.

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = await req.json().catch(() => null)
  const payment = body?.payment === true
  const docusign = body?.docusign === true
  if (!payment && !docusign) {
    return NextResponse.json({ error: 'Select the Payment: Outstanding or DocuSign: Outstanding filter first' }, { status: 400 })
  }

  const event = (await getEventBySlug(slug)) as StellarEvent | null
  if (!event) return NextResponse.json({ error: 'Unknown event' }, { status: 404 })

  const roster = await getEventRoster(slug, event.date)

  let sent = 0
  let failed = 0
  for (const group of roster.groups) {
    for (const p of group.participants) {
      if (payment && p.paid) continue
      if (docusign && p.docusign !== 'outstanding') continue
      if (!p.email) continue

      const content = outstandingItemsReminderEmail({
        firstName: p.first_name,
        eventTitle: event.title,
        payment: payment ? { method: p.payment_pill.startsWith('invoice') ? 'invoice' : 'link' } : undefined,
        docusign: docusign ? { minor: p.minor, guardianName: p.emergency_contact_name } : undefined,
      })

      const cc = new Set<string>()
      if (p.minor && p.emergency_contact_email) cc.add(p.emergency_contact_email.toLowerCase())
      if (group.type === 'group' && group.teacherEmail) cc.add(group.teacherEmail.toLowerCase())
      cc.delete(p.email.toLowerCase())

      try {
        await sendEmail({ to: p.email, cc: [...cc], ...content })
        sent++
      } catch (err) {
        console.error(`[remind] Failed to email ${p.email} for ${slug}:`, err)
        failed++
      }
    }
  }

  return NextResponse.json({ sent, failed })
}
