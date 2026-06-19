import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Star, Rocket, Leaf } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Competitions',
  description:
    'Real professional STEM skills for high school students — delivered through competitive, industry-simulation Design Competitions on themes like Space and Environment.',
}

/* Step 3 tier block is mid-rework — keep behind this flag (wire to CMS / a
   feature flag when the new membership structure is finalised). Default shows
   the tier cards as in the approved redesign. */
const showMaterialTiers = true

const studentSteps = [
  { n: 1, title: 'Get the brief', body: 'A themed RFP sets a real engineering challenge.' },
  { n: 2, title: 'Form a team', body: 'Students work together like a professional firm.' },
  { n: 3, title: 'Design & decide', body: 'Research, prototype, weigh trade-offs, run the numbers.' },
  { n: 4, title: 'Build the deliverable', body: 'A written proposal or a presentation of the solution.' },
  { n: 5, title: 'Pitch & be judged', body: 'Present to judges; strong teams progress to finals.' },
]

const pathways = [
  {
    eyebrow: 'Pathway 1',
    name: 'Live Event',
    tagline: 'A competition run by Stellr',
    headerClass: 'bg-brand-blue',
    rows: [
      ['Who runs it', 'Stellr staff'],
      ['Where', 'In-person or virtual'],
      ['How long', 'Fixed dates'],
      ['Students deliver', 'Full presentation'],
      ['Best for', 'A flagship, dated challenge'],
    ],
    cta: { label: 'Browse upcoming events', href: '/events', className: 'bg-blue-50 text-brand-blue hover:bg-blue-100' },
  },
  {
    eyebrow: 'Pathway 2',
    name: 'Curriculum Campaign',
    tagline: 'You run it in class, from our curriculum',
    headerClass: 'bg-brand-orange-alt',
    rows: [
      ['Who runs it', 'You, the educator'],
      ['Where', 'Your school or classroom'],
      ['Delivered via', 'Stellr curriculum & lesson plans'],
      ['How long', 'Flexible — you set the pace'],
      ['Students deliver', 'Written proposal or presentation'],
      ['Best for', 'Fitting STEM into your semester'],
    ],
    cta: { label: 'Download curriculum', href: '/activities', className: 'bg-amber-50 text-brand-gold-ink hover:bg-amber-100' },
  },
]

const themes = [
  {
    name: 'Space',
    Icon: Rocket,
    accent: 'text-purple-700',
    iconBg: 'bg-purple-600',
    headerBg: 'bg-gradient-to-b from-purple-50 to-white',
    border: 'border-purple-200',
    briefBg: 'bg-purple-50',
    blurb:
      'Engineering inspired by space exploration — students tackle the systems that keep a mission alive and on course.',
    explore: [
      'Propulsion & trajectory',
      'Life support & oxygen supply',
      'Habitat & radiation shielding',
      'Power generation & storage',
      'Communication systems',
      'Mass, cost & risk budgets',
    ],
    brief:
      'Design a lunar-surface habitat that keeps a four-person crew alive and productive for 90 days — managing power, oxygen, water recycling, radiation shielding and a fixed launch-mass budget.',
  },
  {
    name: 'Environmental',
    Icon: Leaf,
    accent: 'text-emerald-700',
    iconBg: 'bg-emerald-600',
    headerBg: 'bg-gradient-to-b from-emerald-50 to-white',
    border: 'border-emerald-200',
    briefBg: 'bg-emerald-50',
    blurb:
      'Real-world environmental problems solved through systems thinking, sustainable design and honest engineering trade-offs.',
    explore: [
      'Renewable energy & efficiency',
      'Water, waste & materials',
      'Carbon & emissions modelling',
      'Cost vs. environmental impact',
      'Climate & site constraints',
      'Long-term upkeep & payback',
    ],
    brief:
      'Design a net-zero energy system for a town of 5,000 — balancing generation, storage and demand against a capital budget, the local climate and a 10-year payback target.',
  },
]

interface Tier {
  name: string
  price: string
  accessNote: string
  inheritsFrom?: string
  badge?: string
  featured?: boolean
  items: string[]
}

