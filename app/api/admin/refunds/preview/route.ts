import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { currentTenantId, requireTenantStaff } from '@/lib/authz'
import { previewRefund } from '@/lib/refunds/preview'
import { withAudit } from '@/lib/audit/route'
import { tenantWideScope } from '@/lib/tenancy/scope-context'

const ROUTE = '/api/admin/refunds/preview'

// What this request acted on, which withAudit's spec cannot read for itself.
const audited = new WeakMap<Request, { id: string; userId: string | null; tenantId: string }>()

export const GET = withAudit(
  ({ args: [req] }: { args: [Request] }) => {
    const a = audited.get(req)
    return {
      action: 'refund.preview.read',
      actor: a ? { userId: a.userId } : { session: true },
      tenant: { tenantId: a?.tenantId ?? null },
      target: { table: 'participants', id: a?.id ?? null },
    }
  },
  preview,
)

// GET /api/admin/refunds/preview?participant=<id>
// Powers the refund choice in the delete dialog (cash/credit options, amounts).
async function preview(req: Request) {
  const admin = await requireTenantStaff(currentTenantId(), ['tenant_admin'], { route: ROUTE })
  if (!admin.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { userId } = await auth()

  const participant = new URL(req.url).searchParams.get('participant')
  if (!participant) return NextResponse.json({ error: 'participant is required' }, { status: 400 })
  audited.set(req, { id: participant, userId, tenantId: admin.tenantId })

  try {
    return NextResponse.json(await previewRefund(participant, tenantWideScope(admin.tenantId, 'tenant_admin')))
  } catch (e) {
    console.error('Refund preview error:', e)
    return NextResponse.json({ error: 'Preview failed' }, { status: 500 })
  }
}
