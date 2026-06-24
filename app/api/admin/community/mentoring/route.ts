import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { isAdminClaims } from '@/lib/admin-auth'
import { inviteMembersToCohort, resendCohortInvites } from '@/lib/sessions'
import { supabaseServer } from '@/lib/supabase'
import {
  grantMentorRole,
  reassignMentor,
  updateCohort,
  archiveCohort,
  deleteCohort,
  updateTierMentoring,
} from '@/lib/mentoring'
import type { CohortTheme } from '@/lib/mentoring-format'

// Admin actions for the Mentoring redesign that the legacy /api/admin/community/
// cohorts route doesn't cover: make-mentor (global), reassign mentor, cohort
// settings + access, and the Membership & access tier config.
async function requireAdmin() {
  const { sessionClaims } = await auth()
  return isAdminClaims(sessionClaims)
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))

  switch (b.action) {
    case 'makeMentor': {
      if (!b.memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })
      await grantMentorRole(b.memberId)
      return NextResponse.json({ ok: true })
    }
    case 'reassignMentor': {
      if (!b.cohortId || !b.newMentorId) return NextResponse.json({ error: 'cohortId and newMentorId required' }, { status: 400 })
      await reassignMentor(b.cohortId, b.newMentorId)
      return NextResponse.json({ ok: true })
    }
    case 'removeMember': {
      if (!b.cohortId || !b.memberId) return NextResponse.json({ error: 'cohortId and memberId required' }, { status: 400 })
      const db = supabaseServer()
      await db.from('cohort_members').delete().eq('cohort_id', b.cohortId).eq('member_id', b.memberId)
      return NextResponse.json({ ok: true })
    }
    case 'invite': {
      if (!b.cohortId || !Array.isArray(b.memberIds) || b.memberIds.length === 0) {
        return NextResponse.json({ error: 'cohortId and memberIds required' }, { status: 400 })
      }
      const n = await inviteMembersToCohort(b.cohortId, b.memberIds)
      return NextResponse.json({ ok: true, invited: n })
    }
    case 'resendInvites': {
      if (!b.cohortId) return NextResponse.json({ error: 'cohortId required' }, { status: 400 })
      const n = await resendCohortInvites(b.cohortId)
      return NextResponse.json({ ok: true, resent: n })
    }
    case 'updateCohort': {
      if (!b.cohortId) return NextResponse.json({ error: 'cohortId required' }, { status: 400 })
      await updateCohort(b.cohortId, {
        name: b.name,
        mentorMemberId: b.mentorMemberId,
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
      if (!b.cohortId) return NextResponse.json({ error: 'cohortId required' }, { status: 400 })
      await archiveCohort(b.cohortId)
      return NextResponse.json({ ok: true })
    }
    case 'delete': {
      if (!b.cohortId) return NextResponse.json({ error: 'cohortId required' }, { status: 400 })
      await deleteCohort(b.cohortId)
      return NextResponse.json({ ok: true })
    }
    case 'updateTier': {
      if (!b.tierId) return NextResponse.json({ error: 'tierId required' }, { status: 400 })
      await updateTierMentoring(b.tierId, {
        includesFreeMentoring: b.includesFreeMentoring,
        creditsGrant: b.creditsGrant,
        workshopCreditsGrant: b.workshopCreditsGrant,
      })
      return NextResponse.json({ ok: true })
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}
