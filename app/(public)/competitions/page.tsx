import type { Metadata } from 'next'
import Link from 'next/link'
import { CheckCircle } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Competitions | Stellr Education',
  description:
    'Stellr runs multiple Design Competitions across the school year for middle and high school students, based on themes like Space and Environment.',
}

const themes2027 = [
  {
    name: 'Space',
    description:
      'Students explore engineering challenges inspired by space exploration — from propulsion and life support to communication and habitat design.',
  },
  {
    name: 'Environmental',
    description:
      'Students tackle real-world environmental problems through systems thinking, sustainable design, and engineering trade-off analysis.',
  },
]

const tableRows = [
  { label: 'Event Type', events: 'Design Competition', campaigns: '—' },
  { label: 'Activities', events: 'Challenge / Championship', campaigns: 'Campaign' },
  {
    label: 'Deliverable',
    events: 'Full Presentation',
    campaigns: 'Written Proposal OR Presentation',
  },
  { label: 'Facilitator', events: 'Stellr Staff', campaigns: 'Educator' },
  { label: 'Setting', events: 'In-Person OR Virtual', campaigns: 'School OR Classroom' },
  { label: 'Duration', events: 'Fixed', campaigns: 'Variable' },
]

const materialTiers = [
  {
    tier: 'Core Material',
    badge: 'Free',
    badgeColor: 'bg-green-100 text-green-800',
    items: ['Request for Proposal (RFP)', 'Mission Handbook'],
  },
  {
    tier: 'Baseline',
    badge: 'Subscriber',
    badgeColor: 'bg-blue-100 text-blue-800',
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
    badge: 'Educator Member',
    badgeColor: 'bg-purple-100 text-purple-800',
    items: [
      'Multi-week lesson plans',
      'Agentic AI Sub-Contractors + PM tools',
      'Live kick-off and close-out calls',
      'Student certificates',
    ],
  },
  {
    tier: 'Premium',
    badge: 'Premium Member',
    badgeColor: 'bg-amber-100 text-amber-800',
    items: [
      'Weekly mentoring calls (recorded & posted)',
      'Teacher CTE activity',
      'Student access to Community paid membership',
      'Student awards',
      'Student progression to Finals activity',
    ],
  },
]

export default function CompetitionsPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-brand-blue-dark text-white py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-brand-orange font-semibold uppercase tracking-widest text-sm mb-4">
            Educate → Competitions
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold mb-6 max-w-3xl">Design Competitions</h1>
          <p className="text-lg text-gray-300 max-w-2xl leading-relaxed">
            Stellr runs multiple competitions across the school year, giving middle and high school
            students the opportunity to develop real STEM Skills through structured, theme-based
            design challenges.
          </p>
        </div>
      </section>

      {/* Overview */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
            <div>
              <h2 className="text-3xl font-bold text-brand-blue-dark mb-6">
                About Our Competitions
              </h2>
              <p className="text-brand-grey-dark mb-4 leading-relaxed">
                Each competition is built around a real-world theme and challenges students to apply
                engineering thinking, teamwork, and communication to solve meaningful problems.
              </p>
              <p className="text-brand-grey-dark mb-6 leading-relaxed">
                Students can participate through two pathways:{' '}
                <strong>live Events</strong> (in-person or virtual challenges run by Stellr staff)
                or <strong>Curriculum Campaigns</strong> (asynchronous activities run by an
                educator at a school or district).
              </p>
              <ul className="space-y-3">
                {[
                  'Open to middle school and high school students',
                  'State-level (USA) or national (international) challenges',
                  'Campaign Champions invited to Championship events',
                  'Core Material is free to access',
                  'No cost for students to participate in a Campaign',
                  'Educator must be at least a Subscriber to submit Campaign entries',
                ].map((point) => (
                  <li key={point} className="flex items-start gap-3">
                    <CheckCircle size={18} className="text-brand-blue shrink-0 mt-0.5" />
                    <span className="text-sm text-brand-grey-dark">{point}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-4">
              <h3 className="text-xl font-bold text-brand-blue-dark">2027 School Year Themes</h3>
              {themes2027.map((theme) => (
                <div key={theme.name} className="bg-brand-grey-light rounded-xl p-6">
                  <p className="font-bold text-brand-blue-dark mb-2">{theme.name}</p>
                  <p className="text-sm text-brand-grey-dark leading-relaxed">
                    {theme.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Activity Types Table */}
      <section className="section-padding bg-brand-grey-light">
        <div className="container-max">
          <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">Activity Types</h2>
          <p className="text-brand-grey-dark mb-8 max-w-2xl">
            Competitions include two types of activities. Both count toward competition
            participation; the right choice depends on your students&rsquo; schedule and your
            school&rsquo;s geography.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full bg-white rounded-xl shadow-sm overflow-hidden text-sm">
              <thead>
                <tr className="bg-brand-blue-dark text-white">
                  <th className="px-6 py-4 text-left font-semibold">Activity Type</th>
                  <th className="px-6 py-4 text-left font-semibold">Events</th>
                  <th className="px-6 py-4 text-left font-semibold">Curriculum Activities</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, i) => (
                  <tr key={row.label} className={i % 2 === 0 ? 'bg-white' : 'bg-brand-grey-light/50'}>
                    <td className="px-6 py-4 font-semibold text-brand-blue-dark">{row.label}</td>
                    <td className="px-6 py-4 text-brand-grey-dark">{row.events}</td>
                    <td className="px-6 py-4 text-brand-grey-dark">{row.campaigns}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Material Tiers */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">Competition Material</h2>
            <p className="text-brand-grey-dark max-w-2xl mx-auto">
              All competition participants receive Core Material. Educators can unlock additional
              tiers by registering as a Subscriber or Member.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {materialTiers.map((tier) => (
              <div
                key={tier.tier}
                className="border border-gray-200 rounded-xl p-6 flex flex-col gap-4"
              >
                <div>
                  <span
                    className={`inline-block text-xs font-semibold px-2 py-1 rounded-full ${tier.badgeColor} mb-3`}
                  >
                    {tier.badge}
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
          <div className="mt-8 text-center">
            <Link href="/membership" className="btn-primary inline-flex">
              View Membership Tiers
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="section-padding bg-brand-blue-dark text-white">
        <div className="container-max text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to get started?</h2>
          <p className="text-gray-300 max-w-xl mx-auto mb-8">
            Register for an upcoming live event, or download curriculum material to run a Campaign
            in your classroom.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/events"
              className="px-6 py-3 bg-brand-orange text-white font-semibold rounded-md hover:bg-amber-500 transition-colors"
            >
              View Events
            </Link>
            <Link
              href="/activities"
              className="px-6 py-3 border border-white text-white font-semibold rounded-md hover:bg-white/10 transition-colors"
            >
              Download Curriculum
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
