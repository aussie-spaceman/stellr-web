import type { Metadata } from 'next'
import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { PricingSection, type PricingTier } from '@/components/membership/PricingSection'

export const metadata: Metadata = {
  title: 'Membership',
  description: 'Find your place in the Stellr community. Explorer (free), Pathfinder, Scholar, and more.',
}

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

// Static benefit copy keyed by tier name
const TIER_COPY: Record<string, { description: string; benefits: string[]; highlight?: boolean; badge?: string }> = {
  Explorer: {
    description: 'Get started with Stellr.',
    benefits: ['Access to public content & competition listings', 'Basic profile', 'Community access'],
  },
  Pathfinder: {
    description: 'For active competitors.',
    benefits: ['Full community & resources', 'Competition registration', '1 year free with event participation', 'Priority event notifications'],
    highlight: true,
    badge: 'Most Popular',
  },
  Scholar: {
    description: 'For award winners.',
    benefits: ['Award winner tier', 'All Pathfinder benefits', 'Exclusive scholar content', 'Scholar badge on profile'],
  },
  Alumni: {
    description: 'Auto-upgraded from Explorer on graduation.',
    benefits: ['Community access', 'Alumni network', 'Event invitations'],
  },
  Contributor: {
    description: 'For active mentors.',
    benefits: ['Full mentor resources', '1 year free if mentoring at an event', 'Mentor badge on profile', 'Priority mentor placement'],
    highlight: true,
    badge: 'Most Popular',
  },
  Counsellor: {
    description: 'For college junior or senior mentors.',
    benefits: ['All Contributor benefits', 'Counsellor badge', 'Featured mentor profile'],
  },
  Luminary: {
    description: 'For post-graduate mentors.',
    benefits: ['All Contributor benefits', 'Luminary badge', 'Featured mentor profile'],
  },
  Educator: {
    description: 'For teachers bringing students to events.',
    benefits: ['Access to Stellr materials', 'Bring participants to events', 'Educator community access'],
  },
  Innovator: {
    description: 'Full educator access.',
    benefits: ['Full educator resources', '1 year free with event participation', 'Priority registration support'],
    highlight: true,
    badge: 'Most Popular',
  },
  Donor: {
    description: 'Financial contributors & supporters of events.',
    benefits: ['Donor recognition', 'Event invitations', 'Impact reporting'],
  },
  Expert: {
    description: "SMEs, industry professionals, Stellr contacts.",
    benefits: ['Industry expert profile', 'Event invitations', 'Access to Stellr network'],
  },
}

function buildTier(row: {
  id: string
  name: string
  annual_cost_cents: number
  is_free: boolean
  stripe_price_id: string | null
  stripe_price_id_monthly: string | null
}): PricingTier {
  const copy = TIER_COPY[row.name] ?? { description: '', benefits: [] }
  return {
    id: row.id,
    name: row.name,
    annualCost: row.annual_cost_cents / 100,
    isFree: row.is_free,
    hasMonthly: !!row.stripe_price_id_monthly,
    ...copy,
  }
}

export default async function MembershipPage() {
  const { userId } = await auth()
  const db = supabaseServer()

  const { data: rows } = await db
    .from('membership_tiers')
    .select('id, name, annual_cost_cents, is_free, stripe_price_id, stripe_price_id_monthly')
    .order('sort_order')

  const tierMap = Object.fromEntries((rows ?? []).map((r) => [r.name, buildTier(r)]))

  const studentTiers = ['Explorer', 'Pathfinder', 'Scholar'].map((n) => tierMap[n]).filter(Boolean)
  const mentorTiers = ['Alumni', 'Contributor', 'Counsellor', 'Luminary'].map((n) => tierMap[n]).filter(Boolean)
  const educatorTiers = ['Educator', 'Innovator', 'Donor'].map((n) => tierMap[n]).filter(Boolean)

  const signInUrl = '/sign-in?redirect_url=/membership'

  return (
    <>
      {/* ── Page Header ──────────────────────────────────────────────── */}
      <section className="bg-brand-blue-dark text-white py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-bold mb-4">Find Your Place in the Stellr Community</h1>
          <p className="text-lg text-content-faint max-w-xl">
            Whether you&apos;re competing, teaching, mentoring, or supporting — there&apos;s a tier for you.
          </p>
        </div>
      </section>

      {/* ── Student Tiers ─────────────────────────────────────────────── */}
      <PricingSection
        tiers={studentTiers}
        groupLabel="For Students (Disruptors)"
        groupDescription="Compete, connect, and grow your STEM career from day one."
        isLoggedIn={!!userId}
        signInUrl={signInUrl}
      />

      {/* ── Mentor Tiers ─────────────────────────────────────────────── */}
      <PricingSection
        tiers={mentorTiers}
        groupLabel="For Mentors & Alumni (Catalysts)"
        groupDescription="Give back to the next generation while growing your own network."
        isLoggedIn={!!userId}
        signInUrl={signInUrl}
        bgGray
      />

      {/* ── Educator Tiers ───────────────────────────────────────────── */}
      <PricingSection
        tiers={educatorTiers}
        groupLabel="For Educators & Professionals"
        groupDescription="Bring your students to the best STEM competition experience in the country."
        isLoggedIn={!!userId}
        signInUrl={signInUrl}
      />

      {/* ── FAQ ──────────────────────────────────────────────────────── */}
      <section className="section-padding bg-brand-grey-light">
        <div className="container-max max-w-3xl">
          <h2 className="text-2xl font-bold text-brand-blue-dark mb-8">Frequently Asked Questions</h2>
          <div className="space-y-3">
            {faqs.map((faq) => (
              <details key={faq.q} className="group bg-white border border-line rounded-lg">
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
            <Link href="/sign-up" className="btn-primary text-base px-8 py-4">
              Create Free Account
            </Link>
            <Link href="/events" className="btn-secondary text-base px-8 py-4">
              See Upcoming Events
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
