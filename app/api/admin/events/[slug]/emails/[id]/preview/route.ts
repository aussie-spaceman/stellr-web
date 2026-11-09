import { NextResponse } from 'next/server'
import { requireEventRoute } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { resolveAudience } from '@/lib/event-emails/audiences'
import { loadEventForEmail } from '@/lib/event-emails/send'
import { eventMergeVars, recipientMergeVars, renderEventEmail, unknownTokens } from '@/lib/event-emails/render'
import { MAX_RECIPIENTS_PER_SEND, type EventEmailRow } from '@/lib/event-emails/types'
import { loadEventRecord, refuseOutsideStellr } from '@/lib/tenancy/load-scoped'

// GET /api/admin/events/[slug]/emails/[id]/preview — who this email would reach
// right now, and how it reads for one of them (?as=<email> picks which).
// Read-only: pay links show as a placeholder rather than minting tokens.
//
// The audience is built from Stellr's mentor containers and Clerk: B14 opens this to a tenant.

const ROUTE = '/api/admin/events/[slug]/emails/[id]/preview'

type Ctx = { params: Promise<{ slug: string; id: string }> }

export const GET = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event_email.preview.read', ...auditSubject(req, 'event_emails') }),
  previewEmail,
)

async function previewEmail(req: Request, { params }: Ctx) {
  const { slug, id } = await params
  const staff = await requireEventRoute(slug, { route: ROUTE })
  if (!staff.ok) return staff.response
  noteAuditSubject(req, { userId: staff.userId, tenantId: staff.tenantId, eventSlug: slug, id })
  const refused = refuseOutsideStellr(staff.scope)
  if (refused) return refused

  const db = supabaseServer()
  const loaded = await loadEventRecord<EventEmailRow>(staff, 'event_emails', id, {
    db,
    notFound: () => NextResponse.json({ error: 'Email not found' }, { status: 404 }),
    label: ROUTE,
  })
  if (!loaded.ok) return loaded.response
  const email = loaded.row
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
