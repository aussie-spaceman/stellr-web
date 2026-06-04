import type { Metadata } from 'next'
import Link from 'next/link'
import { CheckCircle } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Membership',
  description: 'Find your place in the Stellr community. Explorer (free), Pathfinder, Scholar, and more.',
}

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

const studentTiers = [
  {
    name: 'Explorer',
    price: 'Free',
    description: 'Get started with Stellr.',
    benefits: [
      'Access to public content & competition listings',
      'Basic profile',
      'Community access',
    ],
    cta: 'Create Free Account',
    href: `${AUTH_URL}/signup`,
    highlight: false,
  },
  {
    name: 'Pathfinder',
    price: '$60/yr',
    description: 'For active competitors.',
    benefits: [
      'Full community & resources',
      'Competition registration',
      '1 year free with event participation',
      'Priority event notifications',
    ],
    cta: 'Get Pathfinder',
    href: `${AUTH_URL}/signup?tier=pathfinder`,
    highlight: true,
    badge: 'Most Popular',
  },
  {
    name: 'Scholar',
    price: '$120/yr',
    description: 'For award winners.',
    benefits: [
      'Award winner tier',
      'All Pathfinder benefits',
      'Exclusive scholar content',
      'Scholar badge on profile',
    ],
    cta: 'Get Scholar',
    href: `${AUTH_URL}/signup?tier=scholar`,
    highlight: false,
  },
]

const mentorTiers = [
  {
    name: 'Alumni',
    price: 'Free',
    description: 'Auto-upgraded from Explorer on graduation.',
    benefits: ['Community access', 'Alumni network', 'Event invitations'],
  },
  {
    name: 'Contributor',
    price: '$250/yr',
    description: 'For active mentors.',
    benefits: [
      'Full mentor resources',
      '1 year free if mentoring at an event',
      'Mentor badge on profile',
      'Priority mentor placement',
    ],
    highlight: true,
    badge: 'Most Popular',
  },
  {
    name: 'Counsellor / Luminary',
    price: '$500/yr',
    description: 'For junior/senior or post-grad college mentors.',
    benefits: [
      'All Contributor benefits',
      'Counsellor badge',
      'Featured mentor profile',
    ],
  },
]

const educatorTiers = [
  {
    name: 'Educator',
    price: 'Free',
    description: 'For teachers bringing students to events.',
    benefits: [
      'Access to Stellr materials',
      'Bring participants to events',
      'Educator community access',
    ],
  },
  {
    name: 'Innovator',
    price: '$200/yr',
    description: 'Full educator access.',
    benefits: [
      'Full educator resources',
      '1 year free with event participation',
      'Priority registration support',
    ],
    highlight: true,
    badge: 'Most Popular',
  },
  {
    name: 'Expert / Donor',
    price: 'Free',
    description: 'For SMEs, industry contacts & financial supporters.',
    benefits: [
      'Industry expert profile',
      'Event invitations',
      'Impact reporting',
    ],
  },
]

const faqs = [
  {
    q: 'What happens to my membership when I graduate?',
    a: 'Student members are automatically upgraded to Alumni membership when they graduate — keeping you connected to the Stellr community as you enter industry or higher education.',
  },
  {
    q: 'Can I register for events without a paid membership?',
    a: 'Explorer (free) members can browse events and create a profile. A Pathfinder membership is required to register for competitions.',
  },
  {
    q: 'How does the free year work for event participants?',
    a: 'When you participate in a Stellr event, you receive one year of Pathfinder (students) or Contributor (mentors) / Innovator (educators) membership at no cost — activated from the event date.',
  },
  {
    q: 'Is membership per school or per person?',
    a: 'Membership is per individual. Schools do not need a membership — only the students and educators attending events.',
  },
]

interface TierCardProps {
  name: string
  price: string
  description: string
  benefits: string[]
  highlight?: boolean
  badge?: string
  cta?: string
  href?: string
}

