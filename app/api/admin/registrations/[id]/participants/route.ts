import { NextResponse } from 'next/server'
import { requireEventCrew } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { addParticipantToGroup, GROUP_FOR_ADD_COLUMNS, type GroupForAdd } from '@/lib/group-participant-add'
import { withAudit } from '@/lib/audit/route'
import { loadEventRecord } from '@/lib/tenancy/load-scoped'
import { rowTenant } from '@/lib/registration/event-context'

// A roster change waits out the group invoice quiet period after responding
// (lib/group-billing.ts), and that wait has to fit inside the function.
export const maxDuration = 300

const ROUTE = '/api/admin/registrations/[id]/participants'

const notFound = () => NextResponse.json({ error: 'Group registration not found' }, { status: 404 })

// What this request acted on, which withAudit's spec cannot read for itself. Who was added
// stays out of the event: they may be a minor, and the row can never be erased.
const audited = new WeakMap<Request, { id: string; userId: string; tenantId: string; eventSlug: string | null }>()

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, { params: Promise<{ id: string }> }] }) => {
    const a = audited.get(req)
    return {
      action: 'registration.participant.crew_add',
      actor: a ? { userId: a.userId } : { session: true },
      tenant: { tenantId: a?.tenantId ?? null },
      target: { table: 'registrations', id: a?.id ?? null },
      metadata: { eventSlug: a?.eventSlug ?? null },
    }
  },
  addParticipant,
)

// POST /api/admin/registrations/[id]/participants — staff add a person to a
// group's roster from the admin event roster (4 Nov 2026). Admins, and the
// event's managers for their own events: the same rule as the roster's other
// group actions (Finish setup, Invoice). The add itself is the organiser's,
// shared through lib/group-participant-add.ts, so billing, the consent form,
// the school link and the payment link behave exactly as on the Teams page.
async function addParticipant(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const crew = await requireEventCrew({ route: ROUTE })
  if (!crew.ok) return NextResponse.json({ error: 'Forbidden' }, { status: crew.status })

  const { id } = await params
  const db = supabaseServer()
  const loaded = await loadEventRecord<GroupForAdd & { type: string | null; event_slug: string; event_title?: string | null }>(crew, 'registrations', id, {
    db,
    select: `type, ${GROUP_FOR_ADD_COLUMNS}`,
    notFound,
    label: ROUTE,
  })
  if (!loaded.ok) return loaded.response
  const reg = loaded.row
  if (reg.type !== 'group') return notFound()
  // S5 A8: a tenant's staff add to their own tenant's group. The shared add then takes
  // that tenant's path (lib/group-participant-add.ts): the tenant's age rules, no Member
  // ID lookup, no member row, event history or activity log entry, and the tenant
  // payments answer, before any Stripe call, for a group that takes money. A group
  // stamped with any other tenant answers as missing, in every LOADSCOPED_MODE, Stellr's
  // staff included (as the payment-method route does).
  if (rowTenant(reg.tenant_id) !== crew.tenantId) return notFound()
  audited.set(req, { id, userId: crew.userId, tenantId: crew.tenantId, eventSlug: reg.event_slug })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const actor = await actorFromAuth()
  const result = await addParticipantToGroup(db, reg, body as Record<string, unknown>, {
    memberId: actor.actorMemberId ?? null,
    label: 'admin',
  })

  if (result.status === 201 && result.memberId) {
    await logActivity({
      memberId: result.memberId,
      actorType: crew.isAdmin ? 'admin' : 'member',
      actorMemberId: actor.actorMemberId ?? null,
      actorLabel: actor.actorLabel ?? null,
      category: 'event',
      action: 'roster_added_by_crew',
      summary: `Added to a group for ${reg.event_title ?? reg.event_slug} by the Stellr team`,
      metadata: { registrationId: id, eventSlug: reg.event_slug },
    })
  }

  return NextResponse.json(result.body, { status: result.status })
}
