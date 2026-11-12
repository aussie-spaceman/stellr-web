import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { rateLimit } from '@/lib/rate-limit-async'
import { requestTenant } from '@/lib/tenancy/request-tenant'
import { recordOnHost, recordTenant } from '@/lib/tenancy/host-record'
import { withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { saveAnswers, sessionByToken } from '@/lib/team-profile/store'

// POST /api/team-profile/[token] — submit (or update) a team profile.
// Works signed out: the emailed link is the key. Answers are validated and
// normalised server-side (lib/team-profile/questions.ts).
//
// Another host's link answers as an unknown one, before the answers are checked
// (S5 A10a). A save is audited on the profile's tenant's chain; the actor is whoever
// is signed in, if anyone, since the link works signed out.
export const POST = withAudit(
  ({ args: [req] }) => ({ action: 'team_profile.record.save', ...auditSubject(req, 'team_profiles'), actor: { session: true } }),
  async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
    const limited = await rateLimit(req, 'team-profile', { limit: 30, windowMs: 60_000, tenantId: (await requestTenant()).tenantId })
    if (limited) return limited

    const { token } = await params
    const db = supabaseServer()
    const session = await sessionByToken(db, token, { onHost: recordOnHost })
    if (!session) return NextResponse.json({ error: 'This link isn’t valid.' }, { status: 404 })
    noteAuditSubject(req, { tenantId: recordTenant(session.tenant_id), id: session.row.id })

    const body = await req.json().catch(() => null)
    const result = await saveAnswers(db, session, body?.answers)
    if (!result.ok) return NextResponse.json({ error: result.error, missing: result.missing }, { status: result.status })
    return NextResponse.json({ ok: true })
  },
)
