import { auth, currentUser } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { resolveRequest, resolveSchema } from '@/lib/privacy-requests'
import { withAudit } from '@/lib/audit/route'

// PATCH /api/admin/privacy-requests/:id — { status, note }: mark a confirmed
// privacy request in progress, completed, or refused (with the reason). The
// note is the record of how it was answered.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// What this request acted on, which withAudit's spec cannot read for itself. The note is
// free text, so it stays out of the event: the request's own row holds it.
const audited = new WeakMap<Request, { id: string; status: string; userId: string }>()

export const PATCH = withAudit(
  ({ args: [req] }: { args: [Request, { params: Promise<{ id: string }> }] }) => {
    const a = audited.get(req)
    return {
      action: 'privacy.request.resolve',
      actor: a ? { userId: a.userId } : { session: true },
      tenant: { stellr: true },
      target: { table: 'privacy_requests', id: a?.id ?? null },
      metadata: { resolution: a?.status ?? null },
    }
  },
  resolvePrivacyRequest,
)

async function resolvePrivacyRequest(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId, sessionClaims } = await auth()
  if (!userId || !isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = resolveSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  audited.set(req, { id, status: parsed.data.status, userId })
  const user = await currentUser().catch(() => null)
  const by = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || userId
  const ok = await resolveRequest(supabaseServer(), id, parsed.data, by)
  if (!ok) return NextResponse.json({ error: 'That request is not open (unconfirmed, or already answered).' }, { status: 409 })
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } })
}
