import type { Metadata } from 'next'
import Link from 'next/link'
import { CheckCircle, Clock, Globe, Award } from 'lucide-react'
import { getAllCampaigns } from '@/lib/sanity'

export const metadata: Metadata = {
  title: 'Activities | Stellr Education',
  description:
    'Download Stellr competition curriculum material and run a Design Campaign in your classroom, at your own pace.',
}

export const revalidate = 3600

interface Campaign {
  _id: string
  title: string
  slug?: { current: string }
  type?: string
  term?: string
  date?: string
  endDate?: string
  registrationOpen?: boolean
  registrationCloseDate?: string
}

function campaignStatus(c: Campaign): string {
  if (c.registrationOpen === false) return 'Closed'
  if (c.registrationOpen === true) return 'Open'
  const today = new Date().toISOString().split('T')[0]
  if (c.date && c.date > today) return 'Coming soon'
  if (c.endDate && c.endDate < today) return 'Closed'
  return 'Open'
}

const FALLBACK_CAMPAIGNS: Campaign[] = [
  { _id: 'fallback-1', title: '2027 Space Design Campaign', term: 'Fall 2026', date: '2026-09-01', endDate: '2026-12-15' },
  { _id: 'fallback-2', title: '2027 Environmental Design Campaign', term: 'Spring 2027', date: '2027-01-15', endDate: '2027-05-30' },
]

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

const campaignBenefits = [
  {
    icon: Clock,
    title: 'Your Schedule',
    description:
      'Campaigns are asynchronous — no fixed event dates. Run the material when it works for your class.',
  },
  {
    icon: Globe,
    title: 'Globally Accessible',
    description:
      'Campaigns are available worldwide. Geography and time zones are no barrier to participation.',
  },
  {
    icon: Award,
    title: 'Competition Pathway',
    description:
      'Campaign submissions count toward competition standings. Champions progress to Championship events.',
  },
]


const materialTiers = [
  {
    tier: 'Core Material',
    access: 'Free — public access',
    cardClass: 'border-green-200 bg-green-50',
    badgeClass: 'bg-green-100 text-green-800',
    items: ['Request for Proposal (RFP)', 'Mission Handbook'],
  },
  {
    tier: 'Baseline',
    access: 'Subscriber',
    cardClass: 'border-blue-200 bg-blue-50',
    badgeClass: 'bg-blue-100 text-blue-800',
    items: [
      'Delivery Overview',
      'NSES Curriculum Map',
      'Worksheets (cost, calculations, schedule etc.)',
      'Assessment Guides / Marking Rubric',
      'Student access to Community free training',
    ],
  },
  {
    tier: 'Advanced',
    access: 'Educator Member',
    cardClass: 'border-purple-200 bg-purple-50',
    badgeClass: 'bg-purple-100 text-purple-800',
    items: [
      'Multi-week lesson plans',
      'Agentic AI Sub-Contractors + PM tools',
      'Live kick-off and close-out calls',
      'Student certificates',
    ],
  },
  {
    tier: 'Premium',
    access: 'Premium Member',
    cardClass: 'border-amber-200 bg-amber-50',
    badgeClass: 'bg-amber-100 text-amber-800',
    items: [
      'Weekly mentoring calls (recorded & posted)',
      'Teacher CTE activity',
      'Student access to Community paid membership',
      'Student awards',
      'Student progression to Finals',
    ],
  },
]

