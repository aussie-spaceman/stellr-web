import { supabaseServer } from '@/lib/supabase'

// Data assembly for the admin/event-manager event detail view (PRD 6.7).
// Status pill logic (user-confirmed 10-Jun-2026):
//   red    "Not Paid"    — payment outstanding
//   red    "No DocuSign" — consent form outstanding for a minor
//   green  "Checked In"  — arrived at the event (in-person or virtual confirm)
//   orange "Registered"  — registration complete, not yet arrived

export type ParticipantPill = 'not_paid' | 'no_docusign' | 'checked_in' | 'registered'

export interface RosterParticipant {
  id: string
  first_name: string
  last_name: string
  email: string
  grade: string | null
  gender: string | null
  date_of_birth: string | null
  t_shirt_size: string | null
  school_name: string | null
  event_role: string | null
  dietary_requirements: string[]
  health_conditions: string | null
  company_id: string | null
  checked_in_at: string | null
  paid: boolean
  docusign: 'completed' | 'outstanding' | 'not_required'
  pill: ParticipantPill
}

export interface RosterGroup {
  registrationId: string
  type: 'individual' | 'group'
  status: string
  groupLabel: string | null // teacher/school label for group registrations
  participants: RosterParticipant[]
}

export interface EventRosterData {
  groups: RosterGroup[]
  summary: {
    totalParticipants: number
    groupParticipants: number
    individualParticipants: number
    groupRegistrations: number
    individualRegistrations: number
    dietary: { name: string; count: number }[]
    healthIssues: { name: string; condition: string }[]
    outstandingPayments: number
    outstandingDocusigns: number
    checkedIn: number
  }
}

function isMinor(dateOfBirth: string | null, eventDate?: string): boolean {
  if (!dateOfBirth) return false
  const dob = new Date(dateOfBirth)
  const ref = eventDate ? new Date(eventDate) : new Date()
  const age = (ref.getTime() - dob.getTime()) / (365.25 * 24 * 3600 * 1000)
  return age < 18
}

export async function getEventRoster(eventSlug: string, eventDate?: string): Promise<EventRosterData> {
  const db = supabaseServer()

  const [{ data: regs, error: regError }, { data: envelopes, error: envError }] = await Promise.all([
    db
      .from('registrations')
      .select(
        `id, type, status, teacher_first_name, teacher_last_name, school_name, member_pays_individually,
         participants(id, first_name, last_name, email, grade, gender, date_of_birth, t_shirt_size,
           school_name, event_role, dietary_requirements, health_conditions, company_id,
           checked_in_at, individual_payment_status)`
      )
      .eq('event_slug', eventSlug)
      .neq('status', 'withdrawn')
      .order('created_at', { ascending: true }),
    db
      .from('docusign_envelopes')
      .select('participant_id, status')
      .eq('event_slug', eventSlug),
  ])
  if (regError) throw new Error(`Failed to load registrations: ${regError.message}`)
  if (envError) throw new Error(`Failed to load docusign envelopes: ${envError.message}`)

  // Latest-wins per participant: completed beats anything else
  const envelopeByParticipant = new Map<string, string>()
  for (const env of envelopes ?? []) {
    if (!env.participant_id) continue
    const prev = envelopeByParticipant.get(env.participant_id)
    if (prev !== 'completed') envelopeByParticipant.set(env.participant_id, env.status)
  }

  const groups: RosterGroup[] = (regs ?? []).map((reg) => {
    const participants = ((reg.participants as Record<string, unknown>[]) ?? []).map((p) => {
      const paid =
        reg.status === 'confirmed' ||
        (p.individual_payment_status as string | null) === 'paid'

      const envStatus = envelopeByParticipant.get(p.id as string)
      let docusign: RosterParticipant['docusign']
      if (envStatus === 'completed') docusign = 'completed'
      else if (envStatus) docusign = 'outstanding'
      else if (isMinor(p.date_of_birth as string | null, eventDate)) docusign = 'outstanding'
      else docusign = 'not_required'

      const pill: ParticipantPill = !paid
        ? 'not_paid'
        : docusign === 'outstanding'
          ? 'no_docusign'
          : p.checked_in_at
            ? 'checked_in'
            : 'registered'

      return {
        id: p.id as string,
        first_name: p.first_name as string,
        last_name: p.last_name as string,
        email: p.email as string,
        grade: p.grade as string | null,
        gender: p.gender as string | null,
        date_of_birth: p.date_of_birth as string | null,
        t_shirt_size: p.t_shirt_size as string | null,
        school_name: p.school_name as string | null,
        event_role: p.event_role as string | null,
        dietary_requirements: (p.dietary_requirements as string[]) ?? [],
        health_conditions: (p.health_conditions as string | null) || null,
        company_id: p.company_id as string | null,
        checked_in_at: p.checked_in_at as string | null,
        paid,
        docusign,
        pill,
      }
    })

    const groupLabel =
      reg.type === 'group'
        ? [
            [reg.teacher_first_name, reg.teacher_last_name].filter(Boolean).join(' '),
            reg.school_name,
          ]
            .filter(Boolean)
            .join(' — ') || 'Group'
        : null

    return {
      registrationId: reg.id,
      type: reg.type as 'individual' | 'group',
      status: reg.status,
      groupLabel,
      participants,
    }
  })

  const all = groups.flatMap((g) => g.participants)
  const dietaryCounts = new Map<string, number>()
  for (const p of all) {
    for (const d of p.dietary_requirements) {
      if (!d || d.toLowerCase() === 'none') continue
      dietaryCounts.set(d, (dietaryCounts.get(d) ?? 0) + 1)
    }
  }

  return {
    groups,
    summary: {
      totalParticipants: all.length,
      groupParticipants: groups.filter((g) => g.type === 'group').reduce((n, g) => n + g.participants.length, 0),
      individualParticipants: groups.filter((g) => g.type === 'individual').reduce((n, g) => n + g.participants.length, 0),
      groupRegistrations: groups.filter((g) => g.type === 'group').length,
      individualRegistrations: groups.filter((g) => g.type === 'individual').length,
      dietary: [...dietaryCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      healthIssues: all
        .filter((p) => p.health_conditions && p.health_conditions.toLowerCase() !== 'none')
        .map((p) => ({ name: `${p.first_name} ${p.last_name}`, condition: p.health_conditions as string })),
      outstandingPayments: all.filter((p) => !p.paid).length,
      outstandingDocusigns: all.filter((p) => p.docusign === 'outstanding').length,
      checkedIn: all.filter((p) => p.checked_in_at).length,
    },
  }
}
