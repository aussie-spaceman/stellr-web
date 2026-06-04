import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Users, Trophy, Rocket } from 'lucide-react'
import { getFeaturedEvents, getFeaturedTestimonials } from '@/lib/sanity'
import { EventCard } from '@/components/ui/EventCard'
import { TestimonialCarousel } from '@/components/sections/TestimonialCarousel'
import { SubscribeForm } from '@/components/forms/SubscribeForm'

export const metadata: Metadata = {
  title: 'Real-World STEM Competitions | Stellr Education',
  description:
    'Stellr connects middle and high school students with industry professionals through high-tempo design competitions across the US.',
}

// Revalidate every 60 minutes
export const revalidate = 3600

const roleCards = [
  { label: 'Student', icon: '🎓', href: '/why-stellr#student' },
  { label: 'Teacher', icon: '📚', href: '/why-stellr#teacher' },
  { label: 'Parent', icon: '👪', href: '/why-stellr#parent' },
  { label: 'Mentor', icon: '🔬', href: '/why-stellr#mentor' },
]

const whatWeDo = [
  {
    icon: Trophy,
    title: 'Multi-Disciplinary Challenges',
    body: 'Real-world scenarios requiring STEM and business skills — engineering, science, communication, and strategy working together.',
  },
  {
    icon: Users,
    title: 'Mentored by Industry Experts',
    body: 'Students network with aerospace, engineering, and science professionals who guide them through competition challenges.',
  },
  {
    icon: Rocket,
    title: '90%+ Go On To Study STEM',
    body: 'An extraordinary outcome: the vast majority of Stellr participants go on to pursue STEM or medicine at college.',
  },
]

const membershipTiers = [
  {
    name: 'Explorer',
    price: 'Free',
    benefits: ['Public content & competition listings', 'Basic profile', 'Community access'],
  },
  {
    name: 'Pathfinder',
    price: '$60/yr',
    highlight: true,
    benefits: ['Full community & resources', 'Competition registration', '1 year free with event participation'],
  },
  {
    name: 'Scholar',
    price: '$120/yr',
    benefits: ['Award winner tier', 'All Pathfinder benefits', 'Exclusive scholar content'],
  },
]

interface StellarEvent {
  _id: string
  title: string
  slug: { current: string }
  type?: string
  gradeLevel?: string
  date?: string
  endDate?: string
  venue?: string
  city?: string
  state?: string
  tagline?: string
  image?: { asset: { _ref: string } }
  registrationOpen?: boolean
  registrationOpenDate?: string
  registrationCloseDate?: string
}

