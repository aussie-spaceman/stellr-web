import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeEventRole } from '@/lib/member-enums'

// Who pays for each person in a group (9 Nov 2026).
//
// A group used to pay one way, chosen once: an invoice to the organizer, a card
// payment by the organizer, or everyone by their own link. A teacher asked for an
// invoice for herself only while her students paid by link, so each participant
// now carries a payer (participants.payer, migration 20261109180000):
//
//   group  → the organizer's invoice (or card payment) covers their place
//   self   → they pay by their own pay link
//   shared → an adult whose fee the students' links share ("Students share the
//            teacher's cost", lib/teacher-share.ts)
//
// A NULL payer keeps the old meaning, so groups from before this change need no
// backfill: the group's flags decide. A group where some people are on the
// invoice and some pay by link ("Invoice for some") has invoice_requested set,
// member_pays_individually clear, and late_joiner_payer set: that last one says
// how people who join later pay, and is what marks the group as split.
//
// Everything here is pure except loadPayerPeople, so the rules are tested
// without a database.

export type Payer = 'group' | 'self' | 'shared'
export type LateJoinerPayer = 'group' | 'self'

export const PAYERS: readonly Payer[] = ['group', 'self', 'shared']
export const LATE_JOINER_PAYERS: readonly LateJoinerPayer[] = ['group', 'self']

export interface PayerGroup {
  member_pays_individually: boolean | null
  late_joiner_payer?: string | null
  /** Set only on a group whose students share the teacher's cost. */
  share_estimate?: number | null
  share_first_paid_at?: string | null
}

export interface PayerPerson {
  payer?: string | null
  individual_payment_status?: string | null
  event_role?: string | null
}

/** A student-manager is the group's first student; every other non-participant role is an adult. */
export function isAdultRole(eventRole: string | null | undefined): boolean {
  const role = normalizeEventRole(eventRole)
  return !(role === 'participant' || role === 'school_student_manager')
}

/** True for a group whose students share the teacher's cost. */
export function isSharedGroup(reg: Pick<PayerGroup, 'share_estimate'>): boolean {
  return reg.share_estimate != null
}

const isPayer = (v: unknown): v is Payer => v === 'group' || v === 'self' || v === 'shared'
export const isLateJoinerPayer = (v: unknown): v is LateJoinerPayer => v === 'group' || v === 'self'

/** True for a group where some places are on the invoice and some are paid by link. */
export function isSplitGroup(reg: PayerGroup): boolean {
  return !reg.member_pays_individually && isLateJoinerPayer(reg.late_joiner_payer)
}

/** Who pays for this person's place. */
export function payerOf(person: PayerPerson, reg: PayerGroup): Payer {
  if (isPayer(person.payer)) return person.payer
  if (isSharedGroup(reg)) {
    const status = person.individual_payment_status
    if (status === 'covered') return 'shared'
    if (status === 'paid' || status === 'pending' || status === 'waived') return 'self'
    // An adult joining before any student has paid a share folds into the shares;
    // after that the shares can't go up, so they pay their own way.
    return isAdultRole(person.event_role) && !reg.share_first_paid_at ? 'shared' : 'self'
  }
  if (reg.member_pays_individually) return 'self'
  // A place paid by its own link (before the group changed how it pays), or one
  // with a link still out, is that person's own.
  if (person.individual_payment_status === 'paid' || person.individual_payment_status === 'pending') return 'self'
  if (isLateJoinerPayer(reg.late_joiner_payer)) return reg.late_joiner_payer
  return 'group'
}

/**
 * Places the organizer's invoice (or card payment) does NOT cover: people paying
 * their own way, places already paid by link, and, in a split group whose later
 * joiners pay by link, the declared places nobody has filled yet.
 */
export function seatsOffInvoice(declaredSeats: number, people: PayerPerson[], reg: PayerGroup): number {
  const named = people.filter((p) => payerOf(p, reg) !== 'group' || p.individual_payment_status === 'paid').length
  const unfilled = Math.max(0, declaredSeats - people.length)
  return named + (reg.late_joiner_payer === 'self' && isSplitGroup(reg) ? unfilled : 0)
}

/** Places the organizer's invoice (or card payment) covers. */
export function seatsOnInvoice(declaredSeats: number, people: PayerPerson[], reg: PayerGroup): number {
  return Math.max(0, declaredSeats - seatsOffInvoice(declaredSeats, people, reg))
}

/**
 * At registration, before any row exists: the places on the invoice for an
 * "Invoice for some" group. The registrant, plus everyone ticked, plus the places
 * still to be filled when later joiners go on the invoice.
 */
export function registrationInvoiceSeats(input: {
  declaredSeats: number
  registrantOnInvoice: boolean
  entered: { on_invoice?: boolean | null }[]
  lateJoinerPayer: LateJoinerPayer
}): number {
  const named = 1 + input.entered.length
  const onInvoice = (input.registrantOnInvoice ? 1 : 0) + input.entered.filter((p) => p.on_invoice === true).length
  const unfilled = Math.max(0, input.declaredSeats - named)
  return onInvoice + (input.lateJoinerPayer === 'group' ? unfilled : 0)
}

export interface PayerRow extends PayerPerson {
  id: string
}

export async function loadPayerPeople(db: SupabaseClient, registrationId: string): Promise<PayerRow[]> {
  const { data, error } = await db
    .from('participants')
    .select('id, payer, individual_payment_status, event_role')
    .eq('registration_id', registrationId)
  if (error) throw new Error(`Could not read who pays for this group: ${error.message}`)
  return (data ?? []) as PayerRow[]
}
