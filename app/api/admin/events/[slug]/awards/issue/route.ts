import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import { getEventBySlug } from '@/lib/sanity'
import { themeFromType } from '@/lib/campaigns'
import { issueAwards } from '@/lib/event-award-issue'

export const dynamic = 'force-dynamic'

// POST — issue the judged awards: every assignment becomes a credential the
// student can see and download; anything taken away since the last run is
// revoked. Safe to press again after a correction.
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const event = await getEventBySlug(slug)
  const eventTitle = (event as { title?: string } | null)?.title ?? slug
  // Same theme rule as participation credentials: the badge ring follows it.
  const theme = themeFromType((event as { type?: string } | null)?.type) === 'enviro' ? 'environmental' : 'space'

  const result = await issueAwards(supabaseServer(), slug, { eventTitle, theme })
  return NextResponse.json({ ok: true, ...result })
}
