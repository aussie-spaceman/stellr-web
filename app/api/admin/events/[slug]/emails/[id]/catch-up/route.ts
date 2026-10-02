import { NextResponse } from 'next/server'
import { requireEventAccess } from '@/lib/event-access'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth } from '@/lib/activity-log'
import { getEventEmail } from '@/lib/event-emails/store'
import { catchUpStatus, sendCatchUp } from '@/lib/event-emails/catch-up'

export const maxDuration = 60

// /api/admin/events/[slug]/emails/[id]/catch-up — late registrants on a sent
// All-participants email (lib/event-emails/catch-up.ts).
//   GET  → { eligible, open, audiences, pending: [{ email, name, roles }] }
//   POST → send it to them now (the cron does the same three times a day)

type Ctx = { params: Promise<{ slug: string; id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  const { slug, id } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const db = supabaseServer()
  const email = await getEventEmail(db, slug, id)
  if (!email) return NextResponse.json({ error: 'Email not found' }, { status: 404 })
  try {
    return NextResponse.json(await catchUpStatus(db, email))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not check' }, { status: 500 })
  }
}

export async function POST(_req: Request, { params }: Ctx) {
  const { slug, id } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const db = supabaseServer()
  // Scope check before handing the id to the engine, which does not know the URL.
  if (!(await getEventEmail(db, slug, id))) return NextResponse.json({ error: 'Email not found' }, { status: 404 })

  const actor = await actorFromAuth()
  const out = await sendCatchUp(db, id, { triggeredBy: actor.actorLabel ?? access.userId })
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json(out)
}
