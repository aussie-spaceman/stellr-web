import type { SupabaseClient } from '@supabase/supabase-js'
import { getEventBySlug } from '@/lib/sanity'
import { stripeClient } from '@/lib/stripe'
import { logActivity } from '@/lib/activity-log'
import { SCHOLARSHIP_COLUMNS, formatUsd, type ScholarshipApplication } from '@/lib/scholarships'
import type { Reviewer } from '@/lib/scholarship-offer'

// Cancelling a scholarship offer. Two ways in:
//  - an admin, from the review page, at any stage after the offer;
//  - automatically, when the student's registration is withdrawn. Every
//    withdrawal goes through lib/deletion/execute.ts, which calls in here.
//
// Cancelling ends the offer: the offer link stops working and the checkout
// stops applying the coupon, because both look the offer up by status
// 'offered'. Nothing is charged, refunded or clawed back, and no email goes to
// the student (owner, 30 Oct 2026). An admin cancel on a registration still
// waiting for payment puts the full fee back as the amount due; a confirmed
// student stays registered as they are.

export type CancellationSource = 'admin' | 'withdrawal'

export interface CancelInput {
  source: CancellationSource
  reason?: string | null
  /** The admin cancelling. Omitted for an automatic cancellation. */
  reviewer?: Reviewer | null
}

export type CancelResult =
  | {
      ok: true
      application: ScholarshipApplication
      /** The full fee now due on a pending registration, or null when nothing changed. */
      amountDueRestoredCents: number | null
      /** What happened, for the admin. */
      message: string
    }
  | { ok: false; status: number; error: string }

export const WITHDRAWAL_REASON = 'Withdrew from the event'

export async function cancelScholarship(
  db: SupabaseClient,
  applicationId: string,
  input: CancelInput,
): Promise<CancelResult> {
  const { data } = await db.from('scholarship_applications').select(SCHOLARSHIP_COLUMNS).eq('id', applicationId).maybeSingle()
  const app = (data as ScholarshipApplication | null) ?? null
  if (!app) return { ok: false, status: 404, error: 'Application not found' }
  if (app.status !== 'offered') return { ok: false, status: 409, error: 'Only an offered scholarship can be cancelled' }

  const reason = input.reason?.trim().slice(0, 1000) || (input.source === 'withdrawal' ? WITHDRAWAL_REASON : null)
  const { data: updated, error } = await db
    .from('scholarship_applications')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_source: input.source,
      cancellation_reason: reason,
      cancelled_by: input.reviewer?.clerkUserId ?? null,
      cancelled_by_name: input.reviewer?.name ?? null,
    })
    .eq('id', app.id)
    .eq('status', 'offered')
    .select(SCHOLARSHIP_COLUMNS)
    .maybeSingle()
  if (error || !updated) {
    if (error) console.error('[scholarship] cancel failed:', error.message, { application: app.id })
    return { ok: false, status: 409, error: 'This scholarship changed while you were looking at it — reload and try again' }
  }

  const reg = app.registration_id ? await loadRegistration(db, app.registration_id) : null
  // A withdrawn registration keeps the amount that was due on it, as history.
  const restored = input.source === 'admin' && reg?.status === 'pending' ? await restoreFullFee(db, reg) : null

  if (app.member_id) {
    const event = app.event_title ?? 'their event'
    await logActivity({
      memberId: app.member_id,
      category: 'event',
      action: 'scholarship_cancelled',
      summary:
        input.source === 'withdrawal'
          ? `${app.percent_off}% scholarship for ${event} cancelled: withdrew from the event`
          : `Cancelled the ${app.percent_off}% scholarship for ${event}${reason ? ` — ${reason}` : ''}`,
      metadata: {
        scholarshipId: app.id,
        percent: app.percent_off,
        source: input.source,
        registrationId: app.registration_id,
        amountDueRestoredCents: restored,
      },
      actorType: input.source === 'admin' ? 'admin' : 'system',
      actorLabel: input.reviewer?.name ?? null,
    }, db)
  }

  return {
    ok: true,
    application: updated as ScholarshipApplication,
    amountDueRestoredCents: restored,
    message: cancelledMessage(reg, restored),
  }
}

