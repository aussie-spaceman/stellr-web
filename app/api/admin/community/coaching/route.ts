import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { isAdminClaims } from '@/lib/admin-auth'
import {
  createWorkshop,
  updateWorkshop,
  reassignCoach,
  replaceWorkshopMember,
  inviteWorkshopMember,
  removeWorkshopMember,
  archiveWorkshop,
  deleteWorkshop,
  updateTierCoaching,
} from '@/lib/coaching'

// Admin actions for Coaching workshops (1-on-1): create + invite, settings,
// coach reassignment, member invite/replace/remove, archive/delete, and the
// Membership & access coaching allowance config.
async function requireAdmin() {
  const { sessionClaims } = await auth()
  return isAdminClaims(sessionClaims)
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))

  switch (b.action) {
    case 'create': {
      if (!b.coachMemberId) return NextResponse.json({ error: 'A coach is required' }, { status: 400 })
      if (!b.memberId) return NextResponse.json({ error: 'A member is required' }, { status: 400 })
      const workshopId = await createWorkshop({
        coachMemberId: b.coachMemberId,
        memberId: b.memberId,
        name: b.name ?? null,
        plannedSessions: Number(b.plannedSessions) || 6,
        timezone: b.timezone || 'America/Chicago',
        freeForTierIds: Array.isArray(b.freeForTierIds) ? b.freeForTierIds : [],
        oneOffPriceCents: b.oneOffPriceCents ?? null,
        resources: Array.isArray(b.resources) ? b.resources : [],
      })
      return NextResponse.json({ ok: true, workshopId })
    }
    case 'updateWorkshop': {
      if (!b.workshopId) return NextResponse.json({ error: 'workshopId required' }, { status: 400 })
      await updateWorkshop(b.workshopId, {
        name: b.name,
        coachMemberId: b.coachMemberId,
        timezone: b.timezone,
        freeForTierIds: b.freeForTierIds,
        oneOffPriceCents: b.oneOffPriceCents,
      })
      return NextResponse.json({ ok: true })
    }
    case 'reassignCoach': {
      if (!b.workshopId || !b.newCoachId) return NextResponse.json({ error: 'workshopId and newCoachId required' }, { status: 400 })
      await reassignCoach(b.workshopId, b.newCoachId)
      return NextResponse.json({ ok: true })
    }
    case 'setMember': {
      // Invite or replace the single coachee (single-select; joins on accept).
      if (!b.workshopId || !b.memberId) return NextResponse.json({ error: 'workshopId and memberId required' }, { status: 400 })
      await replaceWorkshopMember(b.workshopId, b.memberId)
      return NextResponse.json({ ok: true })
    }
    case 'inviteMember': {
      if (!b.workshopId || !b.memberId) return NextResponse.json({ error: 'workshopId and memberId required' }, { status: 400 })
      await inviteWorkshopMember(b.workshopId, b.memberId)
      return NextResponse.json({ ok: true })
    }
    case 'removeMember': {
      if (!b.workshopId || !b.memberId) return NextResponse.json({ error: 'workshopId and memberId required' }, { status: 400 })
      await removeWorkshopMember(b.workshopId, b.memberId)
      return NextResponse.json({ ok: true })
    }
    case 'archive': {
      if (!b.workshopId) return NextResponse.json({ error: 'workshopId required' }, { status: 400 })
      await archiveWorkshop(b.workshopId)
      return NextResponse.json({ ok: true })
    }
    case 'delete': {
      if (!b.workshopId) return NextResponse.json({ error: 'workshopId required' }, { status: 400 })
      await deleteWorkshop(b.workshopId)
      return NextResponse.json({ ok: true })
    }
    case 'updateTier': {
      if (!b.tierId) return NextResponse.json({ error: 'tierId required' }, { status: 400 })
      await updateTierCoaching(b.tierId, Number(b.freeSessions) || 0)
      return NextResponse.json({ ok: true })
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}
