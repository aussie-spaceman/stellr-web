import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import { getEventBySlug } from '@/lib/sanity'
import { generateBadgesPdf, type Artwork, type BadgePerson } from '@/lib/event-pdf'
import { RESOURCES_BUCKET } from '@/lib/community'

export const dynamic = 'force-dynamic'

const ROLE_LABELS: Record<string, string> = {
  school_student: 'Student',
  school_student_manager: 'Student Manager',
  teacher: 'Teacher',
  mentor: 'Mentor',
  parent: 'Parent',
}

// GET /api/admin/events/[slug]/badges — bulk 3x4" badge PDF for ALL participants.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const db = supabaseServer()
  const event = await getEventBySlug(slug)
  const eventTitle = (event as { title?: string } | null)?.title ?? slug

  const [{ data: regs }, { data: settings }] = await Promise.all([
    db
      .from('registrations')
      .select('id, participants(first_name, last_name, event_role, event_companies(number, name))')
      .eq('event_slug', slug)
      .neq('status', 'withdrawn'),
    db.from('event_settings').select('badge_artwork_path').eq('event_slug', slug).maybeSingle(),
  ])

  const people: BadgePerson[] = (regs ?? [])
    .flatMap((r) => (r.participants as Record<string, unknown>[]) ?? [])
    .sort((a, b) =>
      `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`)
    )
    .map((p) => {
      const company = p.event_companies as { number: number; name: string | null } | null
      const role = ROLE_LABELS[p.event_role as string] ?? 'Participant'
      return {
        firstName: (p.first_name as string) ?? '',
        lastName: (p.last_name as string) ?? '',
        subtitle: company ? (company.name ?? `Company ${company.number}`) : role,
      }
    })

  if (people.length === 0) {
    return NextResponse.json({ error: 'No participants to generate badges for' }, { status: 400 })
  }

  let artwork: Artwork | null = null
  if (settings?.badge_artwork_path) {
    const { data: blob } = await db.storage.from(RESOURCES_BUCKET).download(settings.badge_artwork_path)
    if (blob) {
      artwork = {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        mime: settings.badge_artwork_path.endsWith('.png') ? 'image/png' : 'image/jpeg',
      }
    }
  }

  const pdf = await generateBadgesPdf(people, eventTitle, artwork)
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${slug}-badges.pdf"`,
    },
  })
}
