import { NextResponse } from 'next/server'
import { requireEventAccess } from '@/lib/event-access'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { addParticipantToGroup, GROUP_FOR_ADD_COLUMNS, type GroupForAdd } from '@/lib/group-participant-add'

// POST /api/admin/registrations/[id]/participants — staff add a person to a
// group's roster from the admin event roster (4 Nov 2026). Admins, and the
// event's managers for their own events: the same rule as the roster's other
// group actions (Finish setup, Invoice). The add itself is the organiser's,
// shared through lib/group-participant-add.ts, so billing, the consent form,
// the school link and the payment link behave exactly as on the Teams page.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireEventAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const { id } = await params
  const db = supabaseServer()
  const { data: reg } = await db
    .from('registrations')
    .select(`type, ${GROUP_FOR_ADD_COLUMNS}`)
    .eq('id', id)
    .maybeSingle()
  if (!reg || reg.type !== 'group') return NextResponse.json({ error: 'Group registration not found' }, { status: 404 })
  if (!access.isAdmin && !(access.assignedSlugs ?? []).includes(reg.event_slug as string)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const actor = await actorFromAuth()
  const result = await addParticipantToGroup(db, reg as unknown as GroupForAdd, body as Record<string, unknown>, {
    memberId: actor.actorMemberId ?? null,
    label: 'admin',
  })

  if (result.status === 201 && result.memberId) {
    await logActivity({
      memberId: result.memberId,
      actorType: access.isAdmin ? 'admin' : 'member',
      actorMemberId: actor.actorMemberId ?? null,
      actorLabel: actor.actorLabel ?? null,
      category: 'event',
      action: 'roster_added_by_staff',
      summary: `Added to a group for ${reg.event_title ?? reg.event_slug} by staff`,
      metadata: { registrationId: id, eventSlug: reg.event_slug },
    })
  }

  return NextResponse.json(result.body, { status: result.status })
}
