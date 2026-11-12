import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireEventRoute } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { isValidEmail, normalizeEmail } from '@/lib/member-enums'
import { reissueParticipantAgreement } from '@/lib/docusign-reissue'
import { adoptOpenEnvelope } from '@/lib/docusign-agreements'
import { classifyAgreement } from '@/lib/docusign'
import { liveAgreementForParticipant, stellrOnlyDb } from '@/lib/events/admin-records'
import { saveGuardianEmail } from '@/lib/events/guardian-email'
import { maskEmail } from '@/lib/utils'
import { loadRecord, refuseOutsideStellr, refuseUnlessStellrEvent } from '@/lib/tenancy/load-scoped'

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
//
// This writes shared `members` and issues through Stellr's signing accounts: A11 opens it
// to a tenant.

const ROUTE = '/api/admin/events/[slug]/participants/[pid]/guardian'

const bodySchema = z.object({ email: z.string().trim().min(1, 'Enter an email address').max(320) })

const LIVE = ['created', 'sent', 'delivered']

type Ctx = { params: Promise<{ slug: string; pid: string }> }

type Participant = {
  id: string
  member_id: string | null
  first_name: string | null
  last_name: string | null
  emergency_contact_email: string | null
  event_role: string | null
  date_of_birth: string | null
  registrations: { event_slug: string; school_address_state: string | null } | { event_slug: string; school_address_state: string | null }[]
}

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'participant.guardian_email.correct', ...auditSubject(req, 'participants') }),
  correctGuardian,
)

async function correctGuardian(req: Request, { params }: Ctx) {
  const { slug, pid } = await params
  const staff = await requireEventRoute(slug, { route: ROUTE })
  if (!staff.ok) return staff.response
  noteAuditSubject(req, { userId: staff.userId, tenantId: staff.tenantId, eventSlug: slug, id: pid })
  const refused = refuseOutsideStellr(staff.scope)
  if (refused) return refused
  const foreign = await refuseUnlessStellrEvent(supabaseServer(), slug, ROUTE)
  if (foreign) return foreign

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }
  const email = normalizeEmail(parsed.data.email)
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "That email doesn't look right. Check it and try again." }, { status: 400 })
  }

  const db = supabaseServer()
  const notFound = () => NextResponse.json({ error: 'Participant not found for this event' }, { status: 404 })
  const loaded = await loadRecord<Participant>(staff.scope, 'participants', pid, {
    db,
    select: 'id, member_id, first_name, last_name, emergency_contact_email, event_role, date_of_birth, registrations!inner(event_slug, school_address_state)',
    notFound,
    label: ROUTE,
  })
  if (!loaded.ok) return loaded.response
  const p = loaded.row
  const reg = Array.isArray(p.registrations) ? p.registrations[0] : p.registrations
  if (reg?.event_slug !== slug) return notFound()

  // A live form left unlinked by a removal is this person's live form: link it, so
  // the check below sees it and no second envelope goes out.
  if (p.member_id && reg) {
    const type = classifyAgreement(p.event_role, p.date_of_birth, reg.school_address_state)
    if (type) await adoptOpenEnvelope(db, { participantId: pid, memberId: p.member_id, eventSlug: slug, type })
  }

  const live = await liveAgreementForParticipant(stellrOnlyDb(staff.scope, db), pid, LIVE)
  if (live) {
    return NextResponse.json(
      { error: 'Their consent form is already out for signing. Use Correct email on it instead, which keeps any signature.' },
      { status: 409 },
    )
  }

  const previous = p.emergency_contact_email ?? null
  // The address on file may already be right, and the form just never went out:
  // then there is nothing to correct, only a form to send.
  const changed = normalizeEmail(previous) !== email
  if (changed) {
    const { error: updateError } = await saveGuardianEmail(db, { participantId: pid, memberId: p.member_id, previous, email })
    if (updateError) {
      console.error('[admin/guardian] participant update failed:', updateError)
      return NextResponse.json({ error: 'Could not save the email' }, { status: 500 })
    }
  }

  const actor = await actorFromAuth()
  if (changed && p.member_id) {
    await logActivity(
      {
        memberId: p.member_id,
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
