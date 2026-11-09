import { NextResponse } from 'next/server'
import { requireEventStaff } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth } from '@/lib/activity-log'
import { withAudit } from '@/lib/audit/route'
import { loadEventRecord } from '@/lib/tenancy/load-scoped'
import { staffDecide } from '@/lib/esign/email-changes'

// POST /api/admin/agreements/[id]/email-changes/[changeId]  body { decision: 'approve' | 'reject' }
// An admin, or an event manager for their own event, approves or rejects a
// student's suggested parent/guardian address (lib/esign/email-changes.ts).

const ROUTE = '/api/admin/agreements/[id]/email-changes/[changeId]'

type Args = [Request, { params: Promise<{ id: string; changeId: string }> }]
const audited = new WeakMap<Request, { id: string; userId: string; tenantId: string }>()

export const POST = withAudit(
  ({ args: [req] }: { args: Args }) => {
    const a = audited.get(req)
    return {
      action: 'agreement.suggestion.decide',
      actor: a ? { userId: a.userId } : { session: true as const },
      tenant: { tenantId: a?.tenantId ?? null },
      target: { table: 'agreements', id: a?.id ?? null },
    }
  },
  decideSuggestion,
)

async function decideSuggestion(req: Request, { params }: { params: Promise<{ id: string; changeId: string }> }) {
  const { id, changeId } = await params
  // Who is asking first, so a signed-out caller learns nothing about the id.
  const staff = await requireEventStaff({ route: ROUTE })
  if (!staff.ok) return NextResponse.json({ error: 'Forbidden' }, { status: staff.status })
  audited.set(req, { id, userId: staff.userId, tenantId: staff.tenantId })

  const db = supabaseServer()
  const loaded = await loadEventRecord<{ event_slug: string | null }>(staff, 'agreements', id, {
    db,
    select: 'event_slug',
    notFound: () => NextResponse.json({ error: 'Agreement not found' }, { status: 404 }),
    label: ROUTE,
  })
  if (!loaded.ok) return loaded.response

  const body = await req.json().catch(() => null)
  const actor = await actorFromAuth()
  const result = await staffDecide(db, {
    agreementId: id,
    changeId,
    decision: body?.decision,
    memberId: actor.actorMemberId ?? null,
    label: actor.actorLabel ?? 'Stellr staff',
  })
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
  return NextResponse.json({ ok: true, decision: result.decision })
}
