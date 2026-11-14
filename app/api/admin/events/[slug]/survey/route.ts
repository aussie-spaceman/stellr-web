import { NextResponse } from 'next/server'
import { z } from 'zod'
import { hasCapability, requireEventRoute } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { getSignedInMember } from '@/lib/community'
import { adminSurveyView } from '@/lib/survey/admin'
import { logSurveyAccess, writeAudit } from '@/lib/survey/audit'
import {
  closeEarly,
  distributionForEvent,
  loadDefinition,
  openAfterEvent,
  pauseDistribution,
  resetGoLive,
  resumeDistribution,
  setAudiences,
  setEarlierGoLive,
  setMinorAgreementOverride,
  type Actor,
} from '@/lib/survey/distributions'
import { loadSurveyEvent } from '@/lib/survey/events'
import { runOne } from '@/lib/survey/run'
import { resendInvitation, type InvitationRow } from '@/lib/survey/send'
import { loadRecord, refuseOutsideStellr, scopedRowWrite } from '@/lib/tenancy/load-scoped'
import { loadEventTenantId } from '@/lib/authz/principal'

// /api/admin/events/[slug]/survey — the event's "Survey" tab (admins and the
// event's assigned managers; handover A1/A2).
//   GET  → schedule, recipient preview, completion table
//   POST { action, … } → send_now | set_go_live {at} | reset_go_live | pause |
//        resume | close | audiences {audiences} | resend {invitationId} |
//        gate_certificate {on}
//        Admins only: open_after_event {acceptOlderMinorAgreements} (an event
//        that ended without a survey) | minor_agreement_override {on}
// Every change is written to audit_log; viewing the table to survey_access_log.
//
// Both refuse a tenant's staff. Opening this tab makes the event's distribution, and the
// survey cron then sends it through Stellr's sender on Stellr's definition: A10 and B13 are
// what make that a tenant's own.

const ROUTE = '/api/admin/events/[slug]/survey'

type Ctx = { params: Promise<{ slug: string }> }
export const maxDuration = 60

export const GET = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'survey.distribution.read', ...auditSubject(req, 'survey_distributions') }),
  readSurvey,
)

async function readSurvey(req: Request, { params }: Ctx) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug })
  const refused = refuseOutsideStellr(crew.scope)
  if (refused) return refused
  const db = supabaseServer()
  const view = await adminSurveyView(db, slug, new Date(), () => loadEventTenantId(db, slug))
  if (view.rows.length) {
    await logSurveyAccess(db, { actor: crew.userId, action: 'view', eventSlug: slug, distributionId: view.distribution?.id, rowCount: view.rows.length, detail: { what: 'completion_table' } })
  }
  noteAuditSubject(req, { id: view.distribution?.id ?? null })
  return NextResponse.json({ ...view, isAdmin: crew.isAdmin || (await hasCapability('competitions:write', { route: ROUTE })) })
}

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send_now') }),
  z.object({ action: z.literal('set_go_live'), at: z.string().min(10) }),
  z.object({ action: z.literal('reset_go_live') }),
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('close') }),
  z.object({ action: z.literal('audiences'), audiences: z.array(z.enum(['student', 'mentor', 'adult'])).min(1) }),
  z.object({ action: z.literal('resend'), invitationId: z.guid() }),
  z.object({ action: z.literal('gate_certificate'), on: z.boolean() }),
  z.object({ action: z.literal('open_after_event'), acceptOlderMinorAgreements: z.boolean() }),
  z.object({ action: z.literal('minor_agreement_override'), on: z.boolean() }),
])

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'survey.distribution.change', ...auditSubject(req, 'survey_distributions') }),
  changeSurvey,
)

async function changeSurvey(req: Request, { params }: Ctx) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug })
  const refused = refuseOutsideStellr(crew.scope)
  if (refused) return refused
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const body = parsed.data
  noteAuditSubject(req, { detail: { survey_action: body.action } })

  const db = supabaseServer()
  const me = await getSignedInMember().catch(() => null)
  const actor: Actor = { memberId: me?.id ?? null, label: crew.userId }

  // Admins and Staff (competitions:write) run a survey's settings; an event manager does not.
  const canManage = crew.isAdmin || (await hasCapability('competitions:write', { route: ROUTE }))

  if (body.action === 'open_after_event') {
    if (!canManage) return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
    const event = await loadSurveyEvent(slug)
    if (!event) return NextResponse.json({ error: 'Event not found.' }, { status: 404 })
    const r = await openAfterEvent(db, event, { acceptOlderMinorAgreements: body.acceptOlderMinorAgreements }, actor)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    noteAuditSubject(req, { id: r.distribution.id })
    try {
      const run = await runOne(db, r.distribution.id)
      return NextResponse.json({ ok: true, run })
    } catch (err) {
      // Open regardless; the cron sends whatever this pass could not.
      return NextResponse.json({ ok: true, warning: err instanceof Error ? err.message : String(err) })
    }
  }

  const d = await distributionForEvent(db, slug)
  if (!d) return NextResponse.json({ error: 'This event has no survey yet.' }, { status: 404 })
  noteAuditSubject(req, { id: d.id })

  switch (body.action) {
    case 'send_now': {
      const r = await setEarlierGoLive(db, d, 'now', actor)
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
      try {
        const run = await runOne(db, d.id)
        return NextResponse.json({ ok: true, run })
      } catch (err) {
        // Open regardless; the cron sends whatever this pass could not.
        return NextResponse.json({ ok: true, warning: err instanceof Error ? err.message : String(err) })
      }
    }
    case 'set_go_live': {
      const r = await setEarlierGoLive(db, d, new Date(body.at), actor)
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status })
    }
    case 'reset_go_live': {
      const r = await resetGoLive(db, d, actor)
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status })
    }
    case 'pause': {
      const r = await pauseDistribution(db, d, actor)
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status })
    }
    case 'resume': {
      const r = await resumeDistribution(db, d, actor)
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status })
    }
    case 'close': {
      const r = await closeEarly(db, d, actor)
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status })
    }
    case 'audiences': {
      const r = await setAudiences(db, d, body.audiences, actor)
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status })
    }
    case 'gate_certificate': {
      if (!canManage) return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
      await scopedRowWrite(crew.scope, 'survey_distributions', d.id, { db }).update({ gate_certificate: body.on })
      await writeAudit(db, { table: 'survey_distributions', recordId: d.id, action: 'UPDATE', actor: actor.label, data: { event: 'gate_certificate', on: body.on } })
      return NextResponse.json({ ok: true })
    }
    case 'minor_agreement_override': {
      // A safeguarding decision about minors' agreements: admins only, Staff included out.
      if (!crew.isAdmin) return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
      const r = await setMinorAgreementOverride(db, d, body.on, actor)
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status })
    }
    case 'resend': {
      // An invitation of this event's distribution, and no other: any other id answers as a missing one.
      const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })
      const inv = await loadRecord<InvitationRow>(crew.scope, 'survey_invitations', body.invitationId, { db, notFound, label: ROUTE })
      if (!inv.ok) return inv.response
      if (inv.row.distribution_id !== d.id) return notFound()
      if (d.status !== 'open') return NextResponse.json({ error: 'The survey isn’t open.' }, { status: 409 })
      const { def } = await loadDefinition(db, d.definition_id)
      const r = await resendInvitation(db, inv.row, d, def)
      if (r.ok) await writeAudit(db, { table: 'survey_invitations', recordId: body.invitationId, action: 'UPDATE', actor: actor.label, data: { event: 'resend' } })
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 })
    }
  }
}
