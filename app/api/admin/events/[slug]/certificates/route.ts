import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import { getEventBySlug } from '@/lib/sanity'
import { generateCertificatesPdf, type Artwork } from '@/lib/event-pdf'
import { RESOURCES_BUCKET } from '@/lib/community'
import { STUDENT_ROLES } from '@/lib/membership-rules'

export const dynamic = 'force-dynamic'

// GET /api/admin/events/[slug]/certificates?format=us_letter|a4
// Participation certificates for all students at the event.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const formatParam = new URL(req.url).searchParams.get('format')
  const format = formatParam === 'a4' ? 'a4' : 'us_letter'

  const db = supabaseServer()
  const event = await getEventBySlug(slug)
  const eventTitle = (event as { title?: string } | null)?.title ?? slug

  const [{ data: regs }, { data: settings }] = await Promise.all([
    db
      .from('registrations')
      .select('id, participants(first_name, last_name, event_role)')
      .eq('event_slug', slug)
      .neq('status', 'withdrawn'),
    db.from('event_settings').select('certificate_artwork_path').eq('event_slug', slug).maybeSingle(),
  ])

  const students = (regs ?? [])
    .flatMap((r) => (r.participants as Record<string, unknown>[]) ?? [])
    // Student Managers are students too — include them in participation certs.
    .filter((p) => STUDENT_ROLES.includes(p.event_role as string))
    .sort((a, b) =>
      `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`)
    )
    .map((p) => ({
      firstName: (p.first_name as string) ?? '',
      lastName: (p.last_name as string) ?? '',
    }))

  if (students.length === 0) {
    return NextResponse.json({ error: 'No students to generate certificates for' }, { status: 400 })
  }

  let artwork: Artwork | null = null
  if (settings?.certificate_artwork_path) {
    const { data: blob } = await db.storage
      .from(RESOURCES_BUCKET)
      .download(settings.certificate_artwork_path)
    if (blob) {
      artwork = {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        mime: settings.certificate_artwork_path.endsWith('.png') ? 'image/png' : 'image/jpeg',
      }
    }
  }

  // Remember the chosen format for next time
  await db.from('event_settings').upsert({ event_slug: slug, certificate_format: format }, { onConflict: 'event_slug' })

  const pdf = await generateCertificatesPdf(students, eventTitle, format, artwork)
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${slug}-certificates-${format}.pdf"`,
    },
  })
}
