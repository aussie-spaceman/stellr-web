import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { isStellrAdmin } from '@/lib/authz'
import { actorFromAuth } from '@/lib/activity-log'
import { withAudit } from '@/lib/audit/route'
import { decideStaffEligibility, grantStaff, loadGrantHistory, loadStaffFacts, reconcileStaffGrant, revokeStaff } from '@/lib/staff'

export const dynamic = 'force-dynamic'

const ROUTE = '/api/admin/members/[id]/staff'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The Staff role on the admin member page (lib/staff.ts). Admin only, in every
// direction (roles:manage): Staff can't see or change anyone's Staff grant,
// including their own.
//
//   GET     → the live grant and history, and the prerequisite checklist
//   POST    {}                  grant: starts pending, sends the Staff agreement,
//                               activates once every prerequisite is met
//   PATCH   {}                  re-check now (after fixing a prerequisite)
//   DELETE  { reason }          revoke: access ends now

async function guard(params: Promise<{ id: string }>): Promise<{ id: string } | NextResponse> {
  // roles:manage is an admin-only capability (lib/authz/capabilities.ts).
  if (!(await isStellrAdmin({ route: ROUTE }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  return { id }
}

async function actor() {
  const [a, { userId }] = await Promise.all([actorFromAuth(), auth()])
  return { ...a, clerkUserId: userId ?? null }
}

type Ctx = { params: Promise<{ id: string }> }
type Audited = { args: [Request, Ctx] }
const memberIdFromUrl = (req: Request) => new URL(req.url).pathname.split('/').at(-2) ?? null
const grantAudit = ({ args: [req] }: Audited) => ({
  action: 'role.staff.grant' as const,
  actor: { session: true } as const,
  tenant: { stellr: true } as const,
  target: { table: 'members', id: memberIdFromUrl(req) },
})
const recheckAudit = ({ args: [req] }: Audited) => ({
  action: 'role.staff.recheck' as const,
  actor: { session: true } as const,
  tenant: { stellr: true } as const,
  target: { table: 'members', id: memberIdFromUrl(req) },
})
const revokeAudit = ({ args: [req] }: Audited) => ({
  action: 'role.staff.revoke' as const,
  actor: { session: true } as const,
  tenant: { stellr: true } as const,
  target: { table: 'members', id: memberIdFromUrl(req) },
})

export async function GET(_req: Request, { params }: Ctx) {
  const g = await guard(params)
  if (g instanceof NextResponse) return g
  const db = supabaseServer()
  const [history, facts] = await Promise.all([loadGrantHistory(db, g.id), loadStaffFacts(db, g.id)])
  return NextResponse.json({ grant: history.find((h) => ['pending', 'active', 'suspended'].includes(h.status)) ?? null, history, decision: decideStaffEligibility(facts) })
}

export const POST = withAudit(grantAudit, async (_req: Request, { params }: Ctx) => {
  const g = await guard(params)
  if (g instanceof NextResponse) return g
  const result = await grantStaff(supabaseServer(), { memberId: g.id, actor: await actor() })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result, { status: 201 })
})

export const PATCH = withAudit(recheckAudit, async (_req: Request, { params }: Ctx) => {
  const g = await guard(params)
  if (g instanceof NextResponse) return g
  const result = await reconcileStaffGrant(supabaseServer(), g.id, { reason: 'admin_recheck' })
  if (!result.grant) return NextResponse.json({ error: 'They have no Staff grant.' }, { status: 404 })
  return NextResponse.json(result)
})

const revokeSchema = z.object({ reason: z.string().trim().min(1, 'Say why Staff is being removed').max(500) })

export const DELETE = withAudit(revokeAudit, async (req: Request, { params }: Ctx) => {
  const g = await guard(params)
  if (g instanceof NextResponse) return g
  const parsed = revokeSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  const result = await revokeStaff(supabaseServer(), { memberId: g.id, reason: parsed.data.reason, actor: await actor() })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result)
})
