import Link from 'next/link'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/events/repo'
import { maskEmail } from '@/lib/utils'
import { stripeClient } from '@/lib/stripe'
import PayNowButton from '../../pay/[token]/PayNowButton'
import SharedSeatPay from './SharedSeatPay'
import { loadShareGroup, summarise } from '@/lib/teacher-share'
import { MoneyBackGuarantee } from '@/components/ui/MoneyBackGuarantee'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// The durable "pay your seat" page for a "members pay individually" participant
// (deep review PAY-8). Reached from the per-seat payment email and Stripe's
// cancel URL, keyed on participants.pay_token — so a participant (often a
// sheet-added student with no member account) whose 24h Checkout link expired
// always has a working way back. Mirrors the registration pay page; reveals only
// first name, event and amount. The Checkout is minted on click, never embedded.
//
// Shared by Stellr's page and the tenant tree's, as join-body is: a plain function
// called by each page's own return.

function Shell({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface flex items-start justify-center px-4 py-10 sm:py-16">
      <div className="max-w-md w-full text-center">
        <div className="text-5xl mb-4" aria-hidden>{icon}</div>
        <h1 className="text-2xl font-display font-bold text-ink mb-3">{title}</h1>
        {children}
      </div>
    </div>
  )
}

export async function seatPayBody({
  slug,
  token,
  cancelled,
  ownedHere,
}: {
  slug: string
  token: string
  cancelled?: string
  /**
   * S5 A7: whether a seat whose registration has this tenant_id belongs on this host.
   * Stellr's page passes it. The tenant tree has already checked its own
   * (lib/tenancy/tenant-records).
   */
  ownedHere?: (tenantId: string | null | undefined) => boolean
}) {
  const db = supabaseServer()
  const { data: partRow, error } = await db
    .from('participants')
    .select('id, first_name, email, registration_id, individual_payment_status')
    .eq('pay_token', token)
    .maybeSingle()
  if (error) console.error('[register/pay-seat] token lookup error:', error)

  const participant = partRow as {
    id: string
    first_name: string | null
    email: string | null
    registration_id: string
    individual_payment_status: string | null
  } | null

  const invalid = (
    <Shell icon="🔗" title="This link isn't valid">
      <p className="text-content-body mb-6">We couldn&apos;t find a seat for this link. If you copied it from an email, check it&apos;s complete — or reply to that email and we&apos;ll sort it out.</p>
      <Link href="/events" className="btn-primary">Browse Events</Link>
    </Shell>
  )
  if (error || !participant) return invalid

  // S5 A7: the seat's registration is read first, so on Stellr's page another
  // tenant's seat gets the unknown link's page before anything about it is shown.
  const { data: regRow } = await db
    .from('registrations')
    .select('event_slug, event_title, member_pays_individually, share_estimate, tenant_id')
    .eq('id', participant.registration_id)
    .maybeSingle()
  const reg = regRow as {
    event_slug: string
    event_title: string
    member_pays_individually: boolean
    share_estimate: number | null
    tenant_id?: string | null
  } | null
  if (reg && ownedHere && !ownedHere(reg.tenant_id)) return invalid

  if (participant.individual_payment_status === 'paid') {
    return (
      <Shell icon="✅" title="Already paid — nothing to do">
        <p className="text-content-body mb-6">Your place is confirmed. Your confirmation email has the details.</p>
        <Link href="/events" className="btn-primary">Browse Events</Link>
      </Shell>
    )
  }

  if (participant.individual_payment_status === 'waived') {
    return (
      <Shell icon="✅" title="You're all set">
        <p className="text-content-body mb-6">There&apos;s no payment due for your place — you&apos;re registered.</p>
        <Link href="/events" className="btn-primary">Browse Events</Link>
      </Shell>
    )
  }

  // A pending seat is owed by its own link: an individually paid group, or a split
  // one where this person pays their own way ("Invoice for some").
  if (!reg || (!reg.member_pays_individually && participant.individual_payment_status !== 'pending')) {
    return (
      <Shell icon="🧾" title="Nothing to pay here">
        <p className="text-content-body mb-6">This group now pays together, so nothing is due from you. Questions? Ask your group&apos;s organizer or reply to your registration email.</p>
        <Link href="/events" className="btn-primary">Browse Events</Link>
      </Shell>
    )
  }

  const event = await getEventBySlug(slug).catch(() => null)

  // Resolve the per-seat fee to display (server-side, read-only). Non-fatal: if
  // the price can't be read we still show the button — the amount is confirmed on
  // the Stripe Checkout page itself.
  let amountLabel = ''
  let listCents = 0
  const stripePriceId = (event as { stripePriceId?: string } | null)?.stripePriceId ?? null
  const stripe = stripeClient()
  if (stripePriceId && stripe) {
    try {
      const price = await stripe.prices.retrieve(stripePriceId)
      if (price.unit_amount) {
        listCents = price.unit_amount
        amountLabel = `$${(price.unit_amount / 100).toFixed(2)}`
      }
    } catch (e) {
      console.error('[register/pay-seat] price lookup failed (non-fatal):', e)
    }
  }

  // A group sharing the teacher's cost: the place plus the student's share (read
  // only here; the checkout recomputes it). A code is entered on this page. S5 A7:
  // a Stellr payment option, so only on Stellr's registrations; a tenant's seat
  // takes no payment until S9 (app/api/register/pay-seat).
  const shared = (reg.tenant_id ?? STELLR_TENANT_ID) === STELLR_TENANT_ID && reg.share_estimate != null
    ? await loadShareGroup(db, participant.registration_id).catch(() => null)
    : null
  const shareCents = shared ? summarise(shared.reg, shared.people).shareCents : 0
  const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

  const firstName = participant.first_name?.trim() ?? ''
  const emailForNote = participant.email ?? ''

  return (
    <div className="bg-surface flex items-start justify-center px-4 py-10 sm:py-16">
      <div className="max-w-md w-full">
        {cancelled === '1' && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 mb-6">
            Your place is still saved — pay whenever you&apos;re ready.
            {emailForNote && <> We&apos;ve emailed this link to {maskEmail(emailForNote)} so you can come back to it later.</>}
          </div>
        )}
        <div className="bg-white rounded-ds-card shadow-featured p-8 text-center">
          <p className="font-subheading font-semibold uppercase tracking-[0.14em] text-xs text-primary mb-2">Complete your registration</p>
          <h1 className="text-2xl font-display font-bold text-ink mb-2">{reg.event_title}</h1>
          <p className="text-content-body mb-6">
            Payment for <strong>{firstName || 'your place'}</strong>
          </p>
          {shared && listCents > 0 ? (
            <>
              <dl className="bg-surface rounded-lg px-4 py-3 mb-4 space-y-1 text-sm text-left">
                <div className="flex justify-between gap-4"><dt>Your place</dt><dd>{usd(listCents)}</dd></div>
                {shareCents > 0 && (
                  <div className="flex justify-between gap-4"><dt>Your share of the teacher’s cost</dt><dd>{usd(shareCents)}</dd></div>
                )}
                <div className="flex justify-between gap-4 border-t border-line pt-1 font-semibold text-ink"><dt>Amount due</dt><dd>{usd(listCents + shareCents)}</dd></div>
              </dl>
              {shareCents > 0 && (
                <p className="text-xs text-content-body mb-6 text-left">
                  The teacher’s cost is split evenly across the group’s students, and your share can only go down. If more students join after you pay, the difference comes back to you after the event.
                </p>
              )}
              <SharedSeatPay token={token} totalLabel={usd(listCents + shareCents)} />
            </>
          ) : (
            <>
              {amountLabel && (
                <div className="bg-surface rounded-lg px-4 py-3 mb-6">
                  <div className="text-xs uppercase tracking-wide text-content-body">Amount due</div>
                  <div className="text-3xl font-display font-bold text-ink">{amountLabel}</div>
                </div>
              )}
              <PayNowButton token={token} amountLabel={amountLabel} endpoint="/api/register/pay-seat" />
            </>
          )}
          {/* S5 A7: Stellr's promise, so only on Stellr's registrations. */}
          {(reg.tenant_id ?? STELLR_TENANT_ID) === STELLR_TENANT_ID && (
            <MoneyBackGuarantee variant="compact" className="mt-5 justify-center text-left" />
          )}
          <p className="text-xs text-content-body mt-4">
            Secure payment by Stripe. Your place is confirmed as soon as payment goes through, and a confirmation email follows.
          </p>
        </div>
      </div>
    </div>
  )
}