function TierCard({ name, price, description, benefits, highlight, badge, cta, href }: TierCardProps) {
  return (
    <div className={`rounded-xl border p-6 flex flex-col ${highlight ? 'border-brand-blue shadow-lg ring-2 ring-brand-blue' : 'border-gray-200'}`}>
      {badge && (
        <span className="inline-block text-xs font-bold uppercase tracking-wider text-brand-blue mb-3">{badge}</span>
      )}
      <h3 className="text-xl font-bold text-brand-blue-dark">{name}</h3>
      <p className="text-2xl font-bold text-brand-blue mt-1">{price}</p>
      <p className="text-sm text-brand-grey-mid mt-1 mb-4">{description}</p>
      <ul className="space-y-2 flex-1">
        {benefits.map((b) => (
          <li key={b} className="flex items-start gap-2 text-sm text-brand-grey-dark">
            <CheckCircle size={16} className="text-brand-blue mt-0.5 shrink-0" />
            {b}
          </li>
        ))}
      </ul>
      {cta && href && (
        <a href={href} className={`mt-6 btn-primary w-full justify-center text-sm ${!highlight ? 'bg-brand-blue-dark hover:bg-gray-900' : ''}`}>
          {cta}
        </a>
      )}
    </div>
  )
}

export default function MembershipPage() {
  return (
    <>
      {/* ── Page Header ──────────────────────────────────────────────── */}
      <section className="bg-brand-blue-dark text-white py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-bold mb-4">Find Your Place in the Stellr Community</h1>
          <p className="text-lg text-gray-300 max-w-xl">
            Whether you&apos;re competing, teaching, mentoring, or supporting — there&apos;s a tier for you.
          </p>
        </div>
      </section>

      {/* ── Student Tiers ─────────────────────────────────────────────── */}
      <section className="section-padding">
        <div className="container-max">
          <h2 className="text-2xl font-bold text-brand-blue-dark mb-2">For Students (Disruptors)</h2>
          <p className="text-brand-grey-dark mb-8">Compete, connect, and grow your STEM career from day one.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {studentTiers.map((tier) => (
              <TierCard key={tier.name} {...tier} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Mentor Tiers ─────────────────────────────────────────────── */}
      <section className="section-padding bg-brand-grey-light">
        <div className="container-max">
          <h2 className="text-2xl font-bold text-brand-blue-dark mb-2">For Mentors &amp; Alumni (Catalysts)</h2>
          <p className="text-brand-grey-dark mb-8">Give back to the next generation while growing your own network.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {mentorTiers.map((tier) => (
              <TierCard key={tier.name} {...tier} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Educator Tiers ───────────────────────────────────────────── */}
      <section className="section-padding">
        <div className="container-max">
          <h2 className="text-2xl font-bold text-brand-blue-dark mb-2">For Educators &amp; Professionals</h2>
          <p className="text-brand-grey-dark mb-8">Bring your students to the best STEM competition experience in the country.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {educatorTiers.map((tier) => (
              <TierCard key={tier.name} {...tier} />
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────── */}
      <section className="section-padding bg-brand-grey-light">
        <div className="container-max max-w-3xl">
          <h2 className="text-2xl font-bold text-brand-blue-dark mb-8">Frequently Asked Questions</h2>
          <div className="space-y-3">
            {faqs.map((faq) => (
              <details key={faq.q} className="group bg-white border border-gray-200 rounded-lg">
                <summary className="flex items-center justify-between p-5 cursor-pointer font-medium text-brand-blue-dark list-none">
                  {faq.q}
                  <span className="ml-4 shrink-0 text-brand-grey-mid group-open:rotate-180 transition-transform">▾</span>
                </summary>
                <p className="px-5 pb-5 text-sm text-brand-grey-dark">{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────── */}
      <section className="section-padding">
        <div className="container-max text-center">
          <h2 className="text-2xl font-bold text-brand-blue-dark mb-4">Ready to get started?</h2>
          <div className="flex flex-wrap justify-center gap-4">
            <a href={`${AUTH_URL}/signup`} className="btn-primary text-base px-8 py-4">
              Create Free Account
            </a>
            <Link href="/events" className="btn-secondary text-base px-8 py-4">
              See Upcoming Events
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
