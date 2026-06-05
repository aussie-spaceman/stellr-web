import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const db = supabaseServer()

  const { data: registration, error: regErr } = await db
    .from('registrations')
    .select('id, event_title, school_name, teacher_first_name, teacher_last_name, type')
    .eq('id', params.id)
    .maybeSingle()

  if (regErr || !registration) {
    return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
  }

  if ((registration as { type: string }).type !== 'group') {
    return NextResponse.json({ error: 'Spreadsheet download is only available for group registrations' }, { status: 400 })
  }

  const { data: participants, error: partErr } = await db
    .from('participants')
    .select(
      'membership_id, first_name, last_name, email, phone, date_of_birth, grade, gender, t_shirt_size, age_bracket, event_role, health_conditions, emergency_contact_first_name, emergency_contact_last_name, emergency_contact_email, emergency_contact_phone'
    )
    .eq('registration_id', params.id)
    .order('last_name')

  if (partErr) {
    return NextResponse.json({ error: 'Failed to fetch participants' }, { status: 500 })
  }

  const headers = [
    'Membership ID', 'First Name', 'Last Name', 'Email', 'Phone',
    'Date of Birth', 'Grade', 'Gender', 'T-Shirt Size', 'Age Bracket', 'Event Role',
    'Health Conditions',
    'Emergency Contact First Name', 'Emergency Contact Last Name',
    'Emergency Contact Email', 'Emergency Contact Phone',
  ]

  function csvCell(val: string | null | undefined): string {
    if (val == null) return ''
    const s = String(val)
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }

  const rows = (participants ?? []).map((p: Record<string, unknown>) => [
    p.membership_id, p.first_name, p.last_name, p.email, p.phone,
    p.date_of_birth, p.grade, p.gender, p.t_shirt_size, p.age_bracket, p.event_role,
    p.health_conditions,
    p.emergency_contact_first_name, p.emergency_contact_last_name,
    p.emergency_contact_email, p.emergency_contact_phone,
  ].map(v => csvCell(v as string)).join(','))

  const csv = [headers.map(csvCell).join(','), ...rows].join('\r\n')

  const reg = registration as { event_title: string; school_name: string | null }
  const filename = `${reg.event_title} — ${reg.school_name ?? 'Group'} Participants.csv`
    .replace(/[/\\?%*:|"<>]/g, '-')

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
