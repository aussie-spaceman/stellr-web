import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import { getEventBySlug } from '@/lib/sanity'
import { generateBadgesPdf } from '@/lib/event-pdf'
import { DEFAULT_BADGE_FORMAT, isBadgeFormat } from '@/lib/badge-layout'
import { loadBadgeHolders, loadBadgeTemplates, resolveBadges } from '@/lib/event-badges'

export const dynamic = 'force-dynamic'

// GET /api/admin/events/[slug]/badges?format=avery_5392|avery_8395 — one badge
// per registered participant and per assigned volunteer mentor, on the chosen
// Avery sheet. Each badge uses its company's template, else the mentors' (for
// mentors), else everyone's, else a plain badge (lib/event-badges.ts).
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const requested = new URL(req.url).searchParams.get('format')
  const format = isBadgeFormat(requested) ? requested : DEFAULT_BADGE_FORMAT

  const db = supabaseServer()
  const [event, holders, templates] = await Promise.all([
    getEventBySlug(slug),
    loadBadgeHolders(db, slug),
    loadBadgeTemplates(db, slug, format),
  ])
  if (holders.length === 0) {
    return NextResponse.json({ error: 'No participants to generate badges for' }, { status: 400 })
  }
  const eventTitle = (event as { title?: string } | null)?.title ?? slug

  const pdf = await generateBadgesPdf(await resolveBadges(db, holders, templates), eventTitle, format)
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${slug}-badges-${format.replace('_', '-')}.pdf"`,
    },
  })
}
