import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, ClipboardList, Users, CalendarCheck } from 'lucide-react'
import { Eyebrow } from '@stellr/web-ui'
import { CoachingRequestForm } from '@/components/academy/CoachingRequestForm'

export const metadata: Metadata = {
  title: 'Request a coaching session',
  description:
    'Tell us what you want to work on and we’ll match you with a Stellr coach for private 1:1 support — included with top tiers, earned by competing, or available to purchase.',
}

const steps = [
  { Icon: ClipboardList, title: 'Tell us your goal', body: 'Share what you want to work on and when you’re free.' },
  { Icon: Users, title: 'We match a coach', body: 'Our team pairs you with a professional and emails you within two working days.' },
  { Icon: CalendarCheck, title: 'Book & meet', body: 'Pick a time — included with your tier, earned by competing, or pay per session.' },
]

export default function CoachingRequestPage() {
  return (
    <section className="section-padding bg-surface">
      <div className="container-max">
        <Link
          href="/academy"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-content-muted hover:text-[#0E8C99]"
        >
          <ArrowLeft size={15} /> Back to the Academy
        </Link>

        <div className="mt-6 grid grid-cols-1 gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          {/* Left — context */}
          <div>
            <Eyebrow className="text-[#0E8C99]">Coaching · 1:1</Eyebrow>
            <h1 className="mt-3 text-4xl font-bold leading-tight text-ink">Request a coaching session</h1>
            <p className="mt-4 leading-relaxed text-content-secondary">
              Coaching is private and personal — a professional matched to your goals, working with you directly.
              Tell us what you’d like to work on and we’ll pair you with the right coach.
            </p>
            <ol className="mt-8 space-y-5">
              {steps.map((s, i) => (
                <li key={s.title} className="flex gap-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E3F6F8] text-[#0E8C99]">
                    <s.Icon size={20} />
                  </span>
                  <div>
                    <p className="font-bold text-ink">
                      <span className="text-[#0E8C99]">{i + 1}.</span> {s.title}
                    </p>
                    <p className="mt-0.5 text-[14.5px] leading-relaxed text-content-secondary">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-8 rounded-panel border border-line bg-white p-4 text-[13.5px] leading-relaxed text-content-muted shadow-card-lift">
              Coaching is included with our top membership tiers and can be earned by competing. If neither applies,
              you can pay per session at booking — pricing is shown before you confirm.
            </p>
          </div>

          {/* Right — form */}
          <div className="rounded-panel border border-line bg-white p-7 shadow-card-lift sm:p-8">
            <CoachingRequestForm />
          </div>
        </div>
      </div>
    </section>
  )
}
