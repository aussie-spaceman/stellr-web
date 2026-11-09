import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { currentTenantId, requireTenantStaff } from '@/lib/authz'
import { logActivity } from '@/lib/activity-log'
import { applyGuardianOptOut } from '@/lib/credentials-notify'
import { withAudit } from '@/lib/audit/route'
import { enforcedTenantFilter, loadRecord, scopedRowWrite } from '@/lib/tenancy/load-scoped'
import { isStellrScope, tenantWideScope } from '@/lib/tenancy/scope-context'

const ROUTE = '/api/admin/docusigns/[id]/credential-sharing'

// What this request acted on, which withAudit's spec cannot read for itself.
const audited = new WeakMap<Request, { id: string; userId: string | null; tenantId: string; optOut: boolean; unpublished?: number }>()

export const POST = withAudit(
  ({ args: [req] }: { args: [NextRequest, { params: Promise<{ id: string }> }] }) => {
    const a = audited.get(req)
    return {
      action: 'agreement.credential_sharing.set',
      actor: a ? { userId: a.userId } : { session: true },
      tenant: { tenantId: a?.tenantId ?? null },
      target: { table: 'agreements', id: a?.id ?? null },
      metadata: { optOut: a?.optOut ?? null, unpublished: a?.unpublished ?? null },
    }
  },
  setCredentialSharing,
)

type Agreement = { id: string; envelope_type: string | null; status: string | null; reused_from: string | null; member_id: string | null; participant_id: string | null; minor_name: string | null }

// POST /api/admin/docusigns/[id]/credential-sharing  { optOut: boolean }
// Records that a guardian opted the minor OUT of public credential pages
// (D1, 21 Sept 2026: the consent form reads as opt-in unless noted). Until the
// form itself can carry the opt-out, this is how a guardian's email saying
// "no" is honoured. Coverage rows defer to the envelope they reuse, so the
// flag is only settable on the original.
//
// Opting out makes any page that is already public private and emails the
// family (guardian, student Cc'd) — see applyGuardianOptOut.
async function setCredentialSharing(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireTenantStaff(currentTenantId(), ['tenant_admin'], { route: ROUTE })
  if (!admin.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { userId } = await auth()

  const body = (await req.json().catch(() => ({}))) as { optOut?: unknown }
  if (typeof body.optOut !== 'boolean') return NextResponse.json({ error: 'optOut must be a boolean' }, { status: 400 })

  const { id } = await params
  const event: { id: string; userId: string | null; tenantId: string; optOut: boolean; unpublished?: number } = { id, userId, tenantId: admin.tenantId, optOut: body.optOut }
  audited.set(req, event)
  const db = supabaseServer()
  const scope = tenantWideScope(admin.tenantId, 'tenant_admin')
  const loaded = await loadRecord<Agreement>(scope, 'agreements', id, {
    db,
    select: 'id, envelope_type, status, reused_from, member_id, participant_id, minor_name',
    notFound: () => NextResponse.json({ error: 'Not found' }, { status: 404 }),
    label: ROUTE,
  })
  if (!loaded.ok) return loaded.response
  const env = loaded.row
  if ((env.envelope_type ?? 'minor') !== 'minor') return NextResponse.json({ error: 'Only parental consent forms carry a sharing opt-out' }, { status: 400 })
  if (env.reused_from) return NextResponse.json({ error: 'Set this on the original consent form, not the coverage record' }, { status: 400 })

  const { error } = await scopedRowWrite(scope, 'agreements', id, { db }).update({ credential_sharing_opt_out: body.optOut, updated_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: (error as { message: string }).message }, { status: 500 })

  // The member timeline only exists when the envelope is linked to a member. It is global,
  // and a tenant's records stay off it (owner decision B8).
  if (env.member_id && isStellrScope(scope)) {
    await logActivity({
      memberId: env.member_id,
      category: 'docusign',
      actorType: 'admin',
      actorLabel: userId ?? null,
      action: body.optOut ? 'credential_sharing_opt_out' : 'credential_sharing_opt_in',
      summary: body.optOut
        ? 'Guardian opted out of public credential pages'
        : 'Guardian opt-out of public credential pages removed',
      metadata: { envelopeId: id },
    })
  }

  // Withdrawn consent takes public pages down (decided 23 Sept 2026, reversing
  // the original "leave them up" rule): the privacy policy and the consent form
  // both promise a guardian can withdraw consent, so the name has to come off
  // the open web. The family is emailed which pages changed.
  const unpublished = body.optOut
    ? await applyGuardianOptOut(db, { memberId: env.member_id, participantId: env.participant_id, tenant: enforcedTenantFilter(scope, 'credentials') })
    : 0
  event.unpublished = unpublished

  return NextResponse.json({ ok: true, optOut: body.optOut, unpublished })
}
