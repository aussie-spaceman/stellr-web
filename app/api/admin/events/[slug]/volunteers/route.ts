import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventRoute } from '@/lib/authz'
import { getEventBySlug } from '@/lib/events/repo'
import { assignEventVolunteer, eventContainerId, loadEventVolunteers, removeEventVolunteer, stellrOnlyDb } from '@/lib/events/admin-records'
import { ensureEventContainer } from '@/lib/container-sync'
import { getVolunteerStatuses, grantVolunteerRole, dispatchVolunteerAgreement, VOLUNTEER_MEMBER_COLUMNS } from '@/lib/volunteer'
import { logActivity, actorFromAuth } from '@/lib/activity-log'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { syncObjectSpaceRoster } from '@/lib/space-inheritance'
import { removeEventParticipation } from '@/lib/event-participation-sync'
import { refuseOutsideStellr } from '@/lib/tenancy/load-scoped'

// Event volunteer management (PRD §15). Volunteers raise interest from the
// member catalog (volunteer_event_interest); admins assign them here. An
// assignment is a cohort_members row with relationship='volunteer' on the
// event-level container (portal access) plus an event_participations row with
// role='volunteer' (member history). Compliance/agreement pills are advisory —
// assignment is warn-don't-block by design. Assignment does issue the Volunteer
// Agreement (the mentor document) when none is signed or in flight, so nobody
// reaches event day unpapered because an admin forgot to send it.
//
// All of this is Stellr's: shared members, its community Spaces and mentoring containers,
// its signing accounts. A tenant's staff are refused.

const ROUTE = '/api/admin/events/[slug]/volunteers'

type Ctx = { params: Promise<{ slug: string }> }

// GET — interested + assigned volunteers for this event, with advisory pills.
export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params
  const staff = await requireEventRoute(slug, { route: ROUTE })
  if (!staff.ok) return staff.response
  const refused = refuseOutsideStellr(staff.scope)
  if (refused) return refused

  const db = stellrOnlyDb(staff.scope, supabaseServer())
  const containerId = await eventContainerId(db, slug)
  const { interestRows, assignedRows } = await loadEventVolunteers(db, slug, containerId)

  type MemberJoin = { id: string; first_name: string | null; last_name: string | null; email: string | null; date_of_birth: string | null }
  const unwrap = (m: unknown): MemberJoin | null => (Array.isArray(m) ? (m[0] as MemberJoin) : (m as MemberJoin)) ?? null

  const assignedIds = new Set((assignedRows ?? []).map((r) => r.member_id as string))
  const interested = (interestRows ?? [])
    .map((r) => ({ memberId: r.member_id as string, since: r.created_at as string, member: unwrap(r.members) }))
    .filter((r) => r.member && !assignedIds.has(r.memberId))
  const assigned = (assignedRows ?? [])
    .map((r) => ({ memberId: r.member_id as string, since: r.added_at as string, member: unwrap(r.members) }))
    .filter((r) => r.member)

  const allMembers = [...interested, ...assigned].map((r) => r.member as MemberJoin)
  const pills = await getVolunteerStatuses(db, allMembers)

  const shape = (r: { memberId: string; since: string; member: MemberJoin | null }) => ({
    memberId: r.memberId,
    firstName: r.member?.first_name ?? null,
    lastName: r.member?.last_name ?? null,
    email: r.member?.email ?? null,
    since: r.since,
    ...pills[r.memberId],
  })

  return NextResponse.json({
    interested: interested.map(shape),
    assigned: assigned.map(shape),
  })
}

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event_volunteer.assignment.create', ...auditSubject(req, 'members') }),
  assignVolunteer,
)

