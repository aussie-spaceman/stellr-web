import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import { resendOutstanding, resendTeamProfile } from '@/lib/team-profile/store'

export const maxDuration = 60

// Team profile sends from the roster (admins + assigned event managers).
//   POST { participantId }  — send (or re-send) one student's team profile
//   POST { all: true }      — send to every student who hasn't submitted yet
// Either way, only students whose permission form is complete get one.
type Params = { params: Promise<{ slug: string }> }

export async function POST(req: Request, { params }: Params) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = await req.json().catch(() => null)
  const db = supabaseServer()

  if (typeof body?.participantId === 'string') {
    const result = await resendTeamProfile(db, slug, body.participantId)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ ok: true })
  }

  if (body?.all === true) {
    try {
      const result = await resendOutstanding(db, slug)
      return NextResponse.json({ ok: true, ...result })
    } catch (err) {
      console.error('[team-profiles] bulk send failed:', err)
      return NextResponse.json({ error: 'Sending failed.' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'participantId or all required' }, { status: 400 })
}