export default async function HomePage() {
  const authUrl = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

  const [featuredEvents, testimonials] = await Promise.allSettled([
    getFeaturedEvents(),
    getFeaturedTestimonials(),
  ])

  const events: StellarEvent[] = featuredEvents.status === 'fulfilled' && featuredEvents.value?.length
    ? featuredEvents.value
    : []

  const testimonialData = testimonials.status === 'fulfilled' ? testimonials.value ?? [] : []

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative bg-brand-blue-dark text-white overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-20"
          style={{ backgroundImage: "url('/images/hero-stem.jpg')" }}
          aria-hidden="true"
        />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 lg:py-36">
          <div className="max-w-3xl">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight">
              Real-World STEM Competitions.{' '}
              <span className="text-brand-blue">Real Careers Begin Here.</span>
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-gray-300 max-w-2xl">
              Stellr connects middle and high school students with industry professionals through high-tempo design competitions across the US.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link href="/events" className="btn-primary text-base px-8 py-4">
                Explore Events
              </Link>
              <a href={`${authUrl}/signup`} className="btn-outline-white text-base px-8 py-4">
                Join Free
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Role Selector ────────────────────────────────────────────── */}
      <section className="bg-brand-grey-light section-padding">
        <div className="container-max">
          <p className="text-center text-sm font-semibold uppercase tracking-widest text-brand-grey-mid mb-8">
            I am a…
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {roleCards.map((card) => (
              <Link
                key={card.label}
                href={card.href}
                className="flex flex-col items-center gap-3 p-6 bg-white rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all border border-gray-100"
              >
                <span className="text-3xl">{card.icon}</span>
                <span className="font-semibold text-brand-blue-dark">{card.label}</span>
                <span className="text-xs text-brand-blue flex items-center gap-1">
                  Learn more <ArrowRight size={12} />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── What We Do ───────────────────────────────────────────────── */}
      <section className="section-padding">
        <div className="container-max">
          <h2 className="text-3xl font-bold text-center text-brand-blue-dark mb-12">
            Why Stellr Competitions Work
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {whatWeDo.map((item) => (
              <div key={item.title} className="text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-blue-50 mb-4">
                  <item.icon size={28} className="text-brand-blue" />
                </div>
                <h3 className="text-xl font-bold text-brand-blue-dark mb-3">{item.title}</h3>
                <p className="text-brand-grey-dark leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Featured Events ───────────────────────────────────────────── */}
      <section className="bg-brand-grey-light section-padding">
        <div className="container-max">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-3xl font-bold text-brand-blue-dark">Upcoming Events</h2>
            <Link href="/events" className="text-brand-blue font-semibold text-sm flex items-center gap-1 hover:underline">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {events.map((event) => (
              <EventCard key={event._id} event={event} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ─────────────────────────────────────────────── */}
      <section className="bg-brand-blue-dark section-padding">
        <div className="container-max">
          <h2 className="text-3xl font-bold text-center text-white mb-10">
            Hear From Our Community
          </h2>
          {testimonialData.length > 0 ? (
            <TestimonialCarousel testimonials={testimonialData} />
          ) : (
            <div className="max-w-3xl mx-auto text-center">
              <blockquote className="text-xl sm:text-2xl font-medium italic leading-relaxed text-white">
                &ldquo;My son said it was one of the most exciting, exhilarating, challenging and memorable events in his life.&rdquo;
              </blockquote>
              <p className="mt-4 text-blue-300 font-semibold">— Parent, 2022</p>
            </div>
          )}
        </div>
      </section>

      {/* ── Membership Tiers Preview ─────────────────────────────────── */}
      <section className="section-padding">
        <div className="container-max">
          <h2 className="text-3xl font-bold text-center text-brand-blue-dark mb-4">
            Find Your Place in the Stellr Community
          </h2>
          <p className="text-center text-brand-grey-dark mb-12 max-w-xl mx-auto">
            Whether you&apos;re competing, teaching, mentoring, or supporting — there&apos;s a tier for you.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {membershipTiers.map((tier) => (
              <div
                key={tier.name}
                className={`rounded-xl border p-6 ${
                  tier.highlight
                    ? 'border-brand-blue shadow-lg ring-2 ring-brand-blue'
                    : 'border-gray-200'
                }`}
              >
                {tier.highlight && (
                  <span className="inline-block text-xs font-bold uppercase tracking-wider text-brand-blue mb-3">
                    Most Popular
                  </span>
                )}
                <h3 className="text-xl font-bold text-brand-blue-dark">{tier.name}</h3>
                <p className="text-2xl font-bold text-brand-blue mt-1">{tier.price}</p>
                <ul className="mt-4 space-y-2">
                  {tier.benefits.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-sm text-brand-grey-dark">
                      <span className="text-brand-blue mt-0.5">✓</span>
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link href="/membership" className="btn-primary">
              See All Plans
            </Link>
          </div>
        </div>
      </section>

      {/* ── Email Subscribe ───────────────────────────────────────────── */}
      <section className="bg-brand-grey-light section-padding">
        <div className="container-max max-w-xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-brand-blue-dark mb-2">Stay in the Loop</h2>
          <p className="text-brand-grey-dark mb-6">
            Get Stellr news, competition dates, and STEM resources in your inbox.
          </p>
          <SubscribeForm />
          <p className="mt-3 text-xs text-brand-grey-mid">
            By subscribing you agree to receive Stellr news and competition updates. Unsubscribe any time.
          </p>
        </div>
      </section>
    </>
  )
}
