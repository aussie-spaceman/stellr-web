import { NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { requireEventAccess } from '@/lib/event-access'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth } from '@/lib/activity-log'
import { getEventEmail } from '@/lib/event-emails/store'
import { sendEventEmail } from '@/lib/event-emails/send'

export const maxDuration = 60

// POST /api/admin/events/[slug]/emails/[id]/send — "Send now", or with
// { test: true } a single copy to the person pressing the button.

type Ctx = { params: Promise<{ slug: string; id: string }> }

export async function POST(req: Request, { params }: Ctx) {
  const { slug, id } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const db = supabaseServer()
  // Scope check before handing the id to the engine, which does not know the URL.
  if (!(await getEventEmail(db, slug, id))) return NextResponse.json({ error: 'Email not found' }, { status: 404 })

  const b = await req.json().catch(() => ({}))
  const test = b?.test === true
  const actor = await actorFromAuth()
  let testTo: string | undefined
  if (test) {
    const u = await currentUser().catch(() => null)
    testTo = u?.primaryEmailAddress?.emailAddress ?? u?.emailAddresses?.[0]?.emailAddress
  }

  const out = await sendEventEmail(db, id, {
    trigger: test ? 'test' : 'manual',
    triggeredBy: actor.actorLabel ?? access.userId,
    testTo,
  })
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json({ ...out, testTo: testTo ?? null })
}
