import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import { getEventBySlug } from '@/lib/sanity'
import { issueCredential, CREDENTIAL_COLUMNS, type CredentialRow } from '@/lib/credentials'
import { sendCredentialIssuedEmail } from '@/lib/credentials-notify'
import { themeFromType } from '@/lib/campaigns'

export const dynamic = 'force-dynamic'

// Participation credentials for an event — the verifiable, per-person record
// beside the print certificates in ../certificates. Design: PLAN §3.3.

const ROLE_LABELS: Record<string, string> = {
  participant: 'Student',
  school_student_manager: 'Student Manager',
  teacher: 'Teacher',
  mentor: 'Mentor',
  volunteer: 'Volunteer',
  parent: 'Parent',
}

interface Settings {
  credential_title: string | null
  credential_description: string | null
  credential_criteria: string | null
  credential_skills: string[] | null
}

async function loadSettings(slug: string): Promise<Settings | null> {
  const { data } = await supabaseServer()
    .from('event_settings')
    .select('credential_title, credential_description, credential_criteria, credential_skills')
    .eq('event_slug', slug)
    .maybeSingle()
  return (data as Settings | null) ?? null
}

// GET — the event's credential config and everything issued so far.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const db = supabaseServer()
  const regIds = await registrationIds(slug)
  const [settings, { data: rows }, { count: checkedIn }] = await Promise.all([
    loadSettings(slug),
    db.from('credentials').select(CREDENTIAL_COLUMNS).eq('event_slug', slug).order('recipient_name'),
    regIds.length
      ? db.from('participants').select('id', { count: 'exact', head: true }).not('checked_in_at', 'is', null).in('registration_id', regIds)
      : Promise.resolve({ count: 0 }),
  ])
  return NextResponse.json({
    settings: settings ?? { credential_title: null, credential_description: null, credential_criteria: null, credential_skills: [] },
    credentials: rows ?? [],
    checkedInCount: checkedIn ?? 0,
  })
}

// PATCH — credential config (title, description, criteria, skills).
export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = (await req.json().catch(() => ({}))) as Partial<Record<keyof Settings, unknown>>
  const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const update = {
    event_slug: slug,
    credential_title:       clean(body.credential_title),
    credential_description: clean(body.credential_description),
    credential_criteria:    clean(body.credential_criteria),
    credential_skills:      Array.isArray(body.credential_skills)
      ? body.credential_skills.filter((s): s is string => typeof s === 'string' && s.trim() !== '').map((s) => s.trim())
      : [],
  }
  const { error } = await supabaseServer().from('event_settings').upsert(update, { onConflict: 'event_slug' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// POST — issue for everyone who took part. Body: { mode: 'checked_in' | 'all' }.
// D2 (21 Sept 2026): checked-in when the event used check-in, otherwise all;
// the panel defaults the mode from checkedInCount and the admin can override.
// Idempotent: participants already holding one are skipped, not duplicated.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = (await req.json().catch(() => ({}))) as { mode?: string }
  const mode = body.mode === 'all' ? 'all' : 'checked_in'

  const db = supabaseServer()
  const [event, settings] = await Promise.all([getEventBySlug(slug), loadSettings(slug)])
  const eventTitle = (event as { title?: string } | null)?.title ?? slug
  const title = settings?.credential_title ?? `${eventTitle} — Participant`
  // Sanity's `type` carries the competition theme; the badge ring follows it.
  const theme = themeFromType((event as { type?: string } | null)?.type) === 'enviro' ? 'environmental' : 'space'

  const { data: regs } = await db
    .from('registrations')
    .select('id, participants(id, member_id, first_name, last_name, email, date_of_birth, event_role, award, checked_in_at, emergency_contact_first_name, emergency_contact_email)')
    .eq('event_slug', slug)
    .neq('status', 'withdrawn')

  type P = {
    id: string; member_id: string | null; first_name: string; last_name: string; email: string; date_of_birth: string
    event_role: string; award: string | null; checked_in_at: string | null
    emergency_contact_first_name: string | null; emergency_contact_email: string | null
  }
  const people = (regs ?? [])
    .flatMap((r) => (r.participants as P[]) ?? [])
    .filter((p) => mode === 'all' || p.checked_in_at)

  let created = 0
  let existing = 0
  let emailed = 0
  const failures: string[] = []
  for (const p of people) {
    try {
      const result = await issueCredential(db, {
        source: 'event',
        participantId: p.id,
        memberId: p.member_id,
        eventSlug: slug,
        recipient: { firstName: p.first_name, lastName: p.last_name, dateOfBirth: p.date_of_birth },
        title,
        description: settings?.credential_description ?? null,
        criteria:    settings?.credential_criteria ?? null,
        skills:      settings?.credential_skills ?? [],
        issuer:      'Stellr Education',
        roleLabel:   ROLE_LABELS[p.event_role] ?? 'Participant',
        award:       p.award,
        theme,
      })
      if (result.created) {
        created++
        const sent = await sendCredentialIssuedEmail(db, result.row, {
          firstName: p.first_name,
          email: p.email,
          guardianFirstName: p.emergency_contact_first_name,
          guardianEmail: p.emergency_contact_email,
        })
        if (sent) emailed++
      } else {
        existing++
      }
    } catch (err) {
      failures.push(`${p.first_name} ${p.last_name}: ${(err as Error).message}`)
    }
  }

  return NextResponse.json({ ok: true, mode, considered: people.length, created, existing, emailed, failures })
}

async function registrationIds(slug: string): Promise<string[]> {
  const { data } = await supabaseServer().from('registrations').select('id').eq('event_slug', slug).neq('status', 'withdrawn')
  return (data ?? []).map((r) => r.id as string)
}

export type EventCredentialRow = CredentialRow
