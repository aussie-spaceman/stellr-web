import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { getUpcomingReminders } from '@/lib/reminders'

export async function GET() {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const reminders = await getUpcomingReminders(member.id)
  return NextResponse.json({ reminders })
}
