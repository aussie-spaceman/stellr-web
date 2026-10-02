// Scholarship levels and money — browser-safe, shared by the admin review
// panel and the server. Everything else lives in lib/scholarships.ts.

/**
 * The four scholarship levels, each tied to a Stripe coupon (owner, 2 Oct
 * 2026). `code` is looked up as a coupon id first, then as a promotion code —
 * either way the checkout applies the underlying *coupon*, so the public
 * promotion codes can be switched off in Stripe without breaking this.
 */
export const SCHOLARSHIP_LEVELS = [
  { percent: 33, code: 'SCHOLARSHIP33' },
  { percent: 50, code: 'SCHOLARSHIP50' },
  { percent: 67, code: 'SCHOLARSHIP67' },
  { percent: 100, code: 'SCHOLARSHIP100' },
] as const

export type ScholarshipPercent = (typeof SCHOLARSHIP_LEVELS)[number]['percent']

export function isScholarshipPercent(n: unknown): n is ScholarshipPercent {
  return SCHOLARSHIP_LEVELS.some((l) => l.percent === n)
}

export function scholarshipCode(percent: ScholarshipPercent): string {
  return SCHOLARSHIP_LEVELS.find((l) => l.percent === percent)!.code
}

/** What the student owes after the scholarship — Stripe's own rounding (half up on the discount). */
export function discountedCents(amountCents: number, percent: number): number {
  if (amountCents <= 0) return 0
  return amountCents - Math.round((amountCents * percent) / 100)
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export type ScholarshipDecision = 'submitted' | 'offered' | 'not_offered' | 'withdrawn'

// ── Stage ─────────────────────────────────────────────────────────────────────

/**
 * Where a scholarship has got to. Only the decision is stored; everything after
 * the offer is read from the linked registration, so a payment, a withdrawal or
 * a check-in shows up here without anything writing back to the application.
 */
export type ScholarshipStage =
  | 'submitted'
  | 'not_offered'
  | 'withdrawn'
  | 'awaiting_details'
  | 'awaiting_payment'
  | 'confirmed'
  | 'attended'

export interface StageInputs {
  status: ScholarshipDecision
  registration: { status: string } | null
  /** Any participant on the registration has checked in at the event. */
  checkedIn: boolean
}

export function scholarshipStage({ status, registration, checkedIn }: StageInputs): ScholarshipStage {
  if (status !== 'offered') return status
  if (!registration || registration.status === 'withdrawn') return 'awaiting_details'
  if (registration.status === 'confirmed') return checkedIn ? 'attended' : 'confirmed'
  return 'awaiting_payment'
}

/** Staff wording (admin list, member page, roster). */
export const STAGE_LABEL: Record<ScholarshipStage, string> = {
  submitted: 'To review',
  not_offered: 'Not offered',
  withdrawn: 'Withdrawn',
  awaiting_details: 'Offered · awaiting details',
  awaiting_payment: 'Registered · awaiting payment',
  confirmed: 'Accepted · registered',
  attended: 'Accepted · attended',
}

/** The student's wording (account page). */
export const STAGE_LABEL_MEMBER: Record<ScholarshipStage, string> = {
  submitted: 'Received — under review',
  not_offered: 'Not offered this time',
  withdrawn: 'Withdrawn',
  awaiting_details: 'Offered — complete your registration details',
  awaiting_payment: 'Offered — payment outstanding',
  confirmed: 'Accepted — you’re registered',
  attended: 'Accepted — attended',
}

/** Has the student taken up the offer? (Registered and confirmed, or attended.) */
export function stageAccepted(stage: ScholarshipStage): boolean {
  return stage === 'confirmed' || stage === 'attended'
}
