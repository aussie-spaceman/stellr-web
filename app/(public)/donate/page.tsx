import type { Metadata } from 'next'
import Link from 'next/link'
import { Heart, Users, Rocket, ArrowRight } from 'lucide-react'
import { getFeaturedTestimonials } from '@/lib/sanity'

export const metadata: Metadata = {
  title: 'Donate',
  description: 'Support the next generation of STEM leaders. Your contribution funds scholarships, resources, and access for students who would otherwise miss out.',
}

export const revalidate = 3600

const DONATION_URL = process.env.NEXT_PUBLIC_DONATION_URL ?? null

const impactItems = [
  {
    icon: Rocket,
    title: 'Fund a student place',
    body: 'Your donation directly subsidises participation costs for students from under-resourced schools.',
  },
  {
    icon: Users,
    title: 'Support event delivery',
    body: 'Helps cover venue, materials, and professional mentors for every Stellr competition.',
  },
  {
    icon: Heart,
    title: 'Build the next generation',
    body: '90%+ of Stellr participants go on to study STEM at college — your investment compounds.',
  },
]

interface Testimonial {
  _id: string
  quote: string
  author: string
  role: string
  event?: string
}

export default async function DonatePage() {
  const testimonialsData = await getFeaturedTestimonials().catch(() => null)
  const donorTestimonials: Testimonial[] = (testimonialsData ?? []).filter(
    (t: Testimonial) => t.role === 'Donor'
  )

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="bg-brand-navy text-white py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto max-w-3xl">
          <h1 className="text-4xl sm:text-5xl font-bold mb-6">
            Support the next generation of STEM leaders.
          </h1>
          <p className="text-lg text-gray-300 mb-8 max-w-2xl">
            Stellr events are made possible by the generous support of donors and sponsors. Your contribution funds scholarships, resources, and access for students who would otherwise miss out.
          </p>
          {DONATION_URL ? (
            <a
              href={DONATION_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary text-base px-8 py-4"
            >
              Make a Donation <ArrowRight size={16} className="ml-1 inline" />
            </a>
          ) : (
            <div className="inline-flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <span className="inline-block px-8 py-4 rounded-lg bg-white/10 text-gray-300 text-base font-semibold cursor-not-allowed">
                Donation Portal Coming Soon
              </span>
              <span className="text-sm text-gray-400">
                In the meantime, <a href="/contact?type=sponsorship" className="text-blue-300 hover:text-white underline">contact us</a> to discuss giving.
              </span>
            </div>
          )}
        </div>
      </section>

      {/* ── Impact ───────────────────────────────────────────────────── */}
      <section className="section-padding">
        <div className="container-max">
          <h2 className="text-3xl font-bold text-brand-navy text-center mb-12">Your Impact</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {impactItems.map((item) => (
              <div key={item.title} className="text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-blue-50 mb-4">
                  <item.icon size={28} className="text-brand-blue" />
                </div>
                <h3 className="text-xl font-bold text-brand-navy mb-2">{item.title}</h3>
                <p className="text-brand-grey-dark leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stat banner ──────────────────────────────────────────────── */}
      <section className="bg-brand-blue text-white section-padding">
        <div className="container-max">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
            {[
              { stat: '90%+', label: 'of participants go on to study STEM at college' },
              { stat: 'US-wide', label: 'competitions across multiple states every year' },
              { stat: '100%', label: 'of donations go directly to event delivery and scholarships' },
            ].map((item) => (
              <div key={item.stat}>
                <p className="text-4xl font-bold">{item.stat}</p>
                <p className="mt-2 text-blue-100 text-sm">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Donor testimonials ───────────────────────────────────────── */}
      {donorTestimonials.length > 0 && (
        <section className="section-padding bg-brand-grey-light">
          <div className="container-max max-w-3xl">
            <h2 className="text-2xl font-bold text-brand-navy mb-8 text-center">From Our Donors</h2>
            <div className="space-y-6">
              {donorTestimonials.map((t) => (
                <blockquote key={t._id} className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
                  <p className="text-brand-grey-dark italic">&ldquo;{t.quote}&rdquo;</p>
                  <footer className="mt-3 text-sm font-semibold text-brand-navy">
                    — {t.author}{t.event ? `, ${t.event}` : ''}
                  </footer>
                </blockquote>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Tax receipt note ─────────────────────────────────────────── */}
      <section className="section-padding">
        <div className="container-max max-w-2xl mx-auto text-center">
          <p className="text-brand-grey-dark text-sm bg-brand-grey-light rounded-xl p-4 border border-gray-200">
            <strong>Tax receipts:</strong> Donors receive an email receipt for tax purposes following their contribution.
            For questions about donation processing, contact{' '}
            <a href="mailto:david.shaw@insimeducation.com" className="text-brand-blue hover:underline">
              david.shaw@insimeducation.com
            </a>.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-4">
            {DONATION_URL ? (
              <a href={DONATION_URL} target="_blank" rel="noopener noreferrer" className="btn-primary text-base px-8 py-4">
                Donate Now
              </a>
            ) : (
              <Link href="/contact?type=sponsorship" className="btn-primary text-base px-8 py-4">
                Contact Us About Giving
              </Link>
            )}
            <Link href="/why-stellr#donor" className="btn-secondary text-base px-8 py-4">
              Why Support Stellr?
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