const tiers: Tier[] = [
  {
    name: 'Subscriber',
    price: 'Free',
    accessNote: 'Publicly available',
    items: ['Request for Proposal (RFP)', 'Mission Handbook', 'Examples of previous work'],
  },
  {
    name: 'Educator',
    price: 'Free',
    accessNote: 'Free with a member account',
    inheritsFrom: 'Subscriber',
    items: [
      'Delivery Overview & NSES map',
      'Worksheets (cost, schedule)',
      'Educator Community Spaces',
      'Webinars & monthly newsletters',
    ],
  },
  {
    name: 'Innovator',
    price: '$500',
    accessNote: 'Free 1st year for event participants',
    inheritsFrom: 'Educator',
    badge: 'Best Value',
    featured: true,
    items: [
      'Assessment Guides / Marking Rubric',
      'Multi-week lesson plans',
      'Agentic AI Sub-Contractors + PM tools',
      'Live kick-off & close-out calls',
      'Student certificates',
      'Students upgraded to Pathfinder',
    ],
  },
  {
    name: 'Trailblazer',
    price: '$1,000',
    accessNote: 'Comprehensive teacher support',
    inheritsFrom: 'Innovator',
    items: ['Biweekly mentoring calls (via Community)', 'CTE credits / hours', 'Student awards'],
  },
]

function Eyebrow({ children, className = 'text-brand-blue' }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`font-subheading font-semibold uppercase tracking-[0.14em] text-xs ${className}`}>
      {children}
    </p>
  )
}

