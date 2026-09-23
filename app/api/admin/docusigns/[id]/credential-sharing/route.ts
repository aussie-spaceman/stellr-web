import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { logActivity } from '@/lib/activity-log'
import { applyGuardianOptOut } from '@/lib/credentials-notify'

// POST /api/admin/docusigns/[id]/credential-sharing  { optOut: boolean }
// Records that a guardian opted the minor OUT of public credential pages
// (D1, 21 Sept 2026: the consent form reads as opt-in unless noted). Until the
// form itself can carry the opt-out, this is how a guardian's email saying
// "no" is honoured. Coverage rows defer to the envelope they reuse, so the
// flag is only settable on the original.
//
// Opting out makes any page that is already public private and emails the
// family (guardian, student Cc'd) — see applyGuardianOptOut.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims, userId } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as { optOut?: unknown }
  if (typeof body.optOut !== 'boolean') return NextResponse.json({ error: 'optOut must be a boolean' }, { status: 400 })

  const { id } = await params
  const db = supabaseServer()
  const { data: env } = await db
    .from('docusign_envelopes')
    .select('id, envelope_type, status, reused_from, member_id, participant_id, minor_name')
    .eq('id', id)
    .maybeSingle()
  if (!env) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if ((env.envelope_type ?? 'minor') !== 'minor') return NextResponse.json({ error: 'Only parental consent forms carry a sharing opt-out' }, { status: 400 })
  if (env.reused_from) return NextResponse.json({ error: 'Set this on the original consent form, not the coverage record' }, { status: 400 })

  const { error } = await db
    .from('docusign_envelopes')
    .update({ credential_sharing_opt_out: body.optOut, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // The member timeline only exists when the envelope is linked to a member.
  if (env.member_id) {
    await logActivity({
      memberId: env.member_id,
      category: 'docusign',
      actorType: 'admin',
      actorLabel: userId ?? null,
      action: body.optOut ? 'credential_sharing_opt_out' : 'credential_sharing_opt_in',
      summary: body.optOut
        ? 'Guardian opted out of public credential pages'
        : 'Guardian opt-out of public credential pages removed',
      metadata: { envelopeId: id },
    })
  }

  // Withdrawn consent takes public pages down (decided 23 Sept 2026, reversing
  // the original "leave them up" rule): the privacy policy and the consent form
  // both promise a guardian can withdraw consent, so the name has to come off
  // the open web. The family is emailed which pages changed.
  const unpublished = body.optOut
    ? await applyGuardianOptOut(db, { memberId: env.member_id, participantId: env.participant_id })
    : 0

  return NextResponse.json({ ok: true, optOut: body.optOut, unpublished })
}
