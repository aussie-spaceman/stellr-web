import { NextResponse } from 'next/server'
import { communityWriteBlock } from '@/lib/community'
import { getOnboardedMember } from '@/lib/onboarded-member'
import { getHostCaps } from '@/lib/sessions'
import { createCohort } from '@/lib/mentoring'
import { DEFAULT_TZ, type CohortTheme } from '@/lib/mentoring-format'
import { assertNotImpersonating } from '@/lib/impersonation'
import { auditMutation } from '@/lib/audit/route'
import { noteAudit, selfServiceEvent, type SelfServiceAudit } from '@/lib/community/self-service-audit'

// POST /api/community/mentoring/cohorts — create a cohort + send invites.
// Available to platform admins and members holding the mentor role. A mentor
// becomes the cohort's mentor by default; an admin may name a different mentor.
export async function POST(req: Request) {
  return audited(req, { action: 'community.mentoring_cohort.create', table: 'mentoring_cohorts' }, () => createMentoringCohort(req))
}

async function createMentoringCohort(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getOnboardedMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  // Decision 24: age and guardian-consent restrictions (lib/community).
  const restricted = await communityWriteBlock(member, 'host')
  if (restricted) return restricted

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

  noteAudit(req, { targetId: cohortId })
  return NextResponse.json({ ok: true, cohortId })
}

// The audit event for this route (docs/TENANCY-S5.md, B16): written after the response,
// never for a 4xx, ids and short codes only. lib/community/self-service-audit decides
// what is written; the call stays here because the coverage gate reads it here.
async function audited(req: Request, spec: SelfServiceAudit, run: () => Promise<Response>): Promise<Response> {
  let res: Response | undefined
  try {
    return (res = await run())
  } finally {
    await record(req, res, spec)
  }
}

async function record(req: Request, res: Response | undefined, spec: SelfServiceAudit) {
  const event = await selfServiceEvent(req, res, spec)
  if (!event) return
  await auditMutation(event, { afterResponse: true })
}
