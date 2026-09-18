import type { Metadata } from 'next'
import Link from 'next/link'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import { registrationIsOpen } from '@/lib/registration'
import { maskEmail } from '@/lib/utils'
import PayNowButton from './PayNowButton'

// The durable "pay later" page for a registration created without payment.
// Reached from the pay-link email, and from Stripe's cancel URL — so a parent
// who closes checkout lands on "your place is still saved" instead of a blank
// form. Reveals only what the payer needs: first name, event, seats, amount.

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { robots: { index: false, follow: false } }

interface PageProps {
  params: Promise<{ slug: string; token: string }>
  searchParams: Promise<{ cancelled?: string }>
}

const APP_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

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

export default async function RegistrationPayPage({ params, searchParams }: PageProps) {
  const { slug, token } = await params
  const { cancelled } = await searchParams

  const db = supabaseServer()
  const { data: regRow, error } = await db
    .from('registrations')
    .select('id, event_slug, event_title, type, status, amount_due_cents, invoice_requested, member_pays_individually, adult_count, student_count, teacher_first_name, teacher_email')
    .eq('pay_token', token)
    .eq('event_slug', slug)
    .maybeSingle()
  if (error) console.error('[register/pay] token lookup error:', error)

  const reg = regRow as {
    id: string; event_slug: string; event_title: string
    type: 'individual' | 'group' | 'campaign'
    status: 'pending' | 'confirmed' | 'withdrawn'
    amount_due_cents: number | null
    invoice_requested: boolean; member_pays_individually: boolean
    adult_count: number | null; student_count: number | null
    teacher_first_name: string | null; teacher_email: string | null
  } | null

  if (error || !reg) {
    return (
      <Shell icon="🔗" title="This link isn't valid">
        <p className="text-content-body mb-6">We couldn&apos;t find a registration for this link. If you copied it from an email, check it&apos;s complete — or reply to that email and we&apos;ll sort it out.</p>
        <Link href="/events" className="btn-primary">Browse Events</Link>
      </Shell>
    )
  }

  if (reg.status === 'confirmed') {
    return (
      <Shell icon="✅" title="Already paid — nothing to do">
        <p className="text-content-body mb-6">This registration for <strong>{reg.event_title}</strong> is confirmed. Your confirmation email has the details; you can also see it under Account → Billing.</p>
        <a href={`${APP_URL}/account?tab=billing`} className="btn-primary">Open my account</a>
      </Shell>
    )
  }

  if (reg.status === 'withdrawn') {
    return (
      <Shell icon="↩️" title="This registration was withdrawn">
        <p className="text-content-body mb-6">There&apos;s nothing to pay. If you&apos;d like to take part in <strong>{reg.event_title}</strong> after all, you can register again.</p>
        <Link href={`/register/${slug}`} className="btn-primary">Register again</Link>
      </Shell>
    )
  }

  if (reg.invoice_requested || reg.member_pays_individually || reg.type === 'campaign') {
    return (
      <Shell icon="🧾" title="This registration isn't paid here">
        <p className="text-content-body mb-6">
          {reg.invoice_requested
            ? 'This group is paid by invoice — check the organiser’s inbox for the Stripe invoice, or reply to it if it hasn’t arrived.'
            : 'Each member of this group pays for their own place from the link in their email.'}
        </p>
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

  // Who and how much — first name only.
  let firstName = reg.teacher_first_name?.trim() ?? ''
  let emailForNote = reg.teacher_email ?? ''
  const seats = (reg.adult_count ?? 0) + (reg.student_count ?? 0)
  if (reg.type === 'individual') {
    const { data: partRow } = await db
      .from('participants')
      .select('first_name, email')
      .eq('registration_id', reg.id)
      .limit(1)
      .maybeSingle()
    const p = partRow as { first_name: string; email: string } | null
    firstName = p?.first_name?.trim() ?? ''
    emailForNote = p?.email ?? ''
  }
  const amountLabel = `$${((reg.amount_due_cents ?? 0) / 100).toFixed(2)}`

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full">
        {cancelled === '1' && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 mb-6">
            Your registration is still saved — pay whenever you&apos;re ready.
            {emailForNote && <> We&apos;ve emailed this link to {maskEmail(emailForNote)} so you can come back to it later.</>}
          </div>
        )}
        <div className="bg-white rounded-ds-card shadow-featured p-8 text-center">
          <p className="font-subheading font-semibold uppercase tracking-[0.14em] text-xs text-primary mb-2">Complete your registration</p>
          <h1 className="text-2xl font-display font-bold text-ink mb-2">{reg.event_title}</h1>
          <p className="text-content-body mb-6">
            {reg.type === 'individual'
              ? <>Registration for <strong>{firstName || 'you'}</strong></>
              : <>{firstName ? `${firstName}’s group` : 'Group registration'}{seats > 0 ? ` — ${seats} ${seats === 1 ? 'place' : 'places'}` : ''}</>}
          </p>
          <div className="bg-surface rounded-lg px-4 py-3 mb-6">
            <div className="text-xs uppercase tracking-wide text-content-body">Amount due</div>
            <div className="text-3xl font-display font-bold text-ink">{amountLabel}</div>
          </div>
          <PayNowButton token={token} amountLabel={amountLabel} />
          <p className="text-xs text-content-body mt-6">
            Secure payment by Stripe. Your place is confirmed as soon as payment goes through, and a confirmation email follows.
          </p>
        </div>
      </div>
    </div>
  )
}
