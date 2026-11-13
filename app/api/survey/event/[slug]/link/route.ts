import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { rateLimit } from '@/lib/rate-limit-async'
import { requestTenant } from '@/lib/tenancy/request-tenant'
import { recordOnHost, recordTenant } from '@/lib/tenancy/host-record'
import { withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { distributionForEvent, distributionTenant, loadDefinition, statusNow } from '@/lib/survey/distributions'
import { surveySendsHeld } from '@/lib/survey/hold'
import { heldForConsent, sendLinkEmail, type InvitationRow } from '@/lib/survey/send'

// POST /api/survey/event/[slug]/link { email } — the QR page's "email me my
// link". Sends only to the address the invitation was issued to, and answers
// the same whether or not one exists, so it can't be used to probe who attended.
//
// Only this host's survey sends (S5 A10b): another host's event answers as one with
// no survey, the same { ok: true }. The request is audited on the survey's tenant's
// chain with the number of links sent, and on the platform chain when no survey of
// this host's was found.
const OK = () => NextResponse.json({ ok: true })

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, { params: Promise<{ slug: string }> }] }) => ({
    action: 'survey.link.send',
    ...auditSubject(req, 'survey_distributions'),
    actor: { session: true },
  }),
  async (req: Request, { params }: { params: Promise<{ slug: string }> }) => {
    const limited = await rateLimit(req, 'survey-link', { limit: 5, windowMs: 10 * 60_000, tenantId: (await requestTenant()).tenantId })
    if (limited) return limited
    const parsed = z.object({ email: z.string().email().max(254) }).safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
    const { slug } = await params
    const db = supabaseServer()
    const d = await distributionForEvent(db, slug)
    if (!d) return OK()
    if (!(await recordOnHost(d))) return OK()
    noteAuditSubject(req, { tenantId: recordTenant(d.tenant_id), id: d.id, eventSlug: slug, detail: { sent: 0 } })
    if (statusNow(d) === 'open') {
      const { data } = await db
        .from('survey_invitations')
        .select('*')
        .eq('distribution_id', d.id)
        .ilike('email', parsed.data.email.trim())
        .neq('status', 'submitted')
        .limit(5)
      if (data?.length) {
        const { def } = await loadDefinition(db, d.definition_id)
        // A guardian address can hold several students' invitations: send each, except one
        // held for guardian consent (decision W7-13), read once for them all. Another
        // tenant's survey sends nothing yet (W7-16), so its consent is not read: sendLinkEmail
        // refuses each of its invitations first, and the answer is the same { ok: true }.
        const held = surveySendsHeld(distributionTenant(d)) ? null : await heldForConsent(db, d)
        let sent = 0
        for (const inv of data as InvitationRow[]) if (await sendLinkEmail(db, inv, d, def, held)) sent++
        noteAuditSubject(req, { detail: { sent } })
      }
    }
    return OK()
  },
)