// POST { memberId } — assign a volunteer to this event.
async function assignVolunteer(req: Request, { params }: Ctx) {
  const { slug } = await params
  const staff = await requireEventRoute(slug, { route: ROUTE })
  if (!staff.ok) return staff.response
  noteAuditSubject(req, { userId: staff.userId, tenantId: staff.tenantId, eventSlug: slug })
  const refused = refuseOutsideStellr(staff.scope)
  if (refused) return refused

  const { memberId } = await req.json().catch(() => ({}))
  if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })
  noteAuditSubject(req, { id: typeof memberId === 'string' ? memberId : null })

  const db = stellrOnlyDb(staff.scope, supabaseServer())
  const event = await getEventBySlug(slug).catch(() => null)
  const title = (event as { title?: string } | null)?.title ?? null

  const containerId = await ensureEventContainer(db, slug, title)
  if (!containerId) return NextResponse.json({ error: 'Could not resolve event container' }, { status: 500 })

  const { error } = await assignEventVolunteer(db, { containerId, memberId, slug, title })
  if (error) {
    console.error('[admin/events/volunteers] assign error:', error)
    return NextResponse.json({ error: 'Could not assign volunteer' }, { status: 500 })
  }

  const actor = await actorFromAuth()
  await logActivity({
    memberId,
    category: 'event',
    action: 'volunteer_assigned',
    summary: `Assigned as a volunteer for ${title ?? slug}`,
    metadata: { eventSlug: slug, eventTitle: title },
    ...actor,
  }, db)

  // Volunteer program: grant the additive 'volunteer' role (idempotent — this also
  // rosters them into the global Volunteer Space) and inherit any Spaces linked to
  // this event (Access Convergence).
  await grantVolunteerRole(db, memberId, actor, 'admin')
  await syncObjectSpaceRoster(db, 'event', slug, memberId)

  // Paperwork. Idempotent: a signed agreement under 3 years old is linked, not
  // re-sent, and one already out is left alone. Non-fatal — a DocuSign failure
  // alerts admins inside dispatchAgreement and the assignment still stands.
  const { data: member } = await db
    .from('members')
    .select(VOLUNTEER_MEMBER_COLUMNS)
    .eq('id', memberId)
    .maybeSingle()
  const agreement = member ? await dispatchVolunteerAgreement(db, member) : 'no_email'
  if (agreement === 'issued') {
    await logActivity({
      memberId,
      category: 'docusign',
      action: 'volunteer_agreement_issued',
      summary: `Volunteer Agreement issued on assignment to ${title ?? slug}`,
      metadata: { eventSlug: slug },
      ...actor,
    }, db)
  }

  return NextResponse.json({ ok: true, agreement })
}

export const DELETE = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event_volunteer.assignment.delete', ...auditSubject(req, 'members') }),
  unassignVolunteer,
)

// DELETE { memberId } — remove a volunteer assignment.
async function unassignVolunteer(req: Request, { params }: Ctx) {
  const { slug } = await params
  const staff = await requireEventRoute(slug, { route: ROUTE })
  if (!staff.ok) return staff.response
  noteAuditSubject(req, { userId: staff.userId, tenantId: staff.tenantId, eventSlug: slug })
  const refused = refuseOutsideStellr(staff.scope)
  if (refused) return refused

  const { memberId } = await req.json().catch(() => ({}))
  if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })
  noteAuditSubject(req, { id: typeof memberId === 'string' ? memberId : null })

  const db = stellrOnlyDb(staff.scope, supabaseServer())
  const containerId = await eventContainerId(db, slug)
  await removeEventVolunteer(db, { containerId, memberId, slug })

  // deep review BG-5: the volunteer-assignment POST above also inherited every
  // Space linked to this event (syncObjectSpaceRoster) and granted the Volunteer
  // role, so deleting only the cohort/participation rows left the removed (often
  // uncleared) volunteer inside the event's community Space/chat — which may be
  // full of minors — and reconcileEventSpaceRoster would re-grant it from the
  // active cohort roster on the next registration. Tear down the inherited Space
  // membership too, mirroring the participant-DELETE and hard-delete paths. The
  // helper no-ops for anyone still entitled by another active (non-withdrawn)
  // registration on this event (e.g. a volunteer who is also a competitor), so
  // this never strips access they hold by another route. Fails closed on a read
  // error (deep review QUALTEST-N1): an unassign that cannot confirm the teardown
  // surfaces an error for retry rather than silently leaving them in the Space.
  await removeEventParticipation(db, { memberId, eventSlug: slug })

  const event = await getEventBySlug(slug).catch(() => null)
  const title = (event as { title?: string } | null)?.title ?? null
  const actor = await actorFromAuth()
  await logActivity({
    memberId,
    category: 'event',
    action: 'volunteer_unassigned',
    summary: `Removed as a volunteer for ${title ?? slug}`,
    metadata: { eventSlug: slug, eventTitle: title },
    ...actor,
  }, db)

  return NextResponse.json({ ok: true })
}
