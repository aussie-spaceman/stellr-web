import { supabaseServer } from '@/lib/supabase'
import { deriveCompliance, loadComplianceRecordsByEmails, type ComplianceState } from '@/lib/compliance'

// Data assembly for the admin/event-manager event detail view (PRD 6.7).
// Per-participant pill logic (user-confirmed 11-Jun-2026, supersedes the
// single summary pill of 10-Jun-2026):
//   Payment  — red "Invoice Issued" / green "Invoice Paid" when the group
//              requested an invoice; red "Pmt Link Unpaid" / green "Pmt Link
//              Paid" for every Stripe-checkout path (individual registrations,
//              group card payments, members paying individually).
//   DocuSign — red "Issued", orange "Partially Complete" (some but not all
//              signers done), green "Complete"; plus red "Not Issued" when
//              paperwork is required but no envelope exists yet, red
//              "Declined", and gray "Not Required".
//   Check-in — green "Checked In" / orange "Registered" (kept alongside the
//              two pills above so event-day arrival state stays visible).

export type PaymentPill = 'invoice_issued' | 'invoice_paid' | 'link_unpaid' | 'link_paid'
export type DocusignPill = 'not_required' | 'not_issued' | 'issued' | 'partial' | 'declined' | 'complete'

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
  minor: boolean
  emergency_contact_name: string | null
  emergency_contact_email: string | null
  paid: boolean
  docusign: 'completed' | 'outstanding' | 'not_required'
  payment_pill: PaymentPill
  docusign_pill: DocusignPill
  // Background-check / license clearance for adult non-students (PRD §13).
  // 'not_required' for students and minors; the roster renders it as n/a.
  compliance_pill: ComplianceState
}

export interface RosterGroup {
  registrationId: string
  type: 'individual' | 'group'
  status: string
  groupLabel: string | null // teacher/school label for group registrations
  teacherEmail: string | null
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
        `id, type, status, teacher_first_name, teacher_last_name, teacher_email, school_name,
         member_pays_individually, invoice_requested,
         participants(id, first_name, last_name, email, grade, gender, date_of_birth, t_shirt_size,
           school_name, event_role, dietary_requirements, health_conditions, company_id,
           checked_in_at, individual_payment_status,
           emergency_contact_first_name, emergency_contact_last_name, emergency_contact_email)`
      )
      .eq('event_slug', eventSlug)
      .neq('status', 'withdrawn')
      .order('created_at', { ascending: true }),
    db
      .from('docusign_envelopes')
      .select('participant_id, status, signers_total, signers_completed')
      .eq('event_slug', eventSlug),
  ])
  if (regError) throw new Error(`Failed to load registrations: ${regError.message}`)
  if (envError) throw new Error(`Failed to load docusign envelopes: ${envError.message}`)

  // Latest-wins per participant: completed beats anything else
  interface EnvelopeProgress { status: string; total: number; completed: number }
  const envelopeByParticipant = new Map<string, EnvelopeProgress>()
  for (const env of envelopes ?? []) {
    if (!env.participant_id) continue
    const prev = envelopeByParticipant.get(env.participant_id)
    if (prev?.status !== 'completed') {
      envelopeByParticipant.set(env.participant_id, {
        status: env.status,
        total: (env.signers_total as number | null) ?? 1,
        completed: (env.signers_completed as number | null) ?? 0,
      })
    }
  }

  // Compliance (background-check / license) records for every participant email,
  // in one query. Requirement is driven by the participant's role for THIS event,
  // so we derive per-participant below rather than trusting the member row's role.
  const allEmails = (regs ?? []).flatMap((reg) =>
    ((reg.participants as Record<string, unknown>[]) ?? []).map((p) => (p.email as string | null) ?? ''),
  )
  const complianceRecords = await loadComplianceRecordsByEmails(db, allEmails)

  const groups: RosterGroup[] = (regs ?? []).map((reg) => {
    const participants = ((reg.participants as Record<string, unknown>[]) ?? []).map((p) => {
      const paid =
        reg.status === 'confirmed' ||
        (p.individual_payment_status as string | null) === 'paid'

      const payment_pill: PaymentPill = reg.invoice_requested
        ? paid ? 'invoice_paid' : 'invoice_issued'
        : paid ? 'link_paid' : 'link_unpaid'

      const minor = isMinor(p.date_of_birth as string | null, eventDate)
      const env = envelopeByParticipant.get(p.id as string)
      let docusign: RosterParticipant['docusign']
      if (env?.status === 'completed') docusign = 'completed'
      else if (env) docusign = 'outstanding'
      else if (minor) docusign = 'outstanding'
      else docusign = 'not_required'

      let docusign_pill: DocusignPill
      if (!env) docusign_pill = minor ? 'not_issued' : 'not_required'
      else if (env.status === 'completed') docusign_pill = 'complete'
      else if (env.status === 'declined') docusign_pill = 'declined'
      else if (env.status === 'voided') docusign_pill = 'not_issued'
      else docusign_pill = env.completed > 0 && env.completed < env.total ? 'partial' : 'issued'

      // Compliance pill: derive from the member's license/checks (by email) but
      // using the participant's role/dob for THIS event. No member row → records
      // are absent, so an adult non-student with nothing on file reads 'invalid'.
      const records = complianceRecords.get(((p.email as string | null) ?? '').toLowerCase())
      const compliance_pill = deriveCompliance(
        records?.license ?? null,
        records?.checks ?? [],
        p.event_role as string | null,
        p.date_of_birth as string | null,
        eventDate,
      ).state

      const ecName =
        [p.emergency_contact_first_name, p.emergency_contact_last_name].filter(Boolean).join(' ') || null

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
        minor,
        emergency_contact_name: ecName,
        emergency_contact_email: (p.emergency_contact_email as string | null) || null,
        paid,
        docusign,
        payment_pill,
        docusign_pill,
        compliance_pill,
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
      teacherEmail: (reg.teacher_email as string | null) || null,
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
