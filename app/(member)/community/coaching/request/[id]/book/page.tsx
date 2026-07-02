import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { getRequestById } from '@/lib/coaching-requests'
import { getAvailability } from '@/lib/sessions'
import { getAcademyDiscountPercent, discountCents } from '@/lib/academy-discount'

export const metadata = { title: 'Coaching · Book your session' }

const SESSION_PRICE_CENTS = Number(process.env.COACHING_SESSION_PRICE_CENTS) || 4000
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

export default async function CoachingBookPage({ params }: { params: Promise<{ id: string }> }) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const { id } = await params
  const req = await getRequestById(id)
  if (!req || req.memberId !== member.id) notFound()
  // Already booked → show the confirmation instead.
  if (req.status === 'scheduled') redirect(`/community/coaching/request/${id}`)
  if (req.status !== 'matched') redirect(`/community/coaching/request/${id}`)

  const isPaid = req.eligibility === 'paid'
  const priceLabel = isPaid ? usd(discountCents(SESSION_PRICE_CENTS, await getAcademyDiscountPercent(member.activeTierIds))) : null

  // Offer the coach's availability windows as concrete slots to pick from (with a
  // free-time fallback in the form). Coaching or both-type windows only.
  const windows = req.coachId
    ? (await getAvailability(req.coachId))
        .filter((w) => w.session_type === 'coaching' || w.session_type === 'both')
        .map((w) => ({ weekday: w.weekday, startMinute: w.start_minute, endMinute: w.end_minute }))
    : []

  // Lazy import to keep the form a client island.
  const { CoachingBookForm } = await import('@/components/community/coaching/CoachingBookForm')

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Link
        href={`/community/coaching/request/${id}`}
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-content-muted hover:text-primary"
      >
        <ArrowLeft size={15} /> Back
      </Link>

      <header>
        <p className="font-subheading text-[13px] font-semibold uppercase tracking-[0.13em] text-[#0E8C99]">
          Academy · Coaching
        </p>
        <h1 className="mt-1 font-display text-[30px] font-bold leading-tight tracking-[-0.02em] text-ink">
          Book your session
        </h1>
        <p className="mt-1.5 text-[15px] text-content-secondary">
          1:1 with {req.coachName ?? 'your Stellr coach'} · {req.topic}
        </p>
      </header>

      <div className="rounded-panel border border-line bg-white p-6 shadow-card-lift">
        <CoachingBookForm requestId={id} isPaid={isPaid} priceLabel={priceLabel} windows={windows} />
      </div>
    </div>
  )
}
