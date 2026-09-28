import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { dispatchVolunteerAgreement, VOLUNTEER_PROGRAM_TITLE } from '@/lib/volunteer'

// Admin (re-)issue of the Volunteer Agreement (PRD §15: "issue the Volunteer
// DocuSign to new Volunteers"). Signup normally dispatches it automatically;
// this covers members made volunteers by admin toggle and re-issues after a
// decline/void. force=true bypasses the in-flight guard but NOT the 3-year
// on-file reuse — a member with a valid signed agreement gets coverage, not a
// duplicate envelope.

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const db = supabaseServer()
  const { data: member } = await db
    .from('members')
    .select('id, first_name, last_name, email, phone, date_of_birth')
    .eq('id', id)
    .maybeSingle()
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (!member.email) return NextResponse.json({ error: 'Member has no email on file' }, { status: 400 })

  const agreement = await dispatchVolunteerAgreement(db, member, { force: true })

  // Report what actually happened. This route used to answer 200 and log
  // "issued" unconditionally — on 28 Sept 2026 two production issues were
  // rejected by DocuSign (ACCOUNT_LACKS_EXTENSIONS_PERMISSIONS), the admin saw
  // no error, and the activity log recorded agreements that were never sent.
  if (agreement === 'failed') {
    return NextResponse.json(
      { error: 'DocuSign rejected the request, so nothing was sent. The reason is in the server log.', agreement },
      { status: 502 },
    )
  }
  if (agreement === 'not_required') {
    return NextResponse.json({ error: 'No agreement applies to this member.', agreement }, { status: 422 })
  }

  if (agreement === 'issued' || agreement === 'on_file') {
    const actor = await actorFromAuth()
    await logActivity({
      memberId: id,
      category: 'docusign',
      action: agreement === 'issued' ? 'volunteer_agreement_issued' : 'volunteer_agreement_on_file',
      summary: agreement === 'issued'
        ? `Volunteer Agreement issued for ${VOLUNTEER_PROGRAM_TITLE}`
        : `Volunteer Agreement already on file for ${VOLUNTEER_PROGRAM_TITLE}; nothing new sent`,
      ...actor,
    }, db)
  }

  return NextResponse.json({ ok: true, agreement })
}