export default async function ActivitiesPage() {
  const sanityData = await getAllCampaigns().catch(() => null)
  const campaigns: Campaign[] = (sanityData as Campaign[] | null) ?? FALLBACK_CAMPAIGNS
  return (
    <>
      {/* Hero */}
      <section className="bg-brand-blue-dark text-white py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-brand-orange font-semibold uppercase tracking-widest text-sm mb-4">
            Educate → Activities
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold mb-6 max-w-3xl">
            Curriculum Activities
          </h1>
          <p className="text-lg text-gray-300 max-w-2xl leading-relaxed">
            All material Stellr produces for its live competitions is available for educators to
            access and use asynchronously — in your classroom, on your schedule.
          </p>
        </div>
      </section>

      {/* What are Activities */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-bold text-brand-blue-dark mb-6">
              Material for Every Classroom
            </h2>
            <p className="text-brand-grey-dark mb-4 leading-relaxed">
              Not every school can get students to a live event — timing conflicts, geography, and
              travel costs are real barriers. Stellr&rsquo;s Activity material removes those
              barriers entirely.
            </p>
            <p className="text-brand-grey-dark mb-4 leading-relaxed">
              Core Material is available for anyone to download and see exactly what students across
              the planet are using to develop their STEM Skills. Registering as a Subscriber or
              Member unlocks progressively richer content — from lesson plans and worksheets through
              to live mentoring and CTE credits.
            </p>
            <p className="text-brand-grey-dark leading-relaxed">
              Educators can use the material as standalone curriculum <em>or</em> register their
              class into a live Campaign — contributing submissions to the broader competition and
              giving students the opportunity to progress to Championship events.
            </p>
          </div>
        </div>
      </section>

      {/* Campaign Benefits */}
      <section className="section-padding bg-brand-grey-light">
        <div className="container-max">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">Why Join a Campaign?</h2>
            <p className="text-brand-grey-dark max-w-xl mx-auto">
              Signing your class up to a Campaign is free and gives students a structured deadline,
              a sense of participation, and a real shot at the Championship.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {campaignBenefits.map((b) => {
              const Icon = b.icon
              return (
                <div key={b.title} className="bg-white rounded-xl p-6 shadow-sm">
                  <div className="w-12 h-12 rounded-lg bg-brand-blue/10 flex items-center justify-center mb-4">
                    <Icon size={24} className="text-brand-blue" />
                  </div>
                  <h3 className="font-bold text-brand-blue-dark mb-2">{b.title}</h3>
                  <p className="text-sm text-brand-grey-dark leading-relaxed">{b.description}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Current Campaigns */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">Current Campaigns</h2>
          <p className="text-brand-grey-dark mb-8 max-w-2xl">
            The following Campaigns are currently available. Register your class to enter the
            competition, or download the material to use as standalone curriculum.
          </p>
          {campaigns.length === 0 ? (
            <p className="text-brand-grey-dark">No campaigns are currently listed. Check back soon.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {campaigns.map((c) => {
                const status = campaignStatus(c)
                return (
                  <div
                    key={c._id}
                    className="border border-gray-200 rounded-xl p-6 flex items-start justify-between gap-4"
                  >
                    <div>
                      <h3 className="font-bold text-brand-blue-dark mb-1">{c.title}</h3>
                      {c.term && <p className="text-sm text-brand-grey-dark">{c.term}</p>}
                    </div>
                    <span
                      className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${
                        status === 'Open'
                          ? 'bg-green-100 text-green-800'
                          : status === 'Closed'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {status}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* Material Tiers */}
      <section className="section-padding bg-brand-grey-light">
        <div className="container-max">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">Content Tiers</h2>
            <p className="text-brand-grey-dark max-w-2xl mx-auto">
              Start with free Core Material. Unlock richer content as you and your students grow
              with Stellr.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {materialTiers.map((tier) => (
              <div
                key={tier.tier}
                className={`border rounded-xl p-6 flex flex-col gap-4 ${tier.cardClass}`}
              >
                <div>
                  <span
                    className={`inline-block text-xs font-semibold px-2 py-1 rounded-full ${tier.badgeClass} mb-3`}
                  >
                    {tier.access}
                  </span>
                  <h3 className="font-bold text-brand-blue-dark">{tier.tier}</h3>
                </div>
                <ul className="space-y-2 flex-1">
                  {tier.items.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-brand-grey-dark">
                      <CheckCircle size={14} className="text-brand-blue shrink-0 mt-0.5" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Link href="/membership" className="btn-primary inline-flex">
              View Membership Options
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="section-padding bg-brand-blue-dark text-white">
        <div className="container-max text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to bring this to your classroom?</h2>
          <p className="text-gray-300 max-w-xl mx-auto mb-8">
            Create a free account to access Baseline content and register your class in an active
            Campaign.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href={`${AUTH_URL}/signup`}
              className="px-6 py-3 bg-brand-orange text-white font-semibold rounded-md hover:bg-amber-500 transition-colors"
            >
              Create Free Account
            </a>
            <Link
              href="/competitions"
              className="px-6 py-3 border border-white text-white font-semibold rounded-md hover:bg-white/10 transition-colors"
            >
              Learn About Competitions
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
