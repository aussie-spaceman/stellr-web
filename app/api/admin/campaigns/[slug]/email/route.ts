import { NextRequest, NextResponse } from 'next/server'
import { requireEventAccess } from '@/lib/event-access'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import { sendEmail, campaignBroadcastEmail } from '@/lib/email'

// Admin "Email everyone" — send one message to every teacher / student manager
// registered in a campaign.
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Not authorised.' }, { status: access.status })

  const body = await req.json()
  const subject = String(body.subject ?? '').trim()
  const message = String(body.message ?? '').trim()
  if (!subject || !message) {
    return NextResponse.json({ error: 'Subject and message are required.' }, { status: 400 })
  }

  const db = supabaseServer()
  const { data: rows } = await db
    .from('registrations')
    .select('teacher_first_name, teacher_email, event_title')
    .eq('type', 'campaign')
    .eq('event_slug', slug)

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

  return NextResponse.json({ sent, failed })
}
