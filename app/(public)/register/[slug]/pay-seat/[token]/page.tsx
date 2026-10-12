import type { Metadata } from 'next'
import Link from 'next/link'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import { registrationIsOpen } from '@/lib/registration'
import { maskEmail } from '@/lib/utils'
import { stripeClient } from '@/lib/stripe'
import PayNowButton from '../../pay/[token]/PayNowButton'

// The durable "pay your seat" page for a "members pay individually" participant
// (deep review PAY-8). Reached from the per-seat payment email and Stripe's
// cancel URL, keyed on participants.pay_token — so a participant (often a
// sheet-added student with no member account) whose 24h Checkout link expired
// always has a working way back. Mirrors the registration pay page; reveals only
// first name, event and amount. The Checkout is minted on click, never embedded.

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { robots: { index: false, follow: false } }

interface PageProps {
  params: Promise<{ slug: string; token: string }>
  searchParams: Promise<{ cancelled?: string }>
}

function Shell({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full text-center">
        <div className="text-5xl mb-4" aria-hidden>{icon}</div>
        <h1 className="text-2xl font-display font-bold text-ink mb-3">{title}</h1>
        {children}
      </div>
    </div>
  )
}

export default async function SeatPayPage({ params, searchParams }: PageProps) {
  const { slug, token } = await params
  const { cancelled } = await searchParams

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

  if (error || !participant) {
    return (
      <Shell icon="🔗" title="This link isn't valid">
        <p className="text-content-body mb-6">We couldn&apos;t find a seat for this link. If you copied it from an email, check it&apos;s complete — or reply to that email and we&apos;ll sort it out.</p>
        <Link href="/events" className="btn-primary">Browse Events</Link>
      </Shell>
    )
  }

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

  const { data: regRow } = await db
    .from('registrations')
    .select('event_slug, event_title, member_pays_individually')
    .eq('id', participant.registration_id)
    .maybeSingle()
  const reg = regRow as { event_slug: string; event_title: string; member_pays_individually: boolean } | null

  if (!reg || !reg.member_pays_individually) {
    return (
      <Shell icon="🧾" title="This seat isn't paid here">
        <p className="text-content-body mb-6">This registration isn&apos;t paid per person. Reply to your registration email if you think that&apos;s wrong.</p>
        <Link href="/events" className="btn-primary">Browse Events</Link>
      </Shell>
    )
  }

  const event = await getEventBySlug(slug).catch(() => null)
  if (event && !registrationIsOpen(event)) {
    return (
      <Shell icon="⏰" title="Registration has closed">
        <p className="text-content-body mb-6">Registration for <strong>{reg.event_title}</strong> is no longer open, so this payment link has stopped working. Reply to your registration email if you think that&apos;s a mistake.</p>
        <Link href="/events" className="btn-primary">Browse Events</Link>
      </Shell>
    )
  }

  // Resolve the per-seat fee to display (server-side, read-only). Non-fatal: if
  // the price can't be read we still show the button — the amount is confirmed on
  // the Stripe Checkout page itself.
  let amountLabel = ''
  const stripePriceId = (event as { stripePriceId?: string } | null)?.stripePriceId ?? null
  const stripe = stripeClient()
  if (stripePriceId && stripe) {
    try {
      const price = await stripe.prices.retrieve(stripePriceId)
      if (price.unit_amount) amountLabel = `$${(price.unit_amount / 100).toFixed(2)}`
    } catch (e) {
      console.error('[register/pay-seat] price lookup failed (non-fatal):', e)
    }
  }

  const firstName = participant.first_name?.trim() ?? ''
  const emailForNote = participant.email ?? ''

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4 py-16">
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
          {amountLabel && (
            <div className="bg-surface rounded-lg px-4 py-3 mb-6">
              <div className="text-xs uppercase tracking-wide text-content-body">Amount due</div>
              <div className="text-3xl font-display font-bold text-ink">{amountLabel}</div>
            </div>
          )}
          <PayNowButton token={token} amountLabel={amountLabel} endpoint="/api/register/pay-seat" />
          <p className="text-xs text-content-body mt-6">
            Secure payment by Stripe. Your place is confirmed as soon as payment goes through, and a confirmation email follows.
          </p>
        </div>
      </div>
    </div>
  )
}
