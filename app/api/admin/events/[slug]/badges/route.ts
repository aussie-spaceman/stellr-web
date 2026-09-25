import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import { getEventBySlug } from '@/lib/sanity'
import { generateBadgesPdf, type BadgeArtwork, type BadgePerson } from '@/lib/event-pdf'
import { BADGE_FORMATS, DEFAULT_BADGE_FORMAT, isBadgeFormat } from '@/lib/badge-layout'
import { prepareBadgeArtwork } from '@/lib/badge-artwork'
import { RESOURCES_BUCKET } from '@/lib/community'

export const dynamic = 'force-dynamic'

const ROLE_LABELS: Record<string, string> = {
  participant: 'Student',
  school_student_manager: 'Student Manager',
  teacher: 'Teacher',
  mentor: 'Mentor',
  parent: 'Parent',
}

type Named = { first_name: string | null; last_name: string | null }

// GET /api/admin/events/[slug]/badges?format=avery_5392|avery_8395 — one badge
// per registered participant and per assigned volunteer mentor, on the chosen
// Avery sheet, over that format's background artwork.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const requested = new URL(req.url).searchParams.get('format')
  const format = isBadgeFormat(requested) ? requested : DEFAULT_BADGE_FORMAT
  const spec = BADGE_FORMATS[format]

  const db = supabaseServer()
  const event = await getEventBySlug(slug)
  const eventTitle = (event as { title?: string } | null)?.title ?? slug

  const [{ data: regs }, { data: settings }, { data: container }] = await Promise.all([
    db
      .from('registrations')
      .select('id, participants(member_id, first_name, last_name, event_role, event_companies(number, name))')
      .eq('event_slug', slug)
      .neq('status', 'withdrawn'),
    db.from('event_settings').select(spec.artworkColumn).eq('event_slug', slug).maybeSingle(),
    // Volunteer mentors are assigned to the event's container, not registered
    // (see ../volunteers), so they are not in participants.
    db
      .from('mentoring_cohorts')
      .select('id')
      .eq('container_type', 'event_participation')
      .is('parent_container_id', null)
      .eq('campaign_ref', slug)
      .maybeSingle(),
  ])

  const participants = (regs ?? []).flatMap((r) => (r.participants as Record<string, unknown>[]) ?? [])
  const people: (BadgePerson & { sortKey: string })[] = participants.map((p) => {
    const company = p.event_companies as { number: number; name: string | null } | null
    const role = ROLE_LABELS[p.event_role as string] ?? 'Participant'
    return {
      firstName: (p.first_name as string) ?? '',
      lastName: (p.last_name as string) ?? '',
      subtitle: company ? (company.name ?? `Company ${company.number}`) : role,
      sortKey: `${p.last_name} ${p.first_name}`,
    }
  })

  if (container?.id) {
    const { data: volunteers } = await db
      .from('cohort_members')
      .select('member_id, members(first_name, last_name)')
      .eq('cohort_id', container.id)
      .eq('relationship', 'volunteer')
      .eq('status', 'active')
    // A volunteer who also registered already has a badge.
    const registered = new Set(participants.map((p) => p.member_id).filter(Boolean))
    for (const v of volunteers ?? []) {
      if (registered.has(v.member_id)) continue
      const m = (Array.isArray(v.members) ? v.members[0] : v.members) as Named | null
      if (!m) continue
      people.push({
        firstName: m.first_name ?? '',
        lastName: m.last_name ?? '',
        subtitle: 'Mentor',
        sortKey: `${m.last_name} ${m.first_name}`,
      })
    }
  }

  if (people.length === 0) {
    return NextResponse.json({ error: 'No participants to generate badges for' }, { status: 400 })
  }
  people.sort((a, b) => a.sortKey.localeCompare(b.sortKey))

  let artwork: BadgeArtwork | null = null
  const artworkPath = (settings as Record<string, string | null> | null)?.[spec.artworkColumn]
  if (artworkPath) {
    const { data: blob } = await db.storage.from(RESOURCES_BUCKET).download(artworkPath)
    if (blob) {
      artwork = await prepareBadgeArtwork(
        {
          bytes: new Uint8Array(await blob.arrayBuffer()),
          mime: artworkPath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
        },
        format,
      )
    }
  }

  const pdf = await generateBadgesPdf(people, eventTitle, format, artwork)
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${slug}-badges-${format.replace('_', '-')}.pdf"`,
    },
  })
}
