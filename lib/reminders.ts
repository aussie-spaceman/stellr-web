import { supabaseServer } from '@/lib/supabase'

export interface Reminder {
  sessionId: string
  title: string
  scheduledStart: string
  bucket: '1day' | '1week'
}

export async function getUpcomingReminders(memberId: string): Promise<Reminder[]> {
  const db = supabaseServer()
  const now = new Date()
  const inOneDay = new Date(now.getTime() + 24 * 60 * 60_000)
  const inOneWeek = new Date(now.getTime() + 7 * 24 * 60 * 60_000)

  const { data } = await db
    .from('session_participants')
    .select('sessions!inner(id, title, scheduled_start, status)')
    .eq('member_id', memberId)

  type Row = { sessions: { id: string; title: string | null; scheduled_start: string; status: string } | { id: string; title: string | null; scheduled_start: string; status: string }[] }
  const rows = ((data ?? []) as unknown as Row[])
    .map((r) => (Array.isArray(r.sessions) ? r.sessions[0] : r.sessions))
    .filter((s) => s && s.status === 'scheduled')

  const reminders: Reminder[] = []
  for (const s of rows) {
    if (!s) continue
    const start = new Date(s.scheduled_start)
    if (start <= now || start > inOneWeek) continue
    const bucket: '1day' | '1week' = start <= inOneDay ? '1day' : '1week'
    reminders.push({
      sessionId: s.id,
      title: s.title ?? 'Session',
      scheduledStart: s.scheduled_start,
      bucket,
    })
  }
  return reminders.sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime())
}
