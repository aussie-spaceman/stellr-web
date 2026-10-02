import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { notFound, redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { getAllEvents, type StellarEvent } from '@/lib/sanity'
import { stripeClient } from '@/lib/stripe'
import { formatDateRange } from '@/lib/utils'
import {
  SCHOLARSHIP_COLUMNS,
  checkScholarshipCoupons,
  scholarshipOfferUrl,
  withStages,
  type ScholarshipApplication,
} from '@/lib/scholarships'
import { ScholarshipStagePill } from '@/components/admin/ScholarshipStagePill'
import {
  ScholarshipReview,
  ScholarshipResendButton,
  ScholarshipRetryRefundButton,
  type ReviewEvent,
  type ReviewMember,
  type ReviewRegistration,
} from '@/components/admin/ScholarshipReview'
import { ScholarshipNotes } from '@/components/admin/ScholarshipNotes'
import { scholarshipRefundFor } from '@/lib/scholarship-refund'
import { formatUsd } from '@/lib/scholarship-levels'

export const metadata = { title: 'Admin — Scholarship application' }
export const dynamic = 'force-dynamic'

const DAY = 24 * 3600 * 1000

/** Members this application could belong to: same email (as member or emergency contact), or same name. */
async function suggestMembers(app: ScholarshipApplication): Promise<ReviewMember[]> {
  const db = supabaseServer()
  const email = app.email.trim().toLowerCase()
  const cols = 'id, first_name, last_name, email, ec_email, membership_id, date_of_birth'
  const [byEmail, byEc, byName] = await Promise.all([
    db.from('members').select(cols).ilike('email', email).is('deleted_at', null).limit(5),
    db.from('members').select(cols).ilike('ec_email', email).is('deleted_at', null).limit(5),
    db.from('members').select(cols).ilike('first_name', app.first_name.trim()).ilike('last_name', app.last_name.trim()).is('deleted_at', null).limit(5),
  ])
  const out = new Map<string, ReviewMember>()
  const add = (rows: unknown[] | null, reason: ReviewMember['reason']) => {
    for (const r of (rows ?? []) as {
      id: string; first_name: string; last_name: string; email: string; ec_email: string | null
      membership_id: string | null; date_of_birth: string | null
    }[]) {
      if (out.has(r.id)) continue
      out.set(r.id, {
        id: r.id,
        name: `${r.first_name} ${r.last_name}`.trim(),
        email: r.email,
        membershipId: r.membership_id,
        profileComplete: !!r.date_of_birth,
        reason,
      })
    }
  }
  add(byEmail.data, 'email')
  add(byEc.data, 'guardian_email')
  add(byName.data, 'name')
  return [...out.values()]
}

/** Registrations the matched members (or the application email) already hold, by event. */
async function existingRegistrations(app: ScholarshipApplication, memberIds: string[]): Promise<ReviewRegistration[]> {
  const db = supabaseServer()
  // Quoted: the address contains '.' and '@', which PostgREST's filter syntax reserves.
  const filters = [`email.ilike."${app.email.trim().toLowerCase().replace(/"/g, '')}"`]
  if (memberIds.length > 0) filters.push(`member_id.in.(${memberIds.join(',')})`)
  const { data } = await db
    .from('participants')
    .select('member_id, email, registrations!inner(id, event_slug, event_title, status, type, amount_due_cents)')
    .or(filters.join(','))
    .neq('registrations.status', 'withdrawn')
  const seen = new Set<string>()
  const out: ReviewRegistration[] = []
  for (const p of (data ?? []) as unknown as {
    member_id: string | null
    registrations: { id: string; event_slug: string; event_title: string; status: string; type: string; amount_due_cents: number | null }
  }[]) {
    const r = p.registrations
    if (!r || seen.has(r.id)) continue
    seen.add(r.id)
    out.push({
      id: r.id,
      eventSlug: r.event_slug,
      eventTitle: r.event_title,
      status: r.status,
      type: r.type,
      amountDueCents: r.amount_due_cents,
      memberId: p.member_id,
    })
  }
  return out
}

/** Upcoming events (plus the one applied for), with their fee for the price preview. */
async function reviewEvents(app: ScholarshipApplication): Promise<ReviewEvent[]> {
  const events: StellarEvent[] = (await getAllEvents().catch(() => [])) ?? []
  const now = Date.now()
  const upcoming = events.filter(
    (e) => e.slug?.current && (!e.date || new Date(e.date).getTime() > now - DAY || e.slug.current === app.event_slug),
  )
  const stripe = stripeClient()
  return Promise.all(
    upcoming.map(async (e) => {
      let feeCents: number | null = null
      if (stripe && e.stripePriceId) {
        const price = await stripe.prices.retrieve(e.stripePriceId).catch(() => null)
        feeCents = price?.unit_amount ?? null
      }
      return {
        slug: e.slug.current,
        title: e.title,
        dateLabel: e.date ? formatDateRange(e.date, e.endDate) : null,
        feeCents,
      }
    }),
  )
}

export default async function ScholarshipApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) redirect('/admin')

  const { id } = await params
  const db = supabaseServer()
  const { data } = await db.from('scholarship_applications').select(SCHOLARSHIP_COLUMNS).eq('id', id).maybeSingle()
  if (!data) notFound()
  const [app] = await withStages(db, [data as ScholarshipApplication])

  const isOpen = app.status === 'submitted'
  const [members, events] = await Promise.all([
    isOpen ? suggestMembers(app) : Promise.resolve([] as ReviewMember[]),
    isOpen ? reviewEvents(app) : Promise.resolve([] as ReviewEvent[]),
  ])
  const registrations = isOpen ? await existingRegistrations(app, members.map((m) => m.id)) : []
  const stripe = stripeClient()
  const couponProblems = isOpen && stripe ? await checkScholarshipCoupons(stripe) : {}

  // The reimbursement, when the student had already paid (retrospective case).
  const refund = app.registration_paid_at_offer && app.registration_id ? await scholarshipRefundFor(db, app.registration_id) : null

  const received = new Date(app.created_at).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })

  return (
    <div className="space-y-6 max-w-content">
      <div>
        <Link href="/admin/scholarships" className="text-sm text-primary hover:text-primary-deep">← Scholarships</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-heading uppercase text-title text-brand-blue-dark">{app.first_name} {app.last_name}</h1>
          <ScholarshipStagePill stage={app.stage} percent={app.percent_off} />
        </div>
        <p className="text-sm text-brand-muted-soft mt-0.5">
          Received {received}{app.source === 'backfill' ? ' · recorded after the fact' : ''}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-6 items-start">
        <section className="rounded-ds-card border border-line bg-white p-6 space-y-4">
          <h2 className="font-display text-lg font-bold text-ink">Application</h2>
          <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-content-body">Email</dt>
            <dd className="text-ink break-all"><a href={`mailto:${app.email}`} className="hover:text-primary">{app.email}</a></dd>
            <dt className="text-content-body">Phone</dt>
            <dd className="text-ink">{app.phone || '—'}</dd>
            <dt className="text-content-body">Activity</dt>
            <dd className="text-ink">{app.activity || '—'}</dd>
            <dt className="text-content-body">School</dt>
            <dd className="text-ink">{app.school || '—'}</dd>
          </dl>
          <div>
            <p className="text-sm text-content-body mb-1">Application brief</p>
            <p className="whitespace-pre-wrap rounded-lg bg-surface px-4 py-3 text-sm text-ink">{app.brief}</p>
          </div>
          <ScholarshipNotes id={app.id} initial={app.admin_notes ?? ''} />
        </section>

        {isOpen ? (
          <ScholarshipReview
            id={app.id}
            applicantEmail={app.email}
            initialEventSlug={app.event_slug}
            events={events}
            members={members}
            registrations={registrations}
            couponProblems={couponProblems}
          />
        ) : (
          <section className="rounded-ds-card border border-line bg-white p-6 space-y-3 text-sm">
            <h2 className="font-display text-lg font-bold text-ink">Decision</h2>
            {app.status === 'offered' ? (
              <>
                <p className="text-ink">
                  <strong>{app.percent_off}% scholarship</strong> for <strong>{app.event_title}</strong>, offered{' '}
                  {app.offered_at ? new Date(app.offered_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                  {app.reviewed_by_name ? ` by ${app.reviewed_by_name}` : ''}.
                </p>
                <p className="text-content-body">
                  Emails {app.offer_emails_sent_at
                    ? `sent ${new Date(app.offer_emails_sent_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                    : 'not sent'}.
                </p>
                {app.registration_paid_at_offer && (
                  <p className={refund?.type === 'manual_required' ? 'text-red-700' : 'text-content-body'}>
                    Already paid when offered.{' '}
                    {!refund || refund.type === 'none'
                      ? 'Nothing to reimburse — they had paid no more than the scholarship price.'
                      : refund.type === 'cash'
                        ? `${formatUsd(refund.refundCents)} refunded to their card in Stripe.`
                        : refund.type === 'credit'
                          ? `${formatUsd(refund.refundCents)} added to their account as credit.`
                          : `${refund.refundCents > 0 ? formatUsd(refund.refundCents) + ' still' : 'Still'} to reimburse manually — ${refund.note ?? 'the refund did not go through'}.`}
                  </p>
                )}
                {refund?.type === 'manual_required' && <ScholarshipRetryRefundButton id={app.id} />}
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {app.member_id && <Link href={`/admin/members/${app.member_id}`} className="text-primary hover:text-primary-deep">Member record →</Link>}
                  {app.event_slug && <Link href={`/admin/competitions/${app.event_slug}`} className="text-primary hover:text-primary-deep">Event roster →</Link>}
                  {app.offer_token && <a href={scholarshipOfferUrl(app.offer_token)} target="_blank" rel="noreferrer" className="text-primary hover:text-primary-deep">Student’s offer page ↗</a>}
                </div>
                <ScholarshipResendButton id={app.id} />
              </>
            ) : (
              <p className="text-ink">
                {app.status === 'not_offered' ? 'Not offered' : 'Withdrawn'}
                {app.reviewed_by_name ? ` by ${app.reviewed_by_name}` : ''}
                {app.reviewed_at ? ` on ${new Date(app.reviewed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}.
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
