import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import { getEventBySlug } from '@/lib/sanity'
import { getBackgroundProvider } from '@/lib/background-provider'
import { actorFromAuth } from '@/lib/activity-log'
import {
  buildMentorReportPdf,
  classifyMentors,
  exportModeFor,
  fileSlug,
  loadEventMentors,
  logReportExport,
  type ExportMode,
} from '@/lib/background-report-export'

export const dynamic = 'force-dynamic'
// Each Checkr report is two calls (report + signed download); a large event
// runs to tens of seconds even four at a time.
export const maxDuration = 60

// GET /api/admin/events/[slug]/background-reports[?participant=<id>|?member=<id>][&mode=summary]
// Every mentor at the event, as one PDF. Admins get a cover page plus each
// cleared mentor's Checkr report, or the clearance summary with ?mode=summary
// (the version they can share with an event team). Event managers always get
// the summary (see lib/background-report-export.ts for why). `participant` (a
// roster row) or `member` (an assigned volunteer) narrows it to one mentor;
// for an admin in checkr mode that is Checkr's PDF on its own.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const search = new URL(req.url).searchParams
  const participantId = search.get('participant')
  const memberId = search.get('member')
  const single = !!(participantId || memberId)
  const mode: ExportMode = exportModeFor(access.isAdmin, search.get('mode'))

  const db = supabaseServer()
  const [event, allMentors] = await Promise.all([getEventBySlug(slug), loadEventMentors(db, slug)])
  const mentors = allMentors.filter(
    (m) => (!participantId || m.participantId === participantId) && (!memberId || m.memberId === memberId),
  )
  if (mentors.length === 0) {
    return single
      ? NextResponse.json({ error: 'That person is not a mentor at this event' }, { status: 404 })
      : NextResponse.json({ error: 'No mentors at this event yet' }, { status: 400 })
  }

  const e = event as { title?: string; date?: string } | null
  const eventTitle = e?.title ?? slug
  const rows = await classifyMentors(db, mentors, e?.date)

  const provider = getBackgroundProvider()
  if (mode === 'checkr' && rows.some((r) => r.outcome === 'included') && !provider.configured()) {
    return NextResponse.json({ error: `Background-check provider (${provider.name}) is not configured` }, { status: 503 })
  }

  const actor = await actorFromAuth()
  const one = mentors[0]
  const title = single
    ? `Background clearance: ${one.firstName} ${one.lastName}, ${eventTitle}`
    : `Mentor background checks: ${eventTitle}`
  const { pdf, rows: out } = await buildMentorReportPdf({
    rows,
    mode,
    provider,
    title,
    generatedBy: actor.actorLabel ?? null,
    bareSingle: single,
  })
  await logReportExport(db, out, { mode, eventSlug: slug, scope: single ? 'mentor' : 'event', actor })

  const kind = mode === 'checkr' ? 'background-reports' : 'clearance-summary'
  const who = single ? `-${fileSlug(`${one.lastName} ${one.firstName}`)}` : '-mentor'
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileSlug(slug)}${who}-${kind}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
