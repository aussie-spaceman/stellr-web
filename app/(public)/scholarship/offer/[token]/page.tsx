import type { Metadata } from 'next'
import Link from 'next/link'
import { supabaseServer } from '@/lib/supabase'
import { ensurePayToken, payPageUrl } from '@/lib/registration-checkout'
import {
  findOfferByToken,
  formatUsd,
  scholarshipRegisterUrl,
  withStages,
  type ScholarshipStage,
} from '@/lib/scholarships'

// A scholarship offer's own page — the link in offer emails 1 and 3 and on the
// member's account page. It always shows the one next step, so the student
// never has to work out which email to act on: details first, then payment,
// then "you're registered".

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Your scholarship', robots: { index: false, follow: false } }

const APP_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

interface PageProps {
  params: Promise<{ token: string }>
}

function Step({ n, title, state, children }: { n: number; title: string; state: 'done' | 'current' | 'todo'; children?: React.ReactNode }) {
  const badge =
    state === 'done'
      ? 'bg-enviro-green text-white'
      : state === 'current'
        ? 'bg-primary text-white'
        : 'bg-line-light text-content-faint'
  return (
    <li className="flex gap-3 text-left">
      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${badge}`}>
        {state === 'done' ? '✓' : n}
      </span>
      <div>
        <p className={`font-semibold ${state === 'todo' ? 'text-content-faint' : 'text-ink'}`}>{title}</p>
        {children && <div className="mt-1 text-sm text-content-body">{children}</div>}
      </div>
    </li>
  )
}

export default async function ScholarshipOfferPage({ params }: PageProps) {
  const { token } = await params
  const db = supabaseServer()
  const offer = await findOfferByToken(db, token)

  if (!offer || !offer.event_slug || offer.percent_off == null) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center px-4 py-16">
        <div className="max-w-md w-full text-center">
          <h1 className="text-2xl font-display font-bold text-ink mb-3">This offer link isn&apos;t active</h1>
          <p className="text-content-body mb-6">We couldn&apos;t find an open scholarship offer for this link. Reply to your scholarship email and we&apos;ll sort it out.</p>
          <Link href="/events" className="btn-primary">Browse Events</Link>
        </div>
      </div>
    )
  }

  const [withStage] = await withStages(db, [offer])
  const stage: ScholarshipStage = withStage.stage
  const free = offer.percent_off >= 100

  let due: string | null = null
  let payUrl: string | null = null
  if (stage === 'awaiting_payment' && offer.registration_id) {
    const { data: reg } = await db.from('registrations').select('amount_due_cents').eq('id', offer.registration_id).maybeSingle()
    const cents = (reg as { amount_due_cents: number | null } | null)?.amount_due_cents
    if (cents != null) due = formatUsd(cents)
    payUrl = payPageUrl(offer.event_slug, await ensurePayToken(db, offer.registration_id))
  }

  const detailsDone = stage !== 'awaiting_details'
  const registered = stage === 'confirmed' || stage === 'attended'

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-ds-card shadow-featured p-8 text-center">
          <p className="font-subheading font-semibold uppercase tracking-[0.14em] text-xs text-primary mb-2">
            {offer.percent_off}% scholarship
          </p>
          <h1 className="text-2xl font-display font-bold text-ink mb-2">{offer.event_title}</h1>
          <p className="text-content-body mb-6">
            {registered
              ? <>You&apos;re registered, {offer.first_name}. See you there!</>
              : <>Congratulations, {offer.first_name} — your place is reserved.</>}
          </p>

          <ol className="space-y-4 mb-8">
            <Step n={1} title="Registration details" state={detailsDone ? 'done' : 'current'}>
              {detailsDone
                ? 'Received. Look out for the consent form (DocuSign) — a parent or guardian signs it if you’re under 18.'
                : 'About five minutes. Once they’re in, we email the consent form (DocuSign).'}
            </Step>
            {!free && (
              <Step n={2} title={due ? `Payment — ${due}` : 'Payment'} state={registered ? 'done' : detailsDone ? 'current' : 'todo'}>
                {registered ? 'Paid.' : 'Your scholarship is already applied — no code needed.'}
              </Step>
            )}
          </ol>

          {stage === 'awaiting_details' && (
            <a href={scholarshipRegisterUrl(offer.event_slug, token)} className="btn-primary">Complete my registration</a>
          )}
          {stage === 'awaiting_payment' && payUrl && (
            <a href={payUrl} className="btn-primary">{due ? `Pay ${due}` : 'Pay now'}</a>
          )}
          {registered && (
            <a href={`${APP_URL}/account`} className="btn-primary">Open my account</a>
          )}
        </div>
      </div>
    </div>
  )
}
