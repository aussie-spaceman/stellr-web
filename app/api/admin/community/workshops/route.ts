import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { isAdminClaims } from '@/lib/admin-auth'
import { createWorkshop, updateWorkshop, archiveWorkshop, deleteWorkshop } from '@/lib/workshops'
import { updatePlatformPricing } from '@/lib/pricing'
import type { CohortTheme } from '@/lib/mentoring-format'

// Admin CRUD for coaching workshops (mentoring_cohorts container_type='workshop')
// + the flat platform-pricing defaults.
async function requireAdmin() {
  const { sessionClaims } = await auth()
  return isAdminClaims(sessionClaims)
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))

  switch (b.action) {
    case 'create': {
      if (!b.name) return NextResponse.json({ error: 'name required' }, { status: 400 })
      const id = await createWorkshop({
        name: b.name,
        coachMemberId: b.coachMemberId ?? null,
        plannedSessions: Math.max(1, Math.floor(Number(b.plannedSessions) || 1)),
        theme: (b.theme as CohortTheme) ?? 'space',
        timezone: b.timezone ?? 'America/Chicago',
        isOpen: !!b.isOpen,
        blurb: b.blurb ?? null,
        freeForTierIds: Array.isArray(b.freeForTierIds) ? b.freeForTierIds : [],
        oneOffPriceCents: b.oneOffPriceCents ?? null,
        creditCost: Math.max(1, Math.floor(Number(b.creditCost) || 1)),
      })
      return NextResponse.json({ ok: true, id })
    }
    case 'update': {
      if (!b.workshopId) return NextResponse.json({ error: 'workshopId required' }, { status: 400 })
      await updateWorkshop(b.workshopId, {
        name: b.name,
        coachMemberId: b.coachMemberId,
        theme: b.theme as CohortTheme | undefined,
        timezone: b.timezone,
        isOpen: b.isOpen,
        blurb: b.blurb,
        freeForTierIds: b.freeForTierIds,
        oneOffPriceCents: b.oneOffPriceCents,
        creditCost: b.creditCost,
      })
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
    case 'updatePricing': {
      await updatePlatformPricing({
        cohortPriceCents: b.cohortPriceCents,
        workshopPriceCents: b.workshopPriceCents,
        cohortCreditPriceCents: b.cohortCreditPriceCents,
        workshopCreditPriceCents: b.workshopCreditPriceCents,
      })
      return NextResponse.json({ ok: true })
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}
