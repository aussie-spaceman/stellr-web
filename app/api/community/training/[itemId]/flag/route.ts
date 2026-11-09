import { NextResponse } from 'next/server'
import { getOnboardedMember } from '@/lib/onboarded-member'
import { notifyCommunityAdmins } from '@/lib/notify'
import { supabaseServer } from '@/lib/supabase'
import { assertNotImpersonating } from '@/lib/impersonation'
import { escapeHtml } from '@/lib/email-layout'
import { auditMutation } from '@/lib/audit/route'
import { noteAudit, selfServiceEvent, type SelfServiceAudit } from '@/lib/community/self-service-audit'

// A member reports that a training lesson's resource is unavailable/broken
// (e.g. no link provided, or a placeholder like "TBC"). Routes an in-app +
// email alert to community admins so they can fix or replace it.
export async function POST(req: Request, ctx: { params: Promise<{ itemId: string }> }) {
  return audited(req, { action: 'community.training_item.flag', table: 'training_items' }, () => flagTrainingItem(req, ctx))
}

async function flagTrainingItem(
  req: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const { itemId } = await params
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getOnboardedMember()
  if (!member) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const db = supabaseServer()
  const { data: item } = await db
    .from('training_items')
    .select('id, title, module_id, training_modules(title)')
    .eq('id', itemId)
    .maybeSingle()
  if (!item) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 })
  noteAudit(req, { targetId: itemId })

  const moduleTitle = (item.training_modules as { title?: string } | null)?.title ?? 'a course'
  const memberName = [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email || 'A member'
  const lessonTitle = (item.title as string) ?? 'a lesson'

  await notifyCommunityAdmins({
    type: 'action',
    body: `${memberName} reported an unavailable resource in "${lessonTitle}" (${moduleTitle}).`,
    referenceType: 'training_item',
    referenceId: itemId,
    actorMemberId: member.id,
    email: {
      subject: `Training resource flagged: ${lessonTitle}`,
      // deep review INTPUB-N1: this caller builds its own email.html, so notify
      // does not escape it — the member's display name (student-settable) and
      // the lesson/module titles must be escaped here, or markup in them renders
      // in the admin's inbox (spoofed links/layout in trusted first-party mail).
      html: `<p><strong>${escapeHtml(memberName)}</strong> reported that the resource for the lesson <strong>${escapeHtml(lessonTitle)}</strong> in <strong>${escapeHtml(moduleTitle)}</strong> is unavailable.</p><p>Review it in Admin → Academy → Training.</p>`,
      text: `${memberName} reported that the resource for "${lessonTitle}" in "${moduleTitle}" is unavailable. Review it in Admin → Academy → Training.`,
    },
  })

  return NextResponse.json({ ok: true })
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
