import { NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { requireEventRoute } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth } from '@/lib/activity-log'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { sendEventEmail } from '@/lib/event-emails/send'
import { loadEventRecord, refuseOutsideStellr } from '@/lib/tenancy/load-scoped'

export const maxDuration = 60

// POST /api/admin/events/[slug]/emails/[id]/send — "Send now", or with
// { test: true } a single copy to the person pressing the button.
//
// Stellr's sender, and its daily budget. Refused outside Stellr (refuseOutsideStellr: a
// tenant's staff get 503) until the tenant-filtered admin-records helpers exist
// (AMD-C17-HELPERS) and this route passes loadTenantSender's result to sendEventEmail.
// B14 did not lift the refusal.

const ROUTE = '/api/admin/events/[slug]/emails/[id]/send'

type Ctx = { params: Promise<{ slug: string; id: string }> }

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event_email.message.send', ...auditSubject(req, 'event_emails') }),
  sendEmail,
)

async function sendEmail(req: Request, { params }: Ctx) {
  const { slug, id } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug, id })
  const refused = refuseOutsideStellr(crew.scope)
  if (refused) return refused

  const db = supabaseServer()
  // Scope check before handing the id to the engine, which does not know the URL.
  const email = await loadEventRecord<{ id: string; event_slug: string }>(crew, 'event_emails', id, {
    db,
    select: 'id, event_slug',
    notFound: () => NextResponse.json({ error: 'Email not found' }, { status: 404 }),
    label: ROUTE,
  })
  if (!email.ok) return email.response

  const b = await req.json().catch(() => ({}))
  const test = b?.test === true
  noteAuditSubject(req, { detail: { test } })
  const actor = await actorFromAuth()
  let testTo: string | undefined
  if (test) {
    const u = await currentUser().catch(() => null)
    testTo = u?.primaryEmailAddress?.emailAddress ?? u?.emailAddresses?.[0]?.emailAddress
  }

  const out = await sendEventEmail(db, id, {
    trigger: test ? 'test' : 'manual',
    triggeredBy: actor.actorLabel ?? crew.userId,
    testTo,
  })
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json({ ...out, testTo: testTo ?? null })
}
