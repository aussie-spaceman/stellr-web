import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventRoute } from '@/lib/authz'
import { getEventBySlug } from '@/lib/events/repo'
import { eventTitleFromRegistrations, stellrOnlyDb } from '@/lib/events/admin-records'
import { getSignedInMember } from '@/lib/community'
import { issueCredential, CredentialNotIssuedError, CREDENTIAL_COLUMNS } from '@/lib/credentials'
import { sendCredentialIssuedEmail } from '@/lib/credentials-notify'
import { logActivity } from '@/lib/activity-log'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { themeFromType } from '@/lib/campaigns'
import { parsePdHours, pdCredentialTitle, pdStandardCodes, formatPdHours } from '@/lib/pd-standards'
import { loadScopedRows, refuseOutsideStellr } from '@/lib/tenancy/load-scoped'
import { isStellrScope, type ScopeContext } from '@/lib/tenancy/scope-context'

export const dynamic = 'force-dynamic'

// Educator PD credentials for an event: an admin records the hours a teacher
// gave, and the teacher gets a PD certificate + a LinkedIn-ready credential.
// Manual only (decision Q1, 7 Oct 2026). Design: docs/PLAN-educator-pd-2026-10-07.md.
//
// GET is open to the event's managers (read-only list). POST is admins only:
// hours on a certificate a teacher submits to a licensing body are an
// attestation, and finding the teacher needs the all-members search.
//
// The credential says Stellr Education issued it, on standards Stellr mapped, to someone
// found across all members. So a tenant's staff may read their event's list and not issue.

const ROUTE = '/api/admin/events/[slug]/pd-credentials'

type Ctx = { params: Promise<{ slug: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response

  const { data, error } = await loadScopedRows(crew.scope, 'credentials', {
    db: supabaseServer(),
    select: CREDENTIAL_COLUMNS,
    match: { event_slug: slug, source: 'pd' },
    order: { column: 'issued_at', ascending: false },
    label: ROUTE,
  })
  if (error) return NextResponse.json({ error: (error as { message?: string }).message }, { status: 500 })
  return NextResponse.json({ credentials: data ?? [], canIssue: crew.isAdmin && isStellrScope(crew.scope) })
}

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'credential.pd.issue', ...auditSubject(req, 'credentials') }),
  issuePdCredential,
)

// POST { memberId, hours } — issue one. Idempotent: a live PD credential for
// this member and event is returned as-is (created: false), whatever the hours
// sent; a correction is revoke + issue again.
async function issuePdCredential(req: Request, { params }: Ctx) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  if (!crew.isAdmin) return NextResponse.json({ error: 'Only admins can record PD hours' }, { status: 403 })
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug })
  const refused = refuseOutsideStellr(crew.scope)
  if (refused) return refused

  const body = (await req.json().catch(() => ({}))) as { memberId?: unknown; hours?: unknown }
  const memberId = typeof body.memberId === 'string' ? body.memberId : ''
  const hours = parsePdHours(body.hours)
  if (!memberId) return NextResponse.json({ error: 'Choose an educator' }, { status: 400 })
  if (hours === null) return NextResponse.json({ error: 'Hours must be between 0.1 and 40' }, { status: 400 })

  const db = supabaseServer()
  const [{ data: member }, event] = await Promise.all([
    db.from('members')
      .select('id, first_name, last_name, email, date_of_birth, is_active')
      .eq('id', memberId)
      .maybeSingle(),
    eventFor(crew.scope, slug),
  ])
  if (!member || member.is_active === false) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const ev = event
  const eventTitle = ev.title ?? slug
  const place = [ev.city, ev.state].filter(Boolean).join(', ')
  const location = [ev.venue, place].filter(Boolean).join(', ') || null
  const theme = themeFromType(ev.type) === 'enviro' ? 'environmental' : 'space'

  let result
  try {
    result = await issueCredential(db, {
      source:           'pd',
      memberId:         member.id,
      eventSlug:        slug,
      recipient:        { firstName: member.first_name ?? '', lastName: member.last_name ?? '', dateOfBirth: member.date_of_birth ?? null },
      title:            pdCredentialTitle(eventTitle, hours),
      description:      'Recognises an educator who gave their time to support students at a Stellr Education STEM competition.',
      criteria:         'Supported the event in person. Hours are recorded by Stellr Education staff and mapped to Common Core State Standards.',
      issuer:           'Stellr Education',
      roleLabel:        'Educator',
      theme,
      pdHours:          hours,
      standards:        pdStandardCodes(),
      activityTitle:    eventTitle,
      activityDate:     ev.date ?? null,
      activityLocation: location,
    })
  } catch (err) {
    // A refusal (S5 A10a: another organisation's event) is a conflict with the event's
    // owner, not a server fault, so it answers 409 with the reason (owner-approved
    // follow-up, 13 Nov 2026). Anything else is still a 500.
    if (err instanceof CredentialNotIssuedError) {
      return NextResponse.json({ error: err.message, reason: err.reason }, { status: 409 })
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
  noteAuditSubject(req, { id: (result.row as { id?: string }).id ?? null, detail: { created: result.created } })

  let emailed = false
  if (result.created) {
    emailed = await sendCredentialIssuedEmail(db, result.row, { firstName: member.first_name ?? '', email: member.email })
    // The acting admin, not a member they may be viewing as (getCurrentMember
    // follows a live view-as ticket). S0, Nov 2026.
    const actor = await getSignedInMember()
    await logActivity({
      memberId: member.id,
      category: 'account',
      actorType: 'admin',
      actorMemberId: actor?.id ?? null,
      action: 'pd_credential_issued',
      summary: `PD credential issued: ${formatPdHours(hours)} hours at ${eventTitle} (${result.row.number})`,
    })
  }

  // The row carries its tenant for the email's check (S5 A10a); the response stays as it was.
  const { tenant_id: _tenantId, ...credential } = result.row
  return NextResponse.json({ ok: true, created: result.created, emailed, credential })
}

type EventFacts = { title?: string; type?: string; date?: string | null; venue?: string | null; city?: string | null; state?: string | null }

/**
 * Title, date and venue come from Sanity. When Sanity has no document for the
 * slug (or is not configured — CI has no Sanity credentials), fall back to the
 * title stored on the event's registrations: the certificate then carries no
 * date or place rather than the issue being refused.
 */
async function eventFor(scope: ScopeContext, slug: string): Promise<EventFacts | null> {
  const fromSanity = (await getEventBySlug(slug).catch(() => null)) as EventFacts | null
  if (fromSanity?.title) return fromSanity
  const title = await eventTitleFromRegistrations(stellrOnlyDb(scope, supabaseServer()), slug)
  return title ? { title } : null
}
