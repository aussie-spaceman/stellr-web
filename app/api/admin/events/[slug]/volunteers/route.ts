import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import { getEventBySlug } from '@/lib/sanity'
import { ensureEventContainer } from '@/lib/container-sync'
import { getVolunteerStatuses } from '@/lib/volunteer'
import { logActivity, actorFromAuth } from '@/lib/activity-log'

// Event volunteer management (PRD §15). Volunteers raise interest from the
// member catalog (volunteer_event_interest); admins assign them here. An
// assignment is a cohort_members row with relationship='volunteer' on the
// event-level container (portal access) plus an event_participations row with
// role='volunteer' (member history). Compliance/agreement pills are advisory —
// assignment is warn-don't-block by design.

type Ctx = { params: Promise<{ slug: string }> }

async function eventContainerId(db: SupabaseClient, slug: string): Promise<string | null> {
  const { data } = await db
    .from('mentoring_cohorts')
    .select('id')
    .eq('container_type', 'event_participation')
    .is('parent_container_id', null)
    .eq('campaign_ref', slug)
    .maybeSingle()
  return (data?.id as string) ?? null
}

// GET — interested + assigned volunteers for this event, with advisory pills.
export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const db = supabaseServer()
  const containerId = await eventContainerId(db, slug)

  const [{ data: interestRows }, { data: assignedRows }] = await Promise.all([
    db
      .from('volunteer_event_interest')
      .select('member_id, created_at, members(id, first_name, last_name, email, date_of_birth)')
      .eq('event_slug', slug)
      .eq('status', 'interested')
      .order('created_at', { ascending: true }),
    containerId
      ? db
          .from('cohort_members')
          .select('member_id, added_at, members(id, first_name, last_name, email, date_of_birth)')
          .eq('cohort_id', containerId)
          .eq('relationship', 'volunteer')
          .eq('status', 'active')
          .order('added_at', { ascending: true })
      : Promise.resolve({ data: [] as never[] }),
  ])

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

// POST { memberId } — assign a volunteer to this event.
export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const { memberId } = await req.json().catch(() => ({}))
  if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })

  const db = supabaseServer()
  const event = await getEventBySlug(slug).catch(() => null)
  const title = (event as { title?: string } | null)?.title ?? null

  const containerId = await ensureEventContainer(db, slug, title)
  if (!containerId) return NextResponse.json({ error: 'Could not resolve event container' }, { status: 500 })

  const { error } = await db.from('cohort_members').upsert(
    { cohort_id: containerId, member_id: memberId, relationship: 'volunteer', status: 'active' },
    { onConflict: 'cohort_id,member_id', ignoreDuplicates: true },
  )
  if (error) {
    console.error('[admin/events/volunteers] assign error:', error)
    return NextResponse.json({ error: 'Could not assign volunteer' }, { status: 500 })
  }

  // History row (member's Volunteering list). If the member already has a
  // participation row for this event (e.g. they attended as a competitor), we
  // leave it untouched — the roster row above still carries the assignment.
  const { data: existing } = await db
    .from('event_participations')
    .select('id')
    .eq('member_id', memberId)
    .eq('event_slug', slug)
    .maybeSingle()
  if (!existing) {
    await db.from('event_participations').insert({
      member_id: memberId,
      event_slug: slug,
      event_title: title,
      event_year: new Date().getFullYear(),
      status: 'approved',
      role: 'volunteer',
    })
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

  return NextResponse.json({ ok: true })
}

// DELETE { memberId } — remove a volunteer assignment.
export async function DELETE(req: Request, { params }: Ctx) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const { memberId } = await req.json().catch(() => ({}))
  if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })

  const db = supabaseServer()
  const containerId = await eventContainerId(db, slug)
  if (containerId) {
    await db
      .from('cohort_members')
      .delete()
      .eq('cohort_id', containerId)
      .eq('member_id', memberId)
      .eq('relationship', 'volunteer')
  }
  // Only remove the history row this assignment created — never a competitor row.
  await db
    .from('event_participations')
    .delete()
    .eq('member_id', memberId)
    .eq('event_slug', slug)
    .eq('role', 'volunteer')

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
