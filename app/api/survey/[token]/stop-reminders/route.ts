import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { rateLimit } from '@/lib/rate-limit-async'
import { requestTenant } from '@/lib/tenancy/request-tenant'
import { recordOnHost, recordTenant } from '@/lib/tenancy/host-record'
import { withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { invitationByToken } from '@/lib/survey/access'

// POST /api/survey/[token]/stop-reminders — stop survey reminders for this
// invitation. Target of the emails' List-Unsubscribe-Post one-click header
// (RFC 8058) and of the button on /survey/[token]/stop-reminders. Survey
// reminders only: marketing consent is untouched. GET does nothing, so link
// scanners that prefetch email links cannot opt anyone out.
//
// Another host's link answers as an unknown one, and changes nothing (S5 A10b). The
// stop is audited on the survey's tenant's chain.
export const POST = withAudit(
  ({ args: [req] }: { args: [Request, { params: Promise<{ token: string }> }] }) => ({
    action: 'survey.reminder.stop',
    ...auditSubject(req, 'survey_invitations'),
    actor: { session: true },
  }),
  async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
    const limited = await rateLimit(req, 'survey-stop', { limit: 30, windowMs: 60_000, tenantId: (await requestTenant()).tenantId })
    if (limited) return limited
    const db = supabaseServer()
    const inv = await invitationByToken(db, (await params).token)
    if (!inv) return NextResponse.json({ error: 'This link isn’t valid.' }, { status: 404 })
    if (!(await recordOnHost(inv))) return NextResponse.json({ error: 'This link isn’t valid.' }, { status: 404 })
    noteAuditSubject(req, { tenantId: recordTenant(inv.tenant_id), id: inv.id })
    if (!inv.reminders_opted_out_at) {
      await db
        .from('survey_invitations')
        .update({ reminders_opted_out_at: new Date().toISOString(), ...(inv.status === 'queued' ? { status: 'opted_out' } : {}) })
        .eq('id', inv.id)
    }
    return NextResponse.json({ ok: true })
  },
)
