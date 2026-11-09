import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { currentTenantId, requireTenantStaff } from '@/lib/authz'
import { withdrawQuote } from '@/lib/survey/withdraw'
import { actorFromAuth } from '@/lib/activity-log'
import { withAudit } from '@/lib/audit/route'
import { loadRecord } from '@/lib/tenancy/load-scoped'
import { isStellrScope, tenantWideScope } from '@/lib/tenancy/scope-context'

const ROUTE = '/api/admin/surveys/responses/[id]/withdraw-quote'

// What this request acted on, which withAudit's spec cannot read for itself.
const audited = new WeakMap<Request, { id: string; userId: string | null; tenantId: string }>()

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, { params: Promise<{ id: string }> }] }) => {
    const a = audited.get(req)
    return {
      action: 'survey.quote.withdraw',
      actor: a ? { userId: a.userId } : { session: true },
      tenant: { tenantId: a?.tenantId ?? null },
      target: { table: 'survey_responses', id: a?.id ?? null },
    }
  },
  withdraw,
)

const notFound = () => NextResponse.json({ error: 'Not found, not submitted, or already withdrawn.' }, { status: 404 })

// POST /api/admin/surveys/responses/[id]/withdraw-quote — an admin withdraws a
// response's quote (e.g. on a parent's request). Permanent; logged.
async function withdraw(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireTenantStaff(currentTenantId(), ['tenant_admin'], { route: ROUTE })
  if (!admin.ok) return NextResponse.json({ error: admin.status === 401 ? 'Unauthorised' : 'Admins only' }, { status: admin.status })
  const { userId } = await auth()
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) return notFound()
  audited.set(req, { id, userId, tenantId: admin.tenantId })

  const db = supabaseServer()
  const scope = tenantWideScope(admin.tenantId, 'tenant_admin')
  const loaded = await loadRecord<{ id: string }>(scope, 'survey_responses', id, { db, select: 'id', notFound, label: ROUTE })
  if (!loaded.ok) return loaded.response

  const done = await withdrawQuote(db, id, userId ?? '', 'admin', await actorFromAuth(), { skipMemberActivity: !isStellrScope(scope) })
  return done ? NextResponse.json({ ok: true }) : notFound()
}