interface RegistrationLite {
  id: string
  status: string
  event_slug: string
  amount_due_cents: number | null
}

async function loadRegistration(db: SupabaseClient, id: string): Promise<RegistrationLite | null> {
  const { data } = await db.from('registrations').select('id, status, event_slug, amount_due_cents').eq('id', id).maybeSingle()
  return (data as RegistrationLite | null) ?? null
}

/**
 * Puts the undiscounted event fee back as the amount due — the same figure the
 * individual form records (one seat at the event's Stripe price). Returns it,
 * or null when the price can't be read; the checkout charges the full fee
 * either way, since it no longer finds an offer to discount.
 */
async function restoreFullFee(db: SupabaseClient, reg: RegistrationLite): Promise<number | null> {
  const event = await getEventBySlug(reg.event_slug).catch(() => null)
  const priceId = (event as { stripePriceId?: string } | null)?.stripePriceId
  const stripe = stripeClient()
  if (!priceId || !stripe) return null
  let fee: number | null = null
  try {
    fee = (await stripe.prices.retrieve(priceId)).unit_amount ?? null
  } catch (e) {
    console.error('[scholarship] event price lookup failed on cancel (non-fatal):', e)
  }
  if (fee == null) return null
  const { error } = await db
    .from('registrations')
    .update({ amount_due_cents: fee })
    .eq('id', reg.id)
    .eq('status', 'pending')
  if (error) {
    console.error('[scholarship] could not restore the full fee:', error.message, { registration: reg.id })
    return null
  }
  return fee
}

function cancelledMessage(reg: RegistrationLite | null, restored: number | null): string {
  if (!reg || reg.status === 'withdrawn') return 'Scholarship cancelled. The offer link no longer works.'
  if (reg.status === 'pending') {
    return restored != null
      ? `Scholarship cancelled. They’re still registered, and the full fee of ${formatUsd(restored)} is now due.`
      : 'Scholarship cancelled. They’re still registered and their next checkout charges the full fee, but the fee couldn’t be read from Stripe, so the amount due still shows the discounted price.'
  }
  return 'Scholarship cancelled. They stay registered; nothing was charged or refunded.'
}

// ── Withdrawal ────────────────────────────────────────────────────────────────

/**
 * The live offers on a registration. Read before a withdrawal, because a hard
 * delete nulls scholarship_applications.registration_id.
 */
export async function liveScholarshipOffers(db: SupabaseClient, registrationId: string): Promise<string[]> {
  const { data, error } = await db
    .from('scholarship_applications')
    .select('id')
    .eq('registration_id', registrationId)
    .eq('status', 'offered')
  if (error) console.error('[scholarship] live offer lookup failed:', error.message, { registration: registrationId })
  return ((data ?? []) as { id: string }[]).map((r) => r.id)
}

/**
 * Cancels the offers on a registration that has just been withdrawn. Never
 * throws: the withdrawal has already happened, and a failure here is logged
 * rather than undoing it.
 */
export async function cancelScholarshipsOnWithdrawal(
  db: SupabaseClient,
  applicationIds: string[],
): Promise<{ id: string; percent: number | null }[]> {
  const out: { id: string; percent: number | null }[] = []
  for (const id of applicationIds) {
    try {
      const r = await cancelScholarship(db, id, { source: 'withdrawal' })
      if (r.ok) out.push({ id, percent: r.application.percent_off })
      else console.error('[scholarship] cancel on withdrawal refused:', r.error, { application: id })
    } catch (e) {
      console.error('[scholarship] cancel on withdrawal failed:', e, { application: id })
    }
  }
  return out
}
