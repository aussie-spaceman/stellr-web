import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import { getEventBySlug } from '@/lib/sanity'
import { getCurrentMember } from '@/lib/community'
import { issueCredential, CREDENTIAL_COLUMNS } from '@/lib/credentials'
import { sendCredentialIssuedEmail } from '@/lib/credentials-notify'
import { logActivity } from '@/lib/activity-log'
import { themeFromType } from '@/lib/campaigns'
import { parsePdHours, pdCredentialTitle, pdStandardCodes, formatPdHours } from '@/lib/pd-standards'

export const dynamic = 'force-dynamic'

// Educator PD credentials for an event: an admin records the hours a teacher
// gave, and the teacher gets a PD certificate + a LinkedIn-ready credential.
// Manual only (decision Q1, 7 Oct 2026). Design: docs/PLAN-educator-pd-2026-10-07.md.
//
// GET is open to the event's managers (read-only list). POST is admins only:
// hours on a certificate a teacher submits to a licensing body are an
// attestation, and finding the teacher needs the all-members search.

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const { data, error } = await supabaseServer()
    .from('credentials')
    .select(CREDENTIAL_COLUMNS)
    .eq('event_slug', slug)
    .eq('source', 'pd')
    .order('issued_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ credentials: data ?? [], canIssue: access.isAdmin })
}

// POST { memberId, hours } — issue one. Idempotent: a live PD credential for
// this member and event is returned as-is (created: false), whatever the hours
// sent; a correction is revoke + issue again.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  if (!access.isAdmin) return NextResponse.json({ error: 'Only admins can record PD hours' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as { memberId?: unknown; hours?: unknown }
  const memberId = typeof body.memberId === 'string' ? body.memberId : ''
  const hours = parsePdHours(body.hours)
  if (!memberId) return NextResponse.json({ error: 'Choose an educator' }, { status: 400 })
  if (hours === null) return NextResponse.json({ error: 'Hours must be between 0.1 and 40' }, { status: 400 })

  const db = supabaseServer()
  const [{ data: member }, event] = await Promise.all([
    db.from('members')
      .select('id, first_name, last_name, email, date_of_birth, is_active')
      .eq('id', memberId)
      .maybeSingle(),
    getEventBySlug(slug),
  ])
  if (!member || member.is_active === false) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const ev = event as { title?: string; type?: string; date?: string | null; venue?: string | null; city?: string | null; state?: string | null }
  const eventTitle = ev.title ?? slug
  const place = [ev.city, ev.state].filter(Boolean).join(', ')
  const location = [ev.venue, place].filter(Boolean).join(', ') || null
  const theme = themeFromType(ev.type) === 'enviro' ? 'environmental' : 'space'

  let result
  try {
    result = await issueCredential(db, {
      source:           'pd',
      memberId:         member.id,
      eventSlug:        slug,
      recipient:        { firstName: member.first_name ?? '', lastName: member.last_name ?? '', dateOfBirth: member.date_of_birth ?? null },
      title:            pdCredentialTitle(eventTitle, hours),
      description:      'Recognises an educator who gave their time to support students at a Stellr Education STEM competition.',
      criteria:         'Supported the event in person. Hours are recorded by Stellr Education staff and mapped to NGSS and Common Core practices.',
      issuer:           'Stellr Education',
      roleLabel:        'Educator',
      theme,
      pdHours:          hours,
      standards:        pdStandardCodes(),
      activityTitle:    eventTitle,
      activityDate:     ev.date ?? null,
      activityLocation: location,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }

  let emailed = false
  if (result.created) {
    emailed = await sendCredentialIssuedEmail(db, result.row, { firstName: member.first_name ?? '', email: member.email })
    const actor = await getCurrentMember()
    await logActivity({
      memberId: member.id,
      category: 'account',
      actorType: 'admin',
      actorMemberId: actor?.id ?? null,
      action: 'pd_credential_issued',
      summary: `PD credential issued: ${formatPdHours(hours)} hours at ${eventTitle} (${result.row.number})`,
    })
  }

  return NextResponse.json({ ok: true, created: result.created, emailed, credential: result.row })
}
