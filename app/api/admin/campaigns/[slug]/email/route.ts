import { NextRequest, NextResponse } from 'next/server'
import { requireEventCrew } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/events/repo'
import { sendEmail, campaignBroadcastEmail } from '@/lib/email'
import { withAudit } from '@/lib/audit/route'
import { loadScopedRows } from '@/lib/tenancy/load-scoped'

const ROUTE = '/api/admin/campaigns/[slug]/email'

// What this request acted on, which withAudit's spec cannot read for itself. The subject
// and message are free text, so they stay out of the event.
const audited = new WeakMap<Request, { slug: string; userId: string; tenantId: string; sent?: number; failed?: number }>()

export const POST = withAudit(
  ({ args: [req] }: { args: [NextRequest, { params: Promise<{ slug: string }> }] }) => {
    const a = audited.get(req)
    return {
      action: 'campaign.email.send',
      actor: a ? { userId: a.userId } : { session: true },
      tenant: { tenantId: a?.tenantId ?? null },
      metadata: { eventSlug: a?.slug ?? null, sent: a?.sent ?? null, failed: a?.failed ?? null },
    }
  },
  emailCampaign,
)

// Admin "Email everyone" — send one message to every teacher / student manager
// registered in a campaign.
async function emailCampaign(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const crew = await requireEventCrew({ route: ROUTE })
  if (!crew.ok) return NextResponse.json({ error: 'Not authorised.' }, { status: crew.status })
  // Compares against the caller's own list, so it says nothing about whether the event exists.
  if (!crew.covers(slug)) return NextResponse.json({ error: 'Not authorised.' }, { status: 403 })
  const event: { slug: string; userId: string; tenantId: string; sent?: number; failed?: number } = { slug, userId: crew.userId, tenantId: crew.tenantId }
  audited.set(req, event)

  const body = await req.json()
  const subject = String(body.subject ?? '').trim()
  const message = String(body.message ?? '').trim()
  if (!subject || !message) {
    return NextResponse.json({ error: 'Subject and message are required.' }, { status: 400 })
  }

  const db = supabaseServer()
  const { data: rows } = await loadScopedRows<{ teacher_first_name: string | null; teacher_email: string | null; event_title: string | null }>(crew.scope, 'registrations', {
    db,
    select: 'teacher_first_name, teacher_email, event_title',
    match: { type: 'campaign', event_slug: slug },
    label: ROUTE,
  })

  const recipients = (rows ?? []).filter((r) => !!r.teacher_email)
  if (recipients.length === 0) return NextResponse.json({ sent: 0, failed: 0 })

  const campaign = await getEventBySlug(slug).catch(() => null)
  const campaignTitle = (campaign?.title as string) ?? recipients[0].event_title ?? 'your Campaign'

  let sent = 0
  let failed = 0
  for (const r of recipients) {
    try {
      const content = campaignBroadcastEmail({ subject, body: message, campaignTitle })
      await sendEmail({ to: r.teacher_email as string, ...content })
      sent++
    } catch (err) {
      console.error(`[campaigns/email] failed to email ${r.teacher_email}:`, err)
      failed++
    }
  }
  event.sent = sent
  event.failed = failed

  return NextResponse.json({ sent, failed })
}
