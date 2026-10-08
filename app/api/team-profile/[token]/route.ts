import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { rateLimitGuard } from '@/lib/rate-limit'
import { saveAnswers, sessionByToken } from '@/lib/team-profile/store'

// POST /api/team-profile/[token] — submit (or update) a team profile.
// Works signed out: the emailed link is the key. Answers are validated and
// normalised server-side (lib/team-profile/questions.ts).
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const limited = rateLimitGuard(req, 'team-profile', { limit: 30, windowMs: 60_000 })
  if (limited) return limited

  const { token } = await params
  const db = supabaseServer()
  const session = await sessionByToken(db, token)
  if (!session) return NextResponse.json({ error: 'This link isn’t valid.' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const result = await saveAnswers(db, session, body?.answers)
  if (!result.ok) return NextResponse.json({ error: result.error, missing: result.missing }, { status: result.status })
  return NextResponse.json({ ok: true })
}
