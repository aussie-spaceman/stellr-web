import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { getHostCaps } from '@/lib/sessions'
import { createCohort } from '@/lib/mentoring'
import { DEFAULT_TZ, type CohortTheme } from '@/lib/mentoring-format'

// POST /api/community/mentoring/cohorts — create a cohort + send invites.
// Available to platform admins and members holding the mentor role. A mentor
// becomes the cohort's mentor by default; an admin may name a different mentor.
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const caps = await getHostCaps(member.id)
  if (!member.isAdmin && !caps.canMentor) {
    return NextResponse.json({ error: 'Only mentors can create cohorts.' }, { status: 403 })
  }

  const b = await req.json().catch(() => ({}))
  const name = String(b?.name || '').trim()
  if (!name) return NextResponse.json({ error: 'Cohort name is required' }, { status: 400 })

  const mentorMemberId = member.isAdmin && b.mentorMemberId ? String(b.mentorMemberId) : member.id

  const cohortId = await createCohort({
    name,
    mentorMemberId,
    plannedSessions: Math.max(1, Math.min(52, Number(b.plannedSessions) || 6)),
    theme: (b.theme === 'enviro' ? 'enviro' : 'space') as CohortTheme,
    timezone: typeof b.timezone === 'string' ? b.timezone : DEFAULT_TZ,
    isOpen: !!b.isOpen,
    blurb: b.blurb ? String(b.blurb) : null,
    freeForTierIds: Array.isArray(b.freeForTierIds) ? b.freeForTierIds : [],
    oneOffPriceCents: b.oneOffPriceCents != null ? Math.max(0, Math.round(Number(b.oneOffPriceCents))) : null,
    creditCost: b.creditCost != null ? Math.max(0, Number(b.creditCost)) : 1,
    inviteMemberIds: Array.isArray(b.inviteMemberIds) ? b.inviteMemberIds : [],
    resources: Array.isArray(b.resources)
      ? b.resources.map((r: { moduleId: string; mandatory?: boolean; dueAt?: string | null }) => ({
          moduleId: String(r.moduleId),
          mandatory: !!r.mandatory,
          dueAt: r.dueAt ?? null,
        }))
      : [],
  })

  return NextResponse.json({ ok: true, cohortId })
}
