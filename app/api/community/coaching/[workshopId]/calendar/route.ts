import { getCurrentMember } from '@/lib/community'
import { listCohortSessions } from '@/lib/sessions'
import { getWorkshopSpace, getWorkshopFull } from '@/lib/coaching'
import { buildIcsCalendar, type IcsEvent } from '@/lib/ics'

// GET — "Sync all to Google Calendar": an .ics feed of every session in a
// coaching workshop. Gated to the coachee + coach.
export async function GET(_req: Request, { params }: { params: Promise<{ workshopId: string }> }) {
  const member = await getCurrentMember()
  if (!member) return new Response('Unauthorised', { status: 401 })
  const { workshopId } = await params

  const space = await getWorkshopSpace(member.id, workshopId)
  if (!space) return new Response('Not found', { status: 404 })

  const [full, sessions] = await Promise.all([getWorkshopFull(workshopId), listCohortSessions(workshopId)])
  const name = full?.name ?? 'Coaching'

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
        description: `Stellr coaching session — ${name}`,
        url: s.join_url ?? undefined,
      }
    })

  const ics = buildIcsCalendar(events, `${name} — Stellr Coaching`)
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-sessions.ics"`,
    },
  })
}
