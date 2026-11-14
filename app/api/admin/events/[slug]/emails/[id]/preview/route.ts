import { NextResponse } from 'next/server'
import { requireEventRoute } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { resolveAudience } from '@/lib/event-emails/audiences'
import { isTenantRow } from '@/lib/event-emails/tenant-mail'
import { eventVarsFor, loadEventForEmail } from '@/lib/event-emails/send'
import { recipientMergeVars, renderEventEmail, unknownTokens } from '@/lib/event-emails/render'
import { extractTokens } from '@/lib/email-render'
import { MAX_RECIPIENTS_PER_SEND, type EventEmailRow } from '@/lib/event-emails/types'
import { loadEventRecord, refuseOutsideStellr } from '@/lib/tenancy/load-scoped'

// GET /api/admin/events/[slug]/emails/[id]/preview — who this email would reach
// right now, and how it reads for one of them (?as=<email> picks which).
// Read-only: pay links show as a placeholder rather than minting tokens.
//
// The audience is built from Stellr's mentor containers and Clerk. Refused outside Stellr
// (refuseOutsideStellr: a tenant's staff get 503) until the tenant-filtered admin-records
// helpers exist (AMD-C17-HELPERS). B14 did not lift the refusal.

const ROUTE = '/api/admin/events/[slug]/emails/[id]/preview'

type Ctx = { params: Promise<{ slug: string; id: string }> }

export const GET = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event_email.preview.read', ...auditSubject(req, 'event_emails') }),
  previewEmail,
)

async function previewEmail(req: Request, { params }: Ctx) {
  const { slug, id } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug, id })
  const refused = refuseOutsideStellr(crew.scope)
  if (refused) return refused

  const db = supabaseServer()
  const loaded = await loadEventRecord<EventEmailRow>(crew, 'event_emails', id, {
    db,
    notFound: () => NextResponse.json({ error: 'Email not found' }, { status: 404 }),
    label: ROUTE,
  })
  if (!loaded.ok) return loaded.response
  const email = loaded.row
  const event = await loadEventForEmail(slug)
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  // S5 wave 6: as the send does (lib/event-emails/send.ts), another tenant's email
  // leaves out its consent-pending participants, All attendees included. Stellr's
  // emails pass nothing. Refused outside Stellr above until AMD-C17-HELPERS lifts it.
  const { recipients, docusignParticipantIds } = await resolveAudience(
    db,
    event,
    email.audiences,
    isTenantRow(email.tenant_id) ? { tenantId: email.tenant_id } : {},
  )
  const as = new URL(req.url).searchParams.get('as')?.toLowerCase()
  const sample = recipients.find((r) => r.email === as) ?? recipients[0] ?? null

  const bad = unknownTokens(email.subject, email.body_json)
  let rendered: { subject: string; html: string } | null = null
  let renderError: string | null = bad.length ? `Unknown merge field: ${bad.map((t) => `{{${t}}}`).join(', ')}` : null
  const eventVars = await eventVarsFor(db, email, event)
  if (!renderError) {
    try {
      const vars = {
        ...eventVars,
        ...recipientMergeVars(sample ?? { email: '', firstName: 'there', roles: [], participantNames: [], isParticipant: true, payments: [] }),
      }
      const out = renderEventEmail(email, vars)
      rendered = { subject: out.subject, html: out.html }
    } catch (err) {
      renderError = err instanceof Error ? err.message : 'Could not render'
    }
  }

  // Fields this email uses that will come out empty, so the author sees it
  // before sending ("And our overall champion company - !").
  const used = new Set([...extractTokens(email.subject), ...extractTokens(JSON.stringify(email.body_json ?? ''))])
  const warnings: string[] = []
  for (const [token, value] of Object.entries(eventVars)) {
    if (used.has(token) && !value) warnings.push(`{{${token}}} is empty for this event.`)
  }
  for (const token of ['certificate_links', 'credential_links']) {
    if (!used.has(token)) continue
    const without = recipients.filter((r) => !r.credentials?.length).length
    if (without) warnings.push(`{{${token}}} is empty for ${without} of ${recipients.length} recipient${recipients.length === 1 ? '' : 's'} (no issued credentials).`)
  }

  return NextResponse.json({
    warnings,
    recipients: recipients.map((r) => ({ email: r.email, name: r.name, roles: r.roles, reasons: r.reasons })),
    count: recipients.length,
    max: MAX_RECIPIENTS_PER_SEND,
    docusignOutstanding: docusignParticipantIds.length,
    sampleEmail: sample?.email ?? null,
    rendered,
    renderError,
  })
}
