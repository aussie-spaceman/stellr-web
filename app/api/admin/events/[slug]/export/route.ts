import { NextResponse } from 'next/server'
import { requireEventRoute } from '@/lib/authz'
import { getEventRoster } from '@/lib/event-admin'
import { toCsv } from '@/lib/csv'
import { displayGrade } from '@/lib/member-enums'
import { supabaseServer } from '@/lib/supabase'
import { MEDIA_REASON_LABEL, mediaForParticipants } from '@/lib/survey/media'
import { enforcedTenantFilter } from '@/lib/tenancy/load-scoped'
import { isStellrScope } from '@/lib/tenancy/scope-context'

// GET /api/admin/events/[slug]/export — roster CSV (admins + assigned event managers)
// media_ok: may Stellr use this person's photo/media (lib/survey/media.ts) —
// yes, no, or check (read the signed form); the reason is beside it.
//
// That answer rests on shared member settings and on forms signed for any organiser, so it
// is Stellr's alone. A tenant's staff get "check" for everyone: A10 and A11 say what a
// tenant's own answer is.
const TENANT_MEDIA_NOTE = 'Not available for your organisation yet: check your own records'

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: '/api/admin/events/[slug]/export' })
  if (!crew.ok) return crew.response

  const roster = await getEventRoster(slug, undefined, { tenant: enforcedTenantFilter(crew.scope, 'registrations') })
  const media = isStellrScope(crew.scope)
    ? await mediaForParticipants(supabaseServer(), roster.groups.flatMap((g) => g.participants.map((p) => p.id)))
    : null

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
      displayGrade(p.grade) ?? '',
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
      media?.get(p.id)?.status ?? 'check',
      media ? MEDIA_REASON_LABEL[media.get(p.id)?.reason ?? 'form_unread'] : TENANT_MEDIA_NOTE,
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
