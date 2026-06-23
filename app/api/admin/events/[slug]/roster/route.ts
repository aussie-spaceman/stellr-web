import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import { getEventBySlug } from '@/lib/sanity'
import { ensureEventContainer } from '@/lib/container-sync'

// Admin direct-grant for competition access (convergence P3). Manage the members
// an admin/event-manager has granted access to an event OUTSIDE the normal
// registration flow — they land on the event-level container roster, which the
// member event portal resolves through (lib/event-portal.ts). Registration-derived
// members live on per-registration group sub-containers and aren't touched here.

type Ctx = { params: Promise<{ slug: string }> }

async function eventContainerId(slug: string): Promise<string | null> {
  const db = supabaseServer()
  const { data } = await db
    .from('mentoring_cohorts')
    .select('id')
    .eq('container_type', 'event_participation')
    .is('parent_container_id', null)
    .eq('campaign_ref', slug)
    .maybeSingle()
  return (data?.id as string) ?? null
}

// GET — members granted access directly (the event-level container roster).
export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const containerId = await eventContainerId(slug)
  if (!containerId) return NextResponse.json({ members: [] })

  const db = supabaseServer()
  const { data } = await db
    .from('cohort_members')
    .select('member_id, added_at, members(first_name, last_name, email)')
    .eq('cohort_id', containerId)
    .eq('status', 'active')
    .order('added_at', { ascending: false })

  const members = (data ?? []).map((r) => {
    const m = Array.isArray(r.members) ? r.members[0] : r.members
    return {
      id: r.member_id as string,
      first_name: (m as { first_name?: string } | null)?.first_name ?? null,
      last_name: (m as { last_name?: string } | null)?.last_name ?? null,
      email: (m as { email?: string } | null)?.email ?? null,
      added_at: r.added_at as string,
    }
  })
  return NextResponse.json({ members })
}

// POST { memberId } — grant a member direct access to this event.
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
    { cohort_id: containerId, member_id: memberId, relationship: 'participant', status: 'active' },
    { onConflict: 'cohort_id,member_id', ignoreDuplicates: true },
  )
  if (error) {
    console.error('[admin/events/roster] add error:', error)
    return NextResponse.json({ error: 'Could not grant access' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

// DELETE { memberId } — revoke a directly-granted member.
export async function DELETE(req: Request, { params }: Ctx) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const { memberId } = await req.json().catch(() => ({}))
  if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })

  const containerId = await eventContainerId(slug)
  if (!containerId) return NextResponse.json({ ok: true })

  const db = supabaseServer()
  const { error } = await db
    .from('cohort_members')
    .delete()
    .eq('cohort_id', containerId)
    .eq('member_id', memberId)
  if (error) {
    console.error('[admin/events/roster] remove error:', error)
    return NextResponse.json({ error: 'Could not revoke access' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
