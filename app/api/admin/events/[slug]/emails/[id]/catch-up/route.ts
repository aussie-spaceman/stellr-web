import { NextResponse } from 'next/server'
import { requireEventRoute } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth } from '@/lib/activity-log'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { catchUpStatus, sendCatchUp } from '@/lib/event-emails/catch-up'
import type { EventEmailRow } from '@/lib/event-emails/types'
import { loadEventRecord, refuseOutsideStellr } from '@/lib/tenancy/load-scoped'

export const maxDuration = 60

// /api/admin/events/[slug]/emails/[id]/catch-up — late registrants on a sent
// All-participants email (lib/event-emails/catch-up.ts).
//   GET  → { eligible, open, audiences, pending: [{ email, name, roles }] }
//   POST → send it to them now (the cron does the same three times a day)
//
// Both resolve the audience and send through Stellr's sender: B14 opens them to a tenant.

const ROUTE = '/api/admin/events/[slug]/emails/[id]/catch-up'

type Ctx = { params: Promise<{ slug: string; id: string }> }

const notFound = () => NextResponse.json({ error: 'Email not found' }, { status: 404 })

export const GET = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event_email.catch_up.read', ...auditSubject(req, 'event_emails') }),
  readCatchUp,
)

async function readCatchUp(req: Request, { params }: Ctx) {
  const { slug, id } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug, id })
  const refused = refuseOutsideStellr(crew.scope)
  if (refused) return refused

  const db = supabaseServer()
  const email = await loadEventRecord<EventEmailRow>(crew, 'event_emails', id, { db, notFound, label: ROUTE })
  if (!email.ok) return email.response
  try {
    return NextResponse.json(await catchUpStatus(db, email.row))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not check' }, { status: 500 })
  }
}

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event_email.catch_up.send', ...auditSubject(req, 'event_emails') }),
  sendLate,
)

async function sendLate(req: Request, { params }: Ctx) {
  const { slug, id } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug, id })
  const refused = refuseOutsideStellr(crew.scope)
  if (refused) return refused

  const db = supabaseServer()
  // Scope check before handing the id to the engine, which does not know the URL.
  const email = await loadEventRecord<EventEmailRow>(crew, 'event_emails', id, { db, select: 'id, event_slug', notFound, label: ROUTE })
  if (!email.ok) return email.response

  const actor = await actorFromAuth()
  const out = await sendCatchUp(db, id, { triggeredBy: actor.actorLabel ?? crew.userId })
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json(out)
}
