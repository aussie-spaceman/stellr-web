import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { communityWriteBlock } from '@/lib/community'
import { getOnboardedMember } from '@/lib/onboarded-member'
import { notifyMember } from '@/lib/notify'
import { assertNotImpersonating } from '@/lib/impersonation'
import { escapeHtml } from '@/lib/email-layout'
import { auditMutation } from '@/lib/audit/route'
import { noteAudit, selfServiceEvent, type SelfServiceAudit } from '@/lib/community/self-service-audit'

// POST /api/community/training/group-nudge
// Body: { memberIds: string[], objectRef: string, objectLabel?: string }
// A Teacher nudges students in their group to complete required training. Only
// students registered under THIS teacher (teacher_email) for the given Object can
// be nudged — the request is intersected with that set server-side.
export async function POST(req: Request) {
  return audited(req, { action: 'community.training.group_nudge' }, () => nudgeGroup(req))
}

async function nudgeGroup(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const teacher = await getOnboardedMember()
  if (!teacher) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  // Decision 24: age and guardian-consent restrictions (lib/community).
  const restricted = await communityWriteBlock(teacher, 'message')
  if (restricted) return restricted
  if (teacher.event_role !== 'teacher') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { memberIds, objectRef, objectLabel } = await req.json().catch(() => ({}))
  if (!Array.isArray(memberIds) || memberIds.length === 0 || !objectRef) {
    return NextResponse.json({ error: 'memberIds and objectRef required' }, { status: 400 })
  }

  const db = supabaseServer()
  // Registrations this teacher owns for the Object.
  const { data: regs } = await db
    .from('registrations')
    .select('id')
    .eq('event_slug', objectRef)
    .eq('teacher_email', teacher.email)
  const regIds = (regs ?? []).map((r) => r.id as string)
  if (regIds.length === 0) return NextResponse.json({ error: 'No group found' }, { status: 403 })

  // Students actually in the teacher's group.
  const { data: parts } = await db
    .from('participants')
    .select('member_id')
    .in('registration_id', regIds)
    .not('member_id', 'is', null)
  const allowed = new Set((parts ?? []).map((p) => p.member_id as string))
  const targets = (memberIds as string[]).filter((id) => allowed.has(id))
  if (targets.length === 0) return NextResponse.json({ error: 'No matching students' }, { status: 403 })

  const label = typeof objectLabel === 'string' && objectLabel ? objectLabel : 'your event'
  await Promise.all(
    targets.map((memberId) =>
      notifyMember(memberId, {
        type: 'session_reminder',
        body: `Reminder from your teacher: please complete your required training for ${label}.`,
        email: {
          // deep review INTPUB-N1: `label` is the teacher-supplied objectLabel
          // and this html is passed to notify pre-built, so escape it here —
          // otherwise a teacher can inject markup into their students' (minors')
          // inboxes.
          subject: 'Required training reminder',
          html: `<p>Hi,</p><p>This is a reminder from your teacher to complete your required training for <strong>${escapeHtml(label)}</strong>. Sign in to Stellr and head to Academy &rsaquo; Training.</p>`,
          text: `Reminder from your teacher: complete your required training for ${label}.`,
        },
      })
    )
  )

  noteAudit(req, { metadata: { nudged: targets.length } })
  return NextResponse.json({ nudged: targets.length })
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
