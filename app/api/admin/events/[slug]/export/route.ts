import { NextResponse } from 'next/server'
import { requireEventAccess } from '@/lib/event-access'
import { getEventRoster } from '@/lib/event-admin'
import { toCsv } from '@/lib/csv'
import { supabaseServer } from '@/lib/supabase'
import { MEDIA_REASON_LABEL, mediaForParticipants } from '@/lib/survey/media'

// GET /api/admin/events/[slug]/export — roster CSV (admins + assigned event managers)
// media_ok: may Stellr use this person's photo/media (lib/survey/media.ts) —
// yes, no, or check (read the signed form); the reason is beside it.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const roster = await getEventRoster(slug)
  const media = await mediaForParticipants(supabaseServer(), roster.groups.flatMap((g) => g.participants.map((p) => p.id)))

  const header = [
    'Registration Type', 'Group', 'First Name', 'Last Name', 'Email', 'Role', 'School', 'Grade',
    'Gender', 'Date of Birth', 'Shirt Size', 'Dietary Requirements', 'Health Conditions',
    'Emergency Contact First Name', 'Emergency Contact Last Name', 'Emergency Contact Relationship',
    'Emergency Contact Email', 'Emergency Contact Phone',
    'Paid', 'Payment Status', 'DocuSign', 'DocuSign Status', 'Checked In At', 'media_ok', 'Media Note',
  ]
  const rows = roster.groups.flatMap((g) =>
    g.participants.map((p) => [
      g.type,
      g.groupLabel ?? '',
      p.first_name,
      p.last_name,
      p.email,
      p.event_role ?? '',
      p.school_name ?? '',
      p.grade ?? '',
      p.gender ?? '',
      p.date_of_birth ?? '',
      p.t_shirt_size ?? '',
      p.dietary_requirements.join('; '),
      p.health_conditions ?? '',
      p.emergency_contact_first_name ?? '',
      p.emergency_contact_last_name ?? '',
      p.emergency_contact_relationship ?? '',
      p.emergency_contact_email ?? '',
      p.emergency_contact_phone ?? '',
      p.paid ? 'yes' : 'no',
      p.payment_pill,
      p.docusign,
      p.docusign_pill,
      p.checked_in_at ?? '',
      media.get(p.id)?.status ?? 'check',
      MEDIA_REASON_LABEL[media.get(p.id)?.reason ?? 'form_unread'],
    ])
  )

  const csv = toCsv([header, ...rows])
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}-participants.csv"`,
    },
  })
}
