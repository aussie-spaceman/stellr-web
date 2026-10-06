import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireEventAccess } from '@/lib/event-access'
import { supabaseServer } from '@/lib/supabase'
import { getSignedInMember } from '@/lib/community'
import { adminSurveyView } from '@/lib/survey/admin'
import { logSurveyAccess, writeAudit } from '@/lib/survey/audit'
import {
  closeEarly,
  distributionForEvent,
  loadDefinition,
  pauseDistribution,
  resetGoLive,
  resumeDistribution,
  setAudiences,
  setEarlierGoLive,
  type Actor,
} from '@/lib/survey/distributions'
import { runOne } from '@/lib/survey/run'
import { resendInvitation, type InvitationRow } from '@/lib/survey/send'

// /api/admin/events/[slug]/survey — the event's "Survey" tab (admins and the
// event's assigned managers; handover A1/A2).
//   GET  → schedule, recipient preview, completion table
//   POST { action, … } → send_now | set_go_live {at} | reset_go_live | pause |
//        resume | close | audiences {audiences} | resend {invitationId} |
//        gate_certificate {on}
// Every change is written to audit_log; viewing the table to survey_access_log.

type Ctx = { params: Promise<{ slug: string }> }
export const maxDuration = 60

export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const db = supabaseServer()
  const view = await adminSurveyView(db, slug)
  if (view.rows.length) {
    await logSurveyAccess(db, { actor: access.userId, action: 'view', eventSlug: slug, distributionId: view.distribution?.id, rowCount: view.rows.length, detail: { what: 'completion_table' } })
  }
  return NextResponse.json({ ...view, isAdmin: access.isAdmin })
}

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send_now') }),
  z.object({ action: z.literal('set_go_live'), at: z.string().min(10) }),
  z.object({ action: z.literal('reset_go_live') }),
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('close') }),
  z.object({ action: z.literal('audiences'), audiences: z.array(z.enum(['student', 'mentor', 'adult'])).min(1) }),
  z.object({ action: z.literal('resend'), invitationId: z.string().uuid() }),
  z.object({ action: z.literal('gate_certificate'), on: z.boolean() }),
])

export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const body = parsed.data

  const db = supabaseServer()
  const d = await distributionForEvent(db, slug)
  if (!d) return NextResponse.json({ error: 'This event has no survey yet.' }, { status: 404 })
  const me = await getSignedInMember().catch(() => null)
  const actor: Actor = { memberId: me?.id ?? null, label: access.userId }

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
      if (!access.isAdmin) return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
      await db.from('survey_distributions').update({ gate_certificate: body.on }).eq('id', d.id)
      await writeAudit(db, { table: 'survey_distributions', recordId: d.id, action: 'UPDATE', actor: actor.label, data: { event: 'gate_certificate', on: body.on } })
      return NextResponse.json({ ok: true })
    }
    case 'resend': {
      const { data: inv } = await db.from('survey_invitations').select('*').eq('id', body.invitationId).eq('distribution_id', d.id).maybeSingle()
      if (!inv) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      if (d.status !== 'open') return NextResponse.json({ error: 'The survey isn’t open.' }, { status: 409 })
      const { def } = await loadDefinition(db, d.definition_id)
      const r = await resendInvitation(db, inv as InvitationRow, d, def)
      if (r.ok) await writeAudit(db, { table: 'survey_invitations', recordId: body.invitationId, action: 'UPDATE', actor: actor.label, data: { event: 'resend' } })
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 })
    }
  }
}
