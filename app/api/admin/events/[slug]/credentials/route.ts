import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import { getEventBySlug } from '@/lib/sanity'
import { issueCredential, CREDENTIAL_COLUMNS, type CredentialRow } from '@/lib/credentials'
import { sendCredentialIssuedEmail } from '@/lib/credentials-notify'
import { themeFromType } from '@/lib/campaigns'
import { EVENT_AWARDS, mentorCredentialTitle } from '@/lib/event-awards'
import { listEventMentors } from '@/lib/event-certificates'

export const dynamic = 'force-dynamic'

// Participation credentials for an event — the verifiable, per-person record
// beside the print certificates in ../certificates. Design: PLAN §3.3.
//
// Two audiences, chosen by `audience` (query string on GET, body otherwise):
//   students (default) — participation credentials for registered participants
//   mentors            — the Certificate of Appreciation credential for every
//                        volunteer mentor assigned on the Volunteers panel
// Each audience has its own wording in event_settings and its own list; the
// credential itself (page, wallet, consent, email, LinkedIn) is the same.
// Design: docs/PLAN-mentor-credentials-2026-10-08.md.

type Audience = 'students' | 'mentors'
const audienceOf = (v: unknown): Audience => (v === 'mentors' ? 'mentors' : 'students')

// event_settings columns per audience; the API speaks credential_* for both.
const COLUMNS: Record<Audience, Record<keyof Settings, string>> = {
  students: {
    credential_title: 'credential_title',
    credential_description: 'credential_description',
    credential_criteria: 'credential_criteria',
    credential_skills: 'credential_skills',
  },
  mentors: {
    credential_title: 'mentor_credential_title',
    credential_description: 'mentor_credential_description',
    credential_criteria: 'mentor_credential_criteria',
    credential_skills: 'mentor_credential_skills',
  },
}

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

async function loadSettings(slug: string, audience: Audience): Promise<Settings | null> {
  const cols = COLUMNS[audience]
  const { data } = await supabaseServer()
    .from('event_settings')
    .select(Object.values(cols).join(', '))
    .eq('event_slug', slug)
    .maybeSingle()
  if (!data) return null
  const row = data as unknown as Record<string, unknown>
  return {
    credential_title:       (row[cols.credential_title] as string | null) ?? null,
    credential_description: (row[cols.credential_description] as string | null) ?? null,
    credential_criteria:    (row[cols.credential_criteria] as string | null) ?? null,
    credential_skills:      (row[cols.credential_skills] as string[] | null) ?? [],
  }
}

// GET ?audience= — that audience's credential config and everything issued
// to it so far. Students see every event credential but the mentors'.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const audience = audienceOf(new URL(req.url).searchParams.get('audience'))
  const db = supabaseServer()
  const regIds = await registrationIds(slug)
  const issued = db.from('credentials').select(CREDENTIAL_COLUMNS).eq('event_slug', slug).eq('source', 'event')
  const [settings, { data: rows }, { count: checkedIn }, mentors] = await Promise.all([
    loadSettings(slug, audience),
    (audience === 'mentors' ? issued.eq('award_type', 'mentor') : issued.neq('award_type', 'mentor')).order('recipient_name'),
    regIds.length
      ? db.from('participants').select('id', { count: 'exact', head: true }).not('checked_in_at', 'is', null).in('registration_id', regIds)
      : Promise.resolve({ count: 0 }),
    listEventMentors(db, slug),
  ])
  return NextResponse.json({
    audience,
    settings: settings ?? { credential_title: null, credential_description: null, credential_criteria: null, credential_skills: [] },
    credentials: rows ?? [],
    checkedInCount: checkedIn ?? 0,
    mentorCount: mentors.length,
  })
}

// PATCH — credential config (title, description, criteria, skills) for `audience`.
export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = (await req.json().catch(() => ({}))) as Partial<Record<keyof Settings | 'audience', unknown>>
  const cols = COLUMNS[audienceOf(body.audience)]
  const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const update = {
    event_slug: slug,
    [cols.credential_title]:       clean(body.credential_title),
    [cols.credential_description]: clean(body.credential_description),
    [cols.credential_criteria]:    clean(body.credential_criteria),
    [cols.credential_skills]:      Array.isArray(body.credential_skills)
      ? body.credential_skills.filter((s): s is string => typeof s === 'string' && s.trim() !== '').map((s) => s.trim())
      : [],
  }
  const { error } = await supabaseServer().from('event_settings').upsert(update, { onConflict: 'event_slug' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// POST — issue for everyone who took part.
// Body: { audience?: 'students' | 'mentors', mode?: 'checked_in' | 'all' }.
// Students — D2 (21 Sept 2026): checked-in when the event used check-in,
// otherwise all; the panel defaults the mode from checkedInCount and the admin
// can override. Mentors are not checked in at the door, so every assigned
// mentor is issued and `mode` is ignored; Revoke covers a no-show.
// Idempotent: anyone already holding one is skipped, not duplicated.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = (await req.json().catch(() => ({}))) as { mode?: string; audience?: string }
  const audience = audienceOf(body.audience)
  const mode = body.mode === 'all' ? 'all' : 'checked_in'

  const db = supabaseServer()
  const [event, settings] = await Promise.all([getEventBySlug(slug).catch(() => null), loadSettings(slug, audience)])
  const eventTitle = (event as { title?: string } | null)?.title ?? slug
  // Sanity's `type` carries the competition theme; the badge ring follows it.
  const theme = themeFromType((event as { type?: string } | null)?.type) === 'enviro' ? 'environmental' : 'space'

  if (audience === 'mentors') {
    return NextResponse.json(await issueToMentors(db, slug, eventTitle, theme, settings))
  }
  const title = settings?.credential_title ?? `${eventTitle} — Participant`

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
        awardType: 'participation',
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

async function issueToMentors(
  db: ReturnType<typeof supabaseServer>,
  slug: string,
  eventTitle: string,
  theme: 'space' | 'environmental',
  settings: Settings | null,
) {
  const def = EVENT_AWARDS.mentor
  const mentors = await listEventMentors(db, slug)
  let created = 0
  let existing = 0
  let emailed = 0
  const failures: string[] = []
  for (const m of mentors) {
    try {
      const result = await issueCredential(db, {
        source: 'event',
        awardType: 'mentor',
        memberId: m.member_id,
        eventSlug: slug,
        recipient: { firstName: m.first_name, lastName: m.last_name, dateOfBirth: m.date_of_birth },
        title:       settings?.credential_title ?? mentorCredentialTitle(eventTitle),
        description: settings?.credential_description ?? def.description,
        criteria:    settings?.credential_criteria ?? def.criteria,
        skills:      settings?.credential_skills ?? [],
        issuer:      'Stellr Education',
        roleLabel:   ROLE_LABELS.mentor,
        theme,
      })
      if (result.created) {
        created++
        if (await sendCredentialIssuedEmail(db, result.row, { firstName: m.first_name, email: m.email })) emailed++
      } else {
        existing++
      }
    } catch (err) {
      failures.push(`${m.first_name} ${m.last_name}: ${(err as Error).message}`)
    }
  }
  return { ok: true, audience: 'mentors' as const, mode: 'all' as const, considered: mentors.length, created, existing, emailed, failures }
}

async function registrationIds(slug: string): Promise<string[]> {
  const { data } = await supabaseServer().from('registrations').select('id').eq('event_slug', slug).neq('status', 'withdrawn')
  return (data ?? []).map((r) => r.id as string)
}

export type EventCredentialRow = CredentialRow
