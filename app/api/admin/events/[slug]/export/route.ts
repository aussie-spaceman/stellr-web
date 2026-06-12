import { NextResponse } from 'next/server'
import { requireEventAccess } from '@/lib/event-access'
import { getEventRoster } from '@/lib/event-admin'

function csvEscape(value: string | null | undefined): string {
  const s = value ?? ''
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// GET /api/admin/events/[slug]/export — roster CSV (admins + assigned event managers)
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const roster = await getEventRoster(slug)

  const header = [
    'Registration Type', 'Group', 'First Name', 'Last Name', 'Email', 'Role', 'School', 'Grade',
    'Gender', 'Date of Birth', 'Shirt Size', 'Dietary Requirements', 'Health Conditions',
    'Paid', 'Payment Status', 'DocuSign', 'DocuSign Status', 'Checked In At',
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
      p.paid ? 'yes' : 'no',
      p.payment_pill,
      p.docusign,
      p.docusign_pill,
      p.checked_in_at ?? '',
    ])
  )

  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n')
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}-participants.csv"`,
    },
  })
}
