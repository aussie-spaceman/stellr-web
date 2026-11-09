import { NextResponse } from 'next/server'
import { isStellrAdmin } from '@/lib/authz'
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
import { CommunityDeleteBlockedError } from '@/lib/community-delete-guard'
import { bodyIds, withAudit } from '@/lib/audit/route'

// What this request acted on, which withAudit's spec cannot read for itself: the body has gone.
const auditedTarget = new WeakMap<Request, { table: string; id: string | null }>()
const auditedOp = new WeakMap<Request, string>()
const auditedDetail = new WeakMap<Request, Record<string, unknown>>()

// The audit log keeps a lower-case code and redacts a camelCase word, so each operation
// has its stored name here. A Map, because the key comes from the request body.
const OP_CODES = new Map<unknown, string>([
  ['makeMentor', 'make_mentor'],
  ['reassignMentor', 'reassign_mentor'],
  ['removeMember', 'remove_member'],
  ['invite', 'invite'],
  ['resendInvites', 'resend_invites'],
  ['updateCohort', 'update_cohort'],
  ['archive', 'archive'],
  ['delete', 'delete'],
  ['updateTier', 'update_tier'],
])

function cohortTarget(b: { action?: unknown; memberId?: string; tierId?: string; cohortId?: string }) {
  if (b.action === 'makeMentor') return { table: 'members', id: b.memberId ?? null }
  if (b.action === 'updateTier') return { table: 'membership_tiers', id: b.tierId ?? null }
  return { table: 'mentoring_cohorts', id: b.cohortId ?? null }
}

export const POST = withAudit(
  ({ args: [req] }) => ({
    action: 'community.cohort.manage',
    actor: { session: true },
    tenant: { stellr: true },
    target: auditedTarget.get(req) ?? { table: 'mentoring_cohorts', id: null },
    metadata: { op: auditedOp.get(req) ?? null, ...auditedDetail.get(req) },
  }),
  manageCohort,
)

// Admin actions for the Mentoring redesign that the legacy /api/admin/community/
// cohorts route doesn't cover: make-mentor (global), reassign mentor, cohort
// settings + access, and the Membership & access tier config.
async function manageCohort(req: Request) {
  if (!(await isStellrAdmin({ route: '/api/admin/community/mentoring' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const op = OP_CODES.get(b.action)
  if (op) auditedOp.set(req, op)
  auditedTarget.set(req, cohortTarget(b))
  auditedDetail.set(req, {
    ...bodyIds(b, ['memberId', 'newMentorId', 'mentorMemberId']),
    ...(Array.isArray(b.memberIds) ? { recipients: b.memberIds.length } : {}),
  })

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
      // deep review DB-4: deleteCohort blocks the delete when it would cascade
      // away the cohort's chat history — surface that as a 409 steering to Archive.
      try {
        await deleteCohort(b.cohortId)
      } catch (e) {
        if (e instanceof CommunityDeleteBlockedError) {
          return NextResponse.json(
            { error: 'This cohort has chat history. Archive it instead to preserve the record.', blockers: e.blockers },
            { status: 409 },
          )
        }
        throw e
      }
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
