import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { currentTenantId, requireTenantStaff } from '@/lib/authz'
import { remindEnvelopeRow } from '@/lib/esign/operations'
import { withAudit } from '@/lib/audit/route'
import { loadRecord, scopedRowWrite } from '@/lib/tenancy/load-scoped'
import { tenantWideScope } from '@/lib/tenancy/scope-context'

const ROUTE = '/api/admin/docusigns/[id]/resend'

// What this request acted on, which withAudit's spec cannot read for itself.
const audited = new WeakMap<Request, { id: string; userId: string | null; tenantId: string }>()

export const POST = withAudit(
  ({ args: [req] }: { args: [NextRequest, { params: Promise<{ id: string }> }] }) => {
    const a = audited.get(req)
    return {
      action: 'agreement.reminder.send',
      actor: a ? { userId: a.userId } : { session: true },
      tenant: { tenantId: a?.tenantId ?? null },
      target: { table: 'agreements', id: a?.id ?? null },
    }
  },
  resendEnvelope,
)

type Envelope = Parameters<typeof remindEnvelopeRow>[1] & { status: string | null; reused_from: string | null }

// POST /api/admin/docusigns/[id]/resend — admin can resend any envelope at any time
async function resendEnvelope(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireTenantStaff(currentTenantId(), ['tenant_admin'], { route: ROUTE })
  if (!admin.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { userId } = await auth()

  const { id } = await params
  audited.set(req, { id, userId, tenantId: admin.tenantId })
  const db = supabaseServer()
  const scope = tenantWideScope(admin.tenantId, 'tenant_admin')

  const loaded = await loadRecord<Envelope>(scope, 'agreements', id, {
    db,
    select: 'envelope_id, provider, status, reused_from',
    notFound: () => NextResponse.json({ error: 'Not found' }, { status: 404 }),
    label: ROUTE,
  })
  if (!loaded.ok) return loaded.response
  const envelope = loaded.row
  if (envelope.reused_from) {
    return NextResponse.json({ error: 'Covered by an agreement already on record — nothing to resend' }, { status: 400 })
  }
  if (envelope.status === 'completed') {
    return NextResponse.json({ error: 'Envelope already completed' }, { status: 400 })
  }
  if (envelope.status === 'voided') {
    return NextResponse.json({ error: 'Envelope has been voided' }, { status: 400 })
  }

  await remindEnvelopeRow(db, envelope)

  // Records the manual resend WITHOUT touching reminder_sent_at. Writing that
  // column here used to permanently remove the envelope from the reminder cron,
  // which filtered on `reminder_sent_at IS NULL` — so an admin helpfully
  // pressing "Resend" silently switched off all future automated chasing for
  // that family (4 Sept 2026).
  const now = new Date().toISOString()
  await scopedRowWrite(scope, 'agreements', id, { db }).update({ last_manual_resend_at: now, updated_at: now })

  return NextResponse.json({ ok: true })
}
