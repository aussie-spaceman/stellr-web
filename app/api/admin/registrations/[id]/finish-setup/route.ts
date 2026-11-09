import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireEventStaff } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { finishGroupSetup, previewGroupSetup, SETUP_STEPS, type SetupStep } from '@/lib/group-registration-setup'
import { withAudit } from '@/lib/audit/route'
import { loadEventRecord, refuseOutsideStellr } from '@/lib/tenancy/load-scoped'

// "Finish registration setup" for a group (admins + the event's managers).
//   GET  → { items: [{ step, needed, summary }] } — what is missing, nothing sent.
//   POST { steps: SetupStep[] } → { results: { [step]: outcome } }
// Each step checks what exists first, so a repeat run never double-invoices.
// See lib/group-registration-setup.ts.
export const maxDuration = 300

const ROUTE = '/api/admin/registrations/[id]/finish-setup'

const bodySchema = z.object({ steps: z.array(z.enum(SETUP_STEPS as [SetupStep, ...SetupStep[]])).min(1) })

type Db = ReturnType<typeof supabaseServer>

const notFound = () => NextResponse.json({ error: 'Group registration not found' }, { status: 404 })

async function guard(db: Db, id: string): Promise<{ slug: string; teacherMemberId: string | null; userId: string; tenantId: string } | Response> {
  const staff = await requireEventStaff({ route: ROUTE })
  if (!staff.ok) return NextResponse.json({ error: 'Forbidden' }, { status: staff.status })
  const loaded = await loadEventRecord<{ event_slug: string; type: string | null; teacher_member_id: string | null }>(staff, 'registrations', id, {
    db,
    select: 'event_slug, type, teacher_member_id',
    notFound,
    label: ROUTE,
  })
  if (!loaded.ok) return loaded.response
  if (loaded.row.type !== 'group') return notFound()
  // Both the preview and the run look for the group's invoice on Stellr's Stripe account.
  const refused = refuseOutsideStellr(staff.scope)
  if (refused) return refused
  return { slug: loaded.row.event_slug, teacherMemberId: loaded.row.teacher_member_id ?? null, userId: staff.userId, tenantId: staff.tenantId }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = supabaseServer()
  const g = await guard(db, id)
  if (g instanceof Response) return g
  const items = await previewGroupSetup(db, id)
  if (!items) return notFound()
  return NextResponse.json({ items })
}

// What this request acted on, which withAudit's spec cannot read for itself.
const audited = new WeakMap<Request, { id: string; userId: string; tenantId: string; eventSlug: string; steps?: readonly string[] }>()

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, { params: Promise<{ id: string }> }] }) => {
    const a = audited.get(req)
    return {
      action: 'registration.group_setup.finish',
      actor: a ? { userId: a.userId } : { session: true },
      tenant: { tenantId: a?.tenantId ?? null },
      target: { table: 'registrations', id: a?.id ?? null },
      metadata: { eventSlug: a?.eventSlug ?? null, steps: a?.steps ?? null },
    }
  },
  finishSetup,
)

async function finishSetup(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = supabaseServer()
  const g = await guard(db, id)
  if (g instanceof Response) return g
  const event: { id: string; userId: string; tenantId: string; eventSlug: string; steps?: readonly string[] } = { id, userId: g.userId, tenantId: g.tenantId, eventSlug: g.slug }
  audited.set(req, event)

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Choose at least one step' }, { status: 400 })
  event.steps = parsed.data.steps

  const results = await finishGroupSetup(db, id, parsed.data.steps)
  if (!results) return notFound()

  if (g.teacherMemberId) {
    const actor = await actorFromAuth()
    await logActivity(
      {
        memberId: g.teacherMemberId,
        category: 'event',
        action: 'group_setup_finished',
        summary: `Group registration setup finished for ${g.slug}: ${Object.entries(results).map(([k, v]) => `${k} ${v}`).join('; ')}`,
        metadata: { registrationId: id, eventSlug: g.slug, results },
        ...actor,
      },
      db,
    )
  }
  return NextResponse.json({ results })
}
