import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { getBackgroundProvider, ReportPdfUnavailableError } from '@/lib/background-provider'
import { actorFromAuth } from '@/lib/activity-log'
import { loadComplianceRecordsForMembers } from '@/lib/compliance'
import { classifyMentor, fileSlug, logReportExport } from '@/lib/background-report-export'

export const dynamic = 'force-dynamic'

// GET /api/admin/members/[id]/background-check/report
// The member's Checkr PDF report, fetched from Checkr now (never stored).
// Admins only: it is a consumer report under the FCRA. Only a cleared check
// (passed, or adjudicated cleared, and unexpired) has a report to hand out.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const db = supabaseServer()
  const [{ data: member }, { byId }] = await Promise.all([
    db.from('members').select('id, first_name, last_name, email').eq('id', id).maybeSingle(),
    loadComplianceRecordsForMembers(db, [id], []),
  ])
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const row = classifyMentor(
    { participantId: null, memberId: id, firstName: member.first_name ?? '', lastName: member.last_name ?? '', email: member.email },
    byId.get(id),
  )
  if (row.outcome !== 'included' || !row.reportRef) {
    return NextResponse.json({ error: 'This member has no cleared background check with a Checkr report' }, { status: 404 })
  }

  const provider = getBackgroundProvider()
  if (!provider.configured()) {
    return NextResponse.json({ error: `Background-check provider (${provider.name}) is not configured` }, { status: 503 })
  }

  let pdf: Uint8Array
  try {
    pdf = await provider.fetchReportPdf(row.reportRef)
  } catch (err) {
    if (err instanceof ReportPdfUnavailableError) {
      return NextResponse.json({ error: 'Checkr has no PDF for this report yet' }, { status: 404 })
    }
    console.error('[admin] background report fetch failed:', err)
    return NextResponse.json({ error: 'Could not fetch the report from Checkr. Try again shortly.' }, { status: 502 })
  }

  await logReportExport(db, [row], { mode: 'checkr', eventSlug: null, scope: 'mentor', actor: await actorFromAuth() })

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileSlug(`${member.last_name ?? ''} ${member.first_name ?? ''}`)}-checkr-report.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
