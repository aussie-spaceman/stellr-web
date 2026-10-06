import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { rateLimitGuard } from '@/lib/rate-limit'
import { invitationByToken } from '@/lib/survey/access'

// POST /api/survey/[token]/stop-reminders — stop survey reminders for this
// invitation. Target of the emails' List-Unsubscribe-Post one-click header
// (RFC 8058) and of the button on /survey/[token]/stop-reminders. Survey
// reminders only: marketing consent is untouched. GET does nothing, so link
// scanners that prefetch email links cannot opt anyone out.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const limited = rateLimitGuard(req, 'survey-stop', { limit: 30, windowMs: 60_000 })
  if (limited) return limited
  const db = supabaseServer()
  const inv = await invitationByToken(db, (await params).token)
  if (!inv) return NextResponse.json({ error: 'This link isn’t valid.' }, { status: 404 })
  if (!inv.reminders_opted_out_at) {
    await db
      .from('survey_invitations')
      .update({ reminders_opted_out_at: new Date().toISOString(), ...(inv.status === 'queued' ? { status: 'opted_out' } : {}) })
      .eq('id', inv.id)
  }
  return NextResponse.json({ ok: true })
}
