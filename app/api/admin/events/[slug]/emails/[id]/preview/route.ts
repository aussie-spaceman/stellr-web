import { NextResponse } from 'next/server'
import { requireEventAccess } from '@/lib/event-access'
import { supabaseServer } from '@/lib/supabase'
import { getEventEmail } from '@/lib/event-emails/store'
import { resolveAudience } from '@/lib/event-emails/audiences'
import { loadEventForEmail } from '@/lib/event-emails/send'
import { eventMergeVars, recipientMergeVars, renderEventEmail, unknownTokens } from '@/lib/event-emails/render'
import { MAX_RECIPIENTS_PER_SEND } from '@/lib/event-emails/types'

// GET /api/admin/events/[slug]/emails/[id]/preview — who this email would reach
// right now, and how it reads for one of them (?as=<email> picks which).
// Read-only: pay links show as a placeholder rather than minting tokens.

type Ctx = { params: Promise<{ slug: string; id: string }> }

export async function GET(req: Request, { params }: Ctx) {
  const { slug, id } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const db = supabaseServer()
  const email = await getEventEmail(db, slug, id)
  if (!email) return NextResponse.json({ error: 'Email not found' }, { status: 404 })
  const event = await loadEventForEmail(slug)
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const { recipients, docusignParticipantIds } = await resolveAudience(db, event, email.audiences)
  const as = new URL(req.url).searchParams.get('as')?.toLowerCase()
  const sample = recipients.find((r) => r.email === as) ?? recipients[0] ?? null

  const bad = unknownTokens(email.subject, email.body_json)
  let rendered: { subject: string; html: string } | null = null
  let renderError: string | null = bad.length ? `Unknown merge field: ${bad.map((t) => `{{${t}}}`).join(', ')}` : null
  if (!renderError) {
    try {
      const vars = {
        ...eventMergeVars(event),
        ...recipientMergeVars(sample ?? { email: '', firstName: 'there', roles: [], participantNames: [], isParticipant: true, payments: [] }),
      }
      const out = renderEventEmail(email, vars)
      rendered = { subject: out.subject, html: out.html }
    } catch (err) {
      renderError = err instanceof Error ? err.message : 'Could not render'
    }
  }

  return NextResponse.json({
    recipients: recipients.map((r) => ({ email: r.email, name: r.name, roles: r.roles, reasons: r.reasons })),
    count: recipients.length,
    max: MAX_RECIPIENTS_PER_SEND,
    docusignOutstanding: docusignParticipantIds.length,
    sampleEmail: sample?.email ?? null,
    rendered,
    renderError,
  })
}
