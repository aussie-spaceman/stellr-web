import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Check, Clock, UserCheck, CalendarPlus, XCircle } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { getRequestById } from '@/lib/coaching-requests'
import { formatSessionTime } from '@/lib/mentoring-format'
import { googleCalendarUrl } from '@/lib/calendar'

export const metadata = { title: 'Coaching · Your request' }

const TEAL = '#0E8C99'

export default async function CoachingRequestStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const { id } = await params
  const req = await getRequestById(id)
  if (!req) notFound()
  // Members can only see their own request; admins may view any.
  if (req.memberId !== member.id && !member.isAdmin) notFound()

  return (
    <div className="mx-auto max-w-content space-y-6">
      <Link
        href="/community/coaching"
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-content-muted hover:text-primary"
      >
        <ArrowLeft size={15} /> Your coaching
      </Link>

      {req.status === 'pending' && <PendingState topic={req.topic} />}
      {req.status === 'matched' && <MatchedState id={req.id} coachName={req.coachName} eligibility={req.eligibility} />}
      {req.status === 'scheduled' && <ScheduledState req={req} />}
      {req.status === 'declined' && <DeclinedState reason={req.declineReason} />}
    </div>
  )
}

function Banner({ tint, ink, icon, title, sub }: { tint: string; ink: string; icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="overflow-hidden rounded-panel border border-line bg-white shadow-card-lift">
      <div className="flex flex-col items-center px-6 py-10 text-center" style={{ background: tint }}>
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90" style={{ color: ink }}>
          {icon}
        </span>
        <h1 className="mt-4 font-display text-[26px] font-bold" style={{ color: ink }}>
          {title}
        </h1>
        <p className="mt-1.5 max-w-md text-[14.5px]" style={{ color: ink, opacity: 0.85 }}>
          {sub}
        </p>
      </div>
    </div>
  )
}

function PendingState({ topic }: { topic: string }) {
  return (
    <>
      <Banner
        tint="#E3F6F8"
        ink={TEAL}
        icon={<Clock size={24} />}
        title="Request received"
        sub="We’ll match you with a coach and email you within two working days."
      />
      <div className="rounded-panel border border-line bg-white p-6">
        <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-content-faint">Your request</p>
        <p className="mt-2 text-[15px] leading-relaxed text-ink">{topic}</p>
        <span className="mt-4 inline-flex items-center gap-1.5 rounded-pill bg-[#FDEFD6] px-3 py-1 text-[12px] font-bold text-brand-gold-ink">
          <Clock size={12} /> Pending match
        </span>
      </div>
    </>
  )
}

function MatchedState({ id, coachName, eligibility }: { id: string; coachName: string | null; eligibility: string | null }) {
  const costLine =
    eligibility === 'paid'
      ? 'Payment is taken securely at booking — the price is shown before you confirm.'
      : 'This session is included — no payment needed. Just pick a time.'
  return (
    <>
      <Banner
        tint="#EAF0FF"
        ink="#2C53C6"
        icon={<UserCheck size={24} />}
        title="You’ve been matched"
        sub={`${coachName ?? 'A Stellr coach'} is ready to work with you. Pick a time to meet.`}
      />
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-panel border border-line bg-white p-6">
        <p className="max-w-md text-[14.5px] leading-relaxed text-content-secondary">{costLine}</p>
        <Link
          href={`/community/coaching/request/${id}/book`}
          className="inline-flex items-center gap-2 rounded-control px-6 py-3 text-sm font-semibold text-white"
          style={{ background: TEAL }}
        >
          Book your session
        </Link>
      </div>
    </>
  )
}

function ScheduledState({
  req,
}: {
  req: { coachName: string | null; session: { start: string; end: string | null; joinUrl: string | null } | null; topic: string }
}) {
  const s = req.session
  const when = s ? formatSessionTime(s.start, s.end, 'America/Chicago') : null
  const gcal = s
    ? googleCalendarUrl({
        title: `Coaching with ${req.coachName ?? 'your Stellr coach'}`,
        start: new Date(s.start),
        end: s.end ? new Date(s.end) : new Date(new Date(s.start).getTime() + 30 * 60_000),
        details: `Coaching session — ${req.topic}`,
        location: s.joinUrl ?? undefined,
      })
    : null
  return (
    <>
      <Banner
        tint="#E4F7EE"
        ink="#0F8A5F"
        icon={<Check size={24} />}
        title="You’re booked"
        sub={
          when
            ? `Coaching with ${req.coachName ?? 'your coach'} · ${when.dateShort} · ${when.timeLine}`
            : `Coaching with ${req.coachName ?? 'your coach'} is confirmed.`
        }
      />
      <div className="rounded-panel border border-line bg-white p-6">
        <p className="text-sm font-bold text-ink">What happens next</p>
        <ol className="mt-3 space-y-2 text-[14.5px] text-content-secondary">
          <li>1. A receipt & calendar invite are on their way to your inbox.</li>
          <li>2. Join from your coaching workshop when it’s time.</li>
          <li>3. Bring one real question to make the most of the session.</li>
        </ol>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/community/coaching"
            className="inline-flex items-center gap-2 rounded-control px-5 py-2.5 text-sm font-semibold text-white"
            style={{ background: TEAL }}
          >
            Go to your coaching
          </Link>
          {gcal && (
            <a
              href={gcal}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-control border border-line px-5 py-2.5 text-sm font-semibold text-content-secondary hover:border-content-faint"
            >
              <CalendarPlus size={16} /> Add to calendar
            </a>
          )}
        </div>
      </div>
    </>
  )
}

function DeclinedState({ reason }: { reason: string | null }) {
  return (
    <>
      <Banner
        tint="#F6EDED"
        ink="#B4443B"
        icon={<XCircle size={24} />}
        title="We couldn’t match you right now"
        sub={reason ?? 'We weren’t able to match your coaching request at this time.'}
      />
      <div className="flex flex-wrap gap-3 rounded-panel border border-line bg-white p-6">
        <Link href="/membership" className="inline-flex items-center gap-2 rounded-control bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-deep">
          Explore membership tiers
        </Link>
        <Link href="/competitions" className="inline-flex items-center gap-2 rounded-control border-2 border-primary px-5 py-2.5 text-sm font-semibold text-primary hover:bg-primary hover:text-white">
          Earn it by competing
        </Link>
      </div>
    </>
  )
}