export default function CompetitionsPage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="bg-brand-blue-dark text-white py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-brand-orange font-semibold uppercase tracking-widest text-sm mb-4">
            Educate → Competitions
          </p>
          <div className="inline-flex items-center gap-3 mb-6 px-4 py-2 rounded-full bg-white/5 border border-white/15 text-sm font-medium text-content-faint">
            <span className="text-brand-orange">Themed Competitions</span>
            <span className="w-1 h-1 rounded-full bg-white/40" />
            <span>In class, or join an event</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold mb-6 max-w-3xl">Design Competitions</h1>
          <p className="text-lg text-content-faint max-w-2xl leading-relaxed">
            Real professional STEM skills for high school students — delivered through competitive,
            industry-simulation activities.
          </p>
          <div className="flex flex-wrap gap-3 mt-8">
            {['High school students', 'State & national', 'Free for students to enter'].map((pill) => (
              <span
                key={pill}
                className="text-sm font-medium text-content-faint bg-white/5 border border-white/15 px-4 py-2 rounded-lg"
              >
                {pill}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── What's a Design Competition? ──────────────────────────────── */}
      <section className="section-padding bg-brand-grey-light border-b border-line">
        <div className="container-max">
          <Eyebrow>Start here</Eyebrow>
          <h2 className="text-3xl font-bold text-brand-blue-dark mt-3 max-w-3xl">
            What&rsquo;s a Design Competition?
          </h2>
          <p className="text-lg text-brand-grey-dark mt-4 max-w-3xl leading-relaxed">
            Students step into the role of a professional engineering team. They&rsquo;re handed a
            real-world brief — a <strong className="text-brand-blue-dark">Request for Proposal (RFP)</strong> —
            and have to research, design, and justify a working solution, then pitch it. It&rsquo;s a
            genuine industry simulation, scaled for the classroom.
          </p>

          {/* What students actually do */}
          <p className="font-subheading font-semibold uppercase tracking-[0.08em] text-sm text-brand-grey mt-10 mb-5">
            What students actually do
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {studentSteps.map((step) => (
              <div key={step.n} className="bg-white border border-line rounded-card p-5">
                <div className="w-9 h-9 rounded-lg bg-blue-50 text-brand-blue font-bold flex items-center justify-center mb-3">
                  {step.n}
                </div>
                <p className="font-bold text-sm text-brand-blue-dark mb-1">{step.title}</p>
                <p className="text-sm text-brand-grey-dark leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>

          {/* The output callout */}
          <div className="mt-6 flex flex-wrap items-center gap-4 bg-brand-blue-dark rounded-card px-6 py-5 text-white">
            <span className="font-subheading font-semibold uppercase tracking-[0.06em] text-xs text-brand-orange shrink-0">
              The output
            </span>
            <span className="text-base text-content-faint leading-relaxed flex-1 min-w-[280px]">
              Every team produces a <strong className="text-white">deliverable</strong> — a written
              proposal or a live presentation — assessed against an industry-style marking rubric.
            </span>
          </div>

          {/* STEM Power Skills */}
          <div className="mt-4 flex flex-wrap items-center gap-4 bg-white border border-line rounded-card px-6 py-5">
            <span className="font-subheading font-semibold uppercase tracking-[0.06em] text-xs text-brand-blue shrink-0">
              STEM Power Skills
            </span>
            <span className="text-base text-brand-grey-dark leading-relaxed flex-1 min-w-[280px]">
              Beyond the engineering, students build the{' '}
              <strong className="text-brand-blue-dark">soft skills industry hires for</strong> —
              communication, teamwork, project management and presenting under pressure.
            </span>
          </div>

          {/* Theme teaser */}
          <div className="mt-11">
            <p className="font-subheading font-semibold uppercase tracking-[0.08em] text-sm text-brand-grey mb-2">
              Every competition is themed
            </p>
            <p className="text-brand-grey-dark mb-5 max-w-2xl leading-relaxed">
              For the 2027 school year, students choose from two real-world themes. Full detail is in
              Step 2 below.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {themes.map(({ name, Icon, iconBg, accent, border, blurb }) => (
                <div key={name} className={`bg-white border ${border} rounded-card p-5 flex items-start gap-4`}>
                  <span className={`w-10 h-10 rounded-xl ${iconBg} text-white flex items-center justify-center shrink-0`}>
                    <Icon size={20} />
                  </span>
                  <div>
                    <p className={`font-bold ${accent}`}>{name}</p>
                    <p className="text-sm text-brand-grey-dark mt-1 leading-relaxed">{blurb}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Step 1 — Choose how you take part ─────────────────────────── */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <div className="flex flex-wrap items-baseline gap-3 mb-2">
            <span className="font-subheading font-bold text-brand-blue tracking-wide">STEP 1</span>
            <h2 className="text-3xl font-bold text-brand-blue-dark">Choose how you take part</h2>
          </div>
          <p className="text-lg text-brand-grey-dark mb-9 max-w-2xl leading-relaxed">
            Both pathways run the same competitions — pick the one that fits your schedule, geography,
            and budget.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {pathways.map((p) => (
              <div key={p.name} className="border border-line rounded-card-lg overflow-hidden bg-white shadow-card flex flex-col">
                <div className={`${p.headerClass} text-white px-6 py-6`}>
                  <p className="text-xs font-bold uppercase tracking-[0.08em] text-white/75">{p.eyebrow}</p>
                  <p className="text-2xl font-bold mt-1">{p.name}</p>
                  <p className="text-sm text-white/85 mt-1">{p.tagline}</p>
                </div>
                <div className="px-6 pb-6 pt-2 flex flex-col flex-1">
                  {p.rows.map(([label, value], i) => (
                    <div
                      key={label}
                      className={`flex justify-between gap-4 py-3.5 ${i < p.rows.length - 1 ? 'border-b border-line-light' : ''}`}
                    >
                      <span className="text-sm text-brand-grey">{label}</span>
                      <span className="text-sm font-semibold text-brand-blue-dark text-right">{value}</span>
                    </div>
                  ))}
                  <Link
                    href={p.cta.href}
                    className={`mt-4 inline-flex items-center gap-2 font-semibold text-sm px-4 py-3 rounded-lg transition-colors self-start ${p.cta.className}`}
                  >
                    {p.cta.label} <ArrowRight size={16} />
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {/* Where it leads — progression */}
          <div className="mt-7 border border-line rounded-card-lg p-6 bg-brand-grey-light/40">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <p className="font-bold text-brand-blue-dark">Where it leads</p>
              <span className="text-xs font-bold uppercase tracking-[0.05em] text-brand-gold-ink bg-amber-50 rounded-full px-3 py-1">
                More info coming soon
              </span>
            </div>
            <div className="flex flex-wrap items-stretch gap-3">
              <div className="flex-1 min-w-[160px] bg-white border border-line rounded-card p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-brand-blue mb-1">Take part</p>
                <p className="text-sm font-semibold text-brand-blue-dark">Enter a Campaign or Event</p>
              </div>
              <div className="flex items-center text-content-faint">
                <ArrowRight size={22} />
              </div>
              <div className="flex-1 min-w-[160px] bg-white border border-line rounded-card p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-purple-600 mb-1">Advance</p>
                <p className="text-sm font-semibold text-brand-blue-dark">Top teams progress to the finals</p>
              </div>
              <div className="flex items-center text-content-faint">
                <ArrowRight size={22} />
              </div>
              <div className="flex-1 min-w-[160px] bg-amber-50 border border-amber-200 rounded-card p-4">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-brand-gold-ink mb-1">
                  <Star size={13} className="fill-current" /> The final
                </p>
                <p className="text-sm font-bold text-brand-gold-ink">Annual Championship event</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Step 2 — Pick a theme ─────────────────────────────────────── */}
      <section className="section-padding bg-brand-grey-light">
        <div className="container-max">
          <div className="flex flex-wrap items-baseline gap-3 mb-2">
            <span className="font-subheading font-bold text-purple-600 tracking-wide">STEP 2</span>
            <h2 className="text-3xl font-bold text-brand-blue-dark">Pick a theme</h2>
          </div>
          <p className="text-lg text-brand-grey-dark mb-9 max-w-2xl leading-relaxed">
            Each competition is built on one real-world theme for the 2027 school year. Open to all
            high school students.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {themes.map(({ name, Icon, iconBg, accent, border, headerBg, briefBg, blurb, explore, brief }) => (
              <div key={name} className={`bg-white border ${border} rounded-card-lg overflow-hidden`}>
                <div className={`${headerBg} px-7 pt-7 pb-6`}>
                  <div className="flex items-center gap-3">
                    <span className={`w-11 h-11 rounded-xl ${iconBg} text-white flex items-center justify-center`}>
                      <Icon size={22} />
                    </span>
                    <p className={`text-2xl font-bold ${accent}`}>{name}</p>
                  </div>
                  <p className="text-brand-grey-dark mt-4 leading-relaxed">{blurb}</p>
                </div>
                <div className="px-7 pb-7 pt-4">
                  <p className={`text-xs font-bold uppercase tracking-[0.05em] ${accent} mb-3`}>
                    What students explore
                  </p>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2.5">
                    {explore.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm text-brand-grey-dark">
                        <span className={`${accent} font-bold leading-5`}>·</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                  <p className={`mt-5 ${briefBg} rounded-xl px-4 py-3 text-sm text-brand-grey-dark leading-relaxed`}>
                    <strong className={accent}>Example brief:</strong> {brief}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Step 3 — See what's included ──────────────────────────────── */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <div className="flex flex-wrap items-baseline gap-3 mb-2">
            <span className="font-subheading font-bold text-emerald-600 tracking-wide">STEP 3</span>
            <h2 className="text-3xl font-bold text-brand-blue-dark">See what&rsquo;s included</h2>
          </div>
          <p className="text-lg text-brand-grey-dark max-w-3xl leading-relaxed">
            Core material is, and always will be, <strong className="text-brand-blue-dark">free</strong>.
            Unlock your membership — by participating in a competition — to gather the tools and
            resources to succeed.
          </p>

          {showMaterialTiers ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-8 items-start">
                {tiers.map((tier) => (
                  <div
                    key={tier.name}
                    className={`rounded-card bg-white overflow-hidden flex flex-col ${
                      tier.featured ? 'border-2 border-brand-blue shadow-float' : 'border border-line'
                    }`}
                  >
                    {tier.badge && (
                      <div className="bg-brand-blue text-white text-center text-[10.5px] font-bold uppercase tracking-[0.06em] py-1.5">
                        {tier.badge}
                      </div>
                    )}
                    <div className="px-5 pt-4 pb-3.5 border-b border-line-light">
                      <div className="flex justify-between items-baseline gap-2">
                        <p className="font-bold text-brand-blue-dark">{tier.name}</p>
                        <p
                          className={`font-bold text-sm ${
                            tier.price === 'Free' ? 'text-emerald-600' : 'text-brand-blue-dark'
                          }`}
                        >
                          {tier.price}
                        </p>
                      </div>
                      <p className="text-xs text-brand-grey mt-1">{tier.accessNote}</p>
                    </div>
                    <div className="px-5 pt-3.5 pb-5 flex flex-col gap-2.5">
                      {tier.inheritsFrom && (
                        <p className="text-[11.5px] font-bold uppercase tracking-wide text-content-faint">
                          Everything in {tier.inheritsFrom}, plus
                        </p>
                      )}
                      {tier.items.map((item) => (
                        <p key={item} className="text-sm text-brand-grey-dark leading-snug">
                          {item}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex flex-col gap-1.5">
                <p className="text-sm text-brand-grey">
                  Registering for a Competition assigns your students{' '}
                  <strong className="text-brand-grey-dark">Explorer</strong> membership as well.
                </p>
                <Link href="/membership" className="text-sm font-semibold text-brand-blue inline-flex items-center gap-1">
                  View membership tiers <ArrowRight size={14} />
                </Link>
              </div>
            </>
          ) : (
            <div className="mt-8 border border-dashed border-line rounded-card-lg p-9 bg-brand-grey-light text-center">
              <p className="font-bold text-brand-blue-dark">Membership tiers are being reworked</p>
              <p className="text-brand-grey-dark mt-1.5">
                This section is hidden while the new membership structure is finalised.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────── */}
      <section className="section-padding bg-white pt-0">
        <div className="container-max">
          <div className="bg-brand-blue-dark rounded-card-lg px-10 py-12 text-white flex flex-wrap items-center justify-between gap-8">
            <div>
              <h2 className="text-3xl font-bold mb-2">Ready to start?</h2>
              <p className="text-content-faint max-w-md leading-relaxed">
                Register for an upcoming live event, or download curriculum to run a campaign in your
                classroom.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/events" className="btn-primary">
                View Events
              </Link>
              <Link href="/activities" className="btn-outline-white">
                Download Curriculum
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
