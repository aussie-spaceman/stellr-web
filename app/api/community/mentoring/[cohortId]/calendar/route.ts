import { getCurrentMember } from '@/lib/community'
import { getCohortSpace, listCohortSessions } from '@/lib/sessions'
import { getCohortFull } from '@/lib/mentoring'
import { buildIcsCalendar, type IcsEvent } from '@/lib/ics'

// GET — "Sync all to calendar": an .ics feed of every scheduled session in a
// cohort, importable into Google/Outlook/Apple. Gated to the roster + mentor.
export async function GET(_req: Request, { params }: { params: Promise<{ cohortId: string }> }) {
  const member = await getCurrentMember()
  if (!member) return new Response('Unauthorised', { status: 401 })
  const { cohortId } = await params

  const space = await getCohortSpace(member.id, cohortId)
  if (!space) return new Response('Not found', { status: 404 })

  const [full, sessions] = await Promise.all([getCohortFull(cohortId), listCohortSessions(cohortId)])
  const name = full?.name ?? 'Mentoring'

  const events: IcsEvent[] = sessions
    .filter((s) => s.status === 'scheduled' || s.status === 'completed')
    .map((s) => {
      const start = new Date(s.scheduled_start)
      const end = s.scheduled_end ? new Date(s.scheduled_end) : new Date(start.getTime() + 90 * 60_000)
      return {
        uid: `stellr-session-${s.id}@stellreducation.org`,
        title: s.title ?? `${name} session`,
        start,
        end,
        description: `Stellr mentoring session — ${name}`,
        url: s.join_url ?? undefined,
      }
    })

  const ics = buildIcsCalendar(events, `${name} — Stellr Mentoring`)
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-sessions.ics"`,
    },
  })
}
