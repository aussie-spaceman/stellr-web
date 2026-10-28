import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireEventAccess } from '@/lib/event-access'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { isValidEmail, normalizeEmail } from '@/lib/member-enums'
import { reissueParticipantAgreement } from '@/lib/docusign-reissue'
import { maskEmail } from '@/lib/utils'

// POST /api/admin/events/[slug]/participants/[pid]/guardian — fix a student's
// parent/guardian email when their consent form could not be sent (a refused
// send, or never issued), then send it. Admins and the event's managers.
//   body: { email: string }
// Without this the only fix was the organiser editing their own team, or SQL:
// on 28 Oct 2026 two guardians entered as "none" and "…@gmailcom" left two
// students with no agreement and no way for staff to correct it.
//
// A form that is already out for signing is not touched here — "Correct email"
// fixes the address on that same envelope and keeps any signature.

const bodySchema = z.object({ email: z.string().trim().min(1, 'Enter an email address').max(320) })

const LIVE = new Set(['created', 'sent', 'delivered'])

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; pid: string }> }) {
  const { slug, pid } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }
  const email = normalizeEmail(parsed.data.email)
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "That email doesn't look right. Check it and try again." }, { status: 400 })
  }

  const db = supabaseServer()
  const { data: p } = await db
    .from('participants')
    .select('id, member_id, first_name, last_name, emergency_contact_email, registrations!inner(event_slug)')
    .eq('id', pid)
    .maybeSingle()
  const reg = p ? (Array.isArray(p.registrations) ? p.registrations[0] : p.registrations) as { event_slug: string } : null
  if (!p || reg?.event_slug !== slug) {
    return NextResponse.json({ error: 'Participant not found for this event' }, { status: 404 })
  }

  const { data: live } = await db
    .from('agreements')
    .select('id, status')
    .eq('participant_id', pid)
    .in('status', [...LIVE])
    .not('envelope_id', 'like', 'failed:%')
    .limit(1)
    .maybeSingle()
  if (live) {
    return NextResponse.json(
      { error: 'Their consent form is already out for signing. Use Correct email on it instead, which keeps any signature.' },
      { status: 409 },
    )
  }

  const previous = (p.emergency_contact_email as string | null) ?? null
  const { error: updateError } = await db.from('participants').update({ emergency_contact_email: email }).eq('id', pid)
  if (updateError) {
    console.error('[admin/guardian] participant update failed:', updateError)
    return NextResponse.json({ error: 'Could not save the email' }, { status: 500 })
  }
  // The member record carries the same contact for future events; fix it only
  // while it still holds the old (bad) value, never over a newer one.
  if (p.member_id) {
    const memberUpdate = db.from('members').update({ ec_email: email }).eq('id', p.member_id as string)
    await (previous ? memberUpdate.eq('ec_email', previous) : memberUpdate.is('ec_email', null))
  }

  const actor = await actorFromAuth()
  if (p.member_id) {
    await logActivity(
      {
        memberId: p.member_id as string,
        category: 'docusign',
        action: 'guardian_email_corrected',
        summary: `Parent/guardian email corrected for ${slug}: ${previous ? maskEmail(previous) : '(none)'} → ${maskEmail(email)}`,
        metadata: { participantId: pid, eventSlug: slug },
        ...actor,
      },
      db,
    )
  }

  let result
  try {
    result = await reissueParticipantAgreement(db, pid, { eventSlug: slug, allowNewEnvelope: true })
  } catch (err) {
    console.error('[admin/guardian] reissue failed:', err)
    return NextResponse.json({ saved: true, error: 'Email saved, but the form could not be sent. Try Reissue shortly.' }, { status: 502 })
  }
  if (result.kind === 'reissued' && result.outcome === 'failed') {
    return NextResponse.json(
      { saved: true, error: 'Email saved, but the signing service refused the form again. Check the student’s own email too.' },
      { status: 502 },
    )
  }
  const outcome = result.kind === 'reissued' ? result.outcome : result.kind
  return NextResponse.json({ saved: true, outcome })
}
