import type { SupabaseClient } from '@supabase/supabase-js'

// "Is this email already on this event?" — asked by both registration forms.
//
// Each route used to answer it inline, and both copies were wrong the same
// way: `participants` was queried by email alone with `.maybeSingle()`, so an
// address on two events errored (silently skipping the check) and only the
// first row's event was compared. Neither copy looked at status, so an unpaid
// 'pending' row from an abandoned checkout blocked the same person from ever
// coming back — the 17 Sept 2026 Colorado incident.
//
// One lookup, filtered by event, ignoring withdrawn; and one decision table
// that says what to do about a match, unit-tested on its own.

export type ExistingRegistrationRole = 'participant' | 'organiser'

export interface ExistingRegistration {
  registrationId: string
  email: string
  role: ExistingRegistrationRole
  type: 'individual' | 'group' | 'campaign'
  status: 'pending' | 'confirmed' | 'withdrawn'
  invoiceRequested: boolean
  memberPaysIndividually: boolean
  teacherEmail: string | null
}

interface RegistrationLite {
  id: string
  type: ExistingRegistration['type']
  status: ExistingRegistration['status']
  invoice_requested: boolean | null
  member_pays_individually: boolean | null
  teacher_email: string | null
}

const REG_COLUMNS = 'id, type, status, invoice_requested, member_pays_individually, teacher_email'

/**
 * Non-withdrawn registrations on `eventSlug` that any of `emails` is part of —
 * as a participant, or as the group organiser (a teacher who chose the
 * spreadsheet / email-link roster has no participant row of their own, so the
 * old participant-only check never saw them).
 */
export async function findExistingRegistrations(
  db: SupabaseClient,
  emails: string[],
  eventSlug: string,
): Promise<Map<string, ExistingRegistration[]>> {
  const out = new Map<string, ExistingRegistration[]>()
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
  if (wanted.length === 0) return out

  const push = (email: string, entry: ExistingRegistration) => {
    const list = out.get(email) ?? []
    if (!list.some((e) => e.registrationId === entry.registrationId && e.role === entry.role)) list.push(entry)
    out.set(email, list)
  }
  const toEntry = (reg: RegistrationLite, email: string, role: ExistingRegistrationRole): ExistingRegistration => ({
    registrationId: reg.id,
    email,
    role,
    type: reg.type,
    status: reg.status,
    invoiceRequested: reg.invoice_requested === true,
    memberPaysIndividually: reg.member_pays_individually === true,
    teacherEmail: reg.teacher_email,
  })

  // Participants → their registrations, narrowed to this event.
  const { data: parts } = await db
    .from('participants')
    .select('email, registration_id')
    .in('email', wanted)
  const partRows = (parts ?? []) as { email: string; registration_id: string }[]
  const regIds = [...new Set(partRows.map((p) => p.registration_id))]
  if (regIds.length > 0) {
    const { data: regs } = await db
      .from('registrations')
      .select(REG_COLUMNS)
      .in('id', regIds)
      .eq('event_slug', eventSlug)
      .neq('status', 'withdrawn')
    const byId = new Map(((regs ?? []) as RegistrationLite[]).map((r) => [r.id, r]))
    for (const p of partRows) {
      const reg = byId.get(p.registration_id)
      if (reg) push(p.email.toLowerCase(), toEntry(reg, p.email.toLowerCase(), 'participant'))
    }
  }

  // Organisers of a group on this event.
  const { data: organised } = await db
    .from('registrations')
    .select(REG_COLUMNS)
    .in('teacher_email', wanted)
    .eq('event_slug', eventSlug)
    .neq('status', 'withdrawn')
  for (const reg of (organised ?? []) as RegistrationLite[]) {
    const email = reg.teacher_email?.toLowerCase()
    if (email) push(email, toEntry(reg, email, 'organiser'))
  }

  return out
}

export type DuplicateResolution =
  | { kind: 'none' }
  /** Confirmed, or pending on a path that settles elsewhere — nothing to resume. */
  | { kind: 'already_registered'; registration: ExistingRegistration }
  /** The caller IS this registrant (session email matches): hand them the checkout. */
  | { kind: 'resume'; registration: ExistingRegistration }
  /** Someone with the email but no session: email the pay link, don't reveal the checkout. */
  | { kind: 'email_link'; registration: ExistingRegistration }
  /** Part of someone else's group on this event. */
  | { kind: 'in_group'; registration: ExistingRegistration }
  /** Organiser of a group whose Stripe invoice is still open. */
  | { kind: 'invoice_pending'; registration: ExistingRegistration }

/**
 * Decide what a duplicate match means for the person submitting the form.
 * Pure — the route supplies the matches and whether the caller's session
 * email is the address in question.
 */
export function resolveDuplicate(
  matches: ExistingRegistration[] | undefined,
  opts: { sessionMatches: boolean },
): DuplicateResolution {
  if (!matches || matches.length === 0) return { kind: 'none' }

  const confirmed = matches.find((m) => m.status === 'confirmed')
  if (confirmed) return { kind: 'already_registered', registration: confirmed }

  // Prefer a match the person can act on themselves.
  const pending = matches.filter((m) => m.status === 'pending')
  const ownPending =
    pending.find((m) => m.type === 'individual') ??
    pending.find((m) => m.role === 'organiser') ??
    pending[0]
  if (!ownPending) return { kind: 'none' }

  if (ownPending.type === 'individual') {
    if (ownPending.invoiceRequested) return { kind: 'already_registered', registration: ownPending }
    return { kind: opts.sessionMatches ? 'resume' : 'email_link', registration: ownPending }
  }

  if (ownPending.role === 'organiser') {
    if (ownPending.invoiceRequested) return { kind: 'invoice_pending', registration: ownPending }
    // Members-pay-individually: the organiser's own seat was emailed its own
    // link; a campaign is confirmed at insert and never pending. Neither is a
    // whole-group card checkout to resume.
    if (ownPending.memberPaysIndividually || ownPending.type === 'campaign') {
      return { kind: 'already_registered', registration: ownPending }
    }
    return { kind: opts.sessionMatches ? 'resume' : 'email_link', registration: ownPending }
  }

  return { kind: 'in_group', registration: ownPending }
}
