import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Launch, Environment } from '@stellr/icons'
import { getTierPriceMap, formatTierPrice } from '@/lib/tier-pricing'
import {
  Hero,
  SectionHeading,
  Eyebrow,
  Button,
  CtaBand,
  StepCard,
  PathwayCard,
  ThemeCard,
  TierCard,
  ProgressionGraphic,
} from '@stellr/web-ui'
import { StudentWorkHero } from '@/components/sections/StudentWorkHero'

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
    headerClass: 'bg-gradient-to-br from-primary to-primary-deep',
    rows: [
      ['Who runs it', 'Stellr staff'],
      ['Where', 'In-person or virtual'],
      ['How long', 'Fixed dates'],
      ['Students deliver', 'Full presentation'],
      ['Best for', 'A flagship, dated challenge'],
    ] as [string, string][],
    cta: { label: 'Browse upcoming events', href: '/events', className: 'bg-primary-soft text-primary hover:bg-primary/15' },
  },
  {
    eyebrow: 'Pathway 2',
    name: 'Curriculum Campaign',
    tagline: 'You run it in class, from our curriculum',
    headerClass: 'bg-gradient-to-br from-pathway-amber to-[#C2722A]',
    rows: [
      ['Who runs it', 'You, the educator'],
      ['Where', 'Your school or classroom'],
      ['Delivered via', 'Stellr curriculum & lesson plans'],
      ['How long', 'Flexible — you set the pace'],
      ['Students deliver', 'Written proposal or presentation'],
      ['Best for', 'Fitting STEM into your semester'],
    ] as [string, string][],
    cta: { label: 'Download curriculum', href: '/curriculum', className: 'bg-pathway-amber-bg text-brand-gold-ink hover:bg-pathway-amber/15' },
  },
]

const themes = [
  {
    name: 'Space',
    Icon: Launch,
    accent: 'text-space-violet-text',
    iconBg: 'bg-space-violet',
    headerBg: 'bg-gradient-to-b from-space-violet-bg to-white',
    border: 'border-space-violet-chip',
    briefBg: 'bg-space-violet-bg',
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
    Icon: Environment,
    accent: 'text-enviro-green-text',
    iconBg: 'bg-enviro-green',
    headerBg: 'bg-gradient-to-b from-enviro-green-bg to-white',
    border: 'border-enviro-green-chip',
    briefBg: 'bg-enviro-green-bg',
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
  /** Injected from membership_tiers at render (see CompetitionsPage) — not hard-coded. */
  price?: string
  accessNote: string
  inheritsFrom?: string
  badge?: string
  featured?: boolean
  items: string[]
}

/* Teacher membership tiers — kept in sync with the /membership explorer
   (app/(public)/membership/tier-data.ts → educator audience + waterfall). */
const tiers: Tier[] = [
  {
    name: 'Educator',
    accessNote: 'Free with a member account',
    items: [
      'Request for Proposal (RFP) & Mission Handbook',
      'Scoring rubric',
      'Competition Guide for Teachers',
      'Basic assessment tools',
      'Students can register as members',
    ],
  },
  {
    name: 'Catalyst',
    accessNote: 'Competition toolkit',
    inheritsFrom: 'Educator',
    items: [
      'Lesson plans',
      'Worksheets — cost control, Gantt, materials',
      'Judging template',
      'Intro & close-out calls + slides',
      'Intermediate assessment tools',
    ],
  },
  {
    name: 'Innovator',
    accessNote: 'Mentoring & AI tools',
    inheritsFrom: 'Catalyst',
    badge: 'Best Value',
    featured: true,
    items: [
      'Group mentoring — 8 × 30-min / semester (recorded)',
      'Agentic AI sub-contractors + project advisor',
      'Biweekly student feedback calls',
      'Advanced assessment tools & question banks',
      'Common Core alignment',
      'Students invited as Explorer',
    ],
  },
  {
    name: 'Trailblazer',
    accessNote: 'For teachers who excel',
    inheritsFrom: 'Innovator',
    items: [
      'Student awards presented',
      'Virtual presentation deliverable (Zoom)',
      'CTE credits · NGSS & ISTE alignment',
      'LMS upload (SCORM)',
      'Students upgraded to Pathfinder (12 months)',
    ],
  },
]

export default async function CompetitionsPage() {
  const tierPrices = await getTierPriceMap()
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <Hero
        breadcrumb="Educate → Competitions"
        pill={{ accent: 'Themed Competitions', rest: 'In class, or join an event' }}
        title="Design Competitions"
        lead="Real professional STEM skills for high school students — delivered through competitive, industry-simulation activities."
        pills={['High school students', 'State & national', 'Free for students to enter']}
      />

      {/* ── Rotating showcase of previous student work ─────────────────── */}
      <section className="section-padding bg-white border-b border-line">
        <div className="container-max">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            <div>
              <Eyebrow>Previous student work</Eyebrow>
              <h2 className="text-3xl font-bold text-ink mt-3">Real work from real competitions</h2>
              <p className="text-content-secondary mt-3 leading-relaxed max-w-lg">
                A rotating look at the proposals, presentations and designs students have produced — the
                kind of deliverable every team builds and pitches.
              </p>
            </div>
            <StudentWorkHero />
          </div>
        </div>
      </section>

      {/* ── What's a Design Competition? ──────────────────────────────── */}
      <section className="section-padding bg-surface border-b border-line">
        <div className="container-max">
          <Eyebrow>Start here</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3 max-w-3xl">What&rsquo;s a Design Competition?</h2>

          {/* Dictionary-style definition */}
          <div className="mt-5 max-w-3xl rounded-ds-card border-l-4 border-primary bg-white px-6 py-5 shadow-card-lift">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-display text-2xl font-bold text-ink">Design Competition</span>
              <span className="text-sm font-semibold uppercase tracking-[0.08em] text-content-faint">noun</span>
              <span className="text-base italic text-content-muted">dɪˈzaɪn kɒmpɪˈtɪʃn</span>
            </div>
            <p className="mt-2.5 text-lg text-content-secondary leading-relaxed">
              A high-intensity industry-simulation event, in which students adopt professional roles, are
              given industry-specific challenges, and deliver real-world solutions.
            </p>
          </div>

          <p className="text-lg text-content-secondary mt-6 max-w-3xl leading-relaxed">
            Students step into the role of a professional engineering team. They&rsquo;re handed a
            real-world brief — a <strong className="text-ink">Request for Proposal (RFP)</strong> — and
            have to research, design, and justify a working solution, then pitch it. It&rsquo;s a genuine
            industry simulation, scaled for the classroom.
          </p>

          {/* What students actually do */}
          <p className="font-subheading font-semibold uppercase tracking-[0.08em] text-sm text-content-muted mt-10 mb-5">
            What students actually do
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {studentSteps.map((step) => (
              <StepCard key={step.n} {...step} />
            ))}
          </div>

          {/* The output callout */}
          <div className="mt-6 flex flex-wrap items-center gap-4 bg-ink rounded-ds-card px-6 py-5 text-white">
            <span className="font-subheading font-semibold uppercase tracking-[0.06em] text-xs text-brand-orange shrink-0">
              The output
            </span>
            <span className="text-base text-hero-lead leading-relaxed flex-1 min-w-[280px]">
              Every team produces a <strong className="text-white">deliverable</strong> — a written
              proposal or a live presentation — assessed against an industry-style marking rubric.
            </span>
          </div>

          {/* STEM Power Skills */}
          <div className="mt-4 flex flex-wrap items-center gap-4 bg-white border border-line rounded-ds-card px-6 py-5">
            <span className="font-subheading font-semibold uppercase tracking-[0.06em] text-xs text-primary shrink-0">
              STEM Power Skills
            </span>
            <span className="text-base text-content-secondary leading-relaxed flex-1 min-w-[280px]">
              Beyond the engineering, students build the{' '}
              <strong className="text-ink">soft skills industry hires for</strong> — communication,
              teamwork, project management and presenting under pressure.
            </span>
          </div>

          {/* Theme teaser */}
          <div className="mt-11">
            <p className="font-subheading font-semibold uppercase tracking-[0.08em] text-sm text-content-muted mb-2">
              Every competition is themed
            </p>
            <p className="text-content-secondary mb-5 max-w-2xl leading-relaxed">
              For the 2027 school year, students choose from two real-world themes. Full detail is in
              Step 2 below.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {themes.map(({ name, Icon, iconBg, accent, border, blurb }) => (
                <div key={name} className={`bg-white border ${border} rounded-ds-card p-5 flex items-start gap-4`}>
                  <span className={`w-10 h-10 rounded-xl ${iconBg} text-white flex items-center justify-center shrink-0`}>
                    <Icon size={20} />
                  </span>
                  <div>
                    <p className={`font-bold ${accent}`}>{name}</p>
                    <p className="text-sm text-content-secondary mt-1 leading-relaxed">{blurb}</p>
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
          <SectionHeading step="STEP 1" title="Choose how you take part" className="mb-2" />
          <p className="text-lg text-content-secondary mb-9 max-w-2xl leading-relaxed">
            Both pathways run the same competitions — pick the one that fits your schedule, geography,
            and budget.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {pathways.map((p) => (
              <PathwayCard key={p.name} {...p} linkAs={Link} />
            ))}
          </div>

          <ProgressionGraphic
            heading="Where it leads"
            note="More info coming soon"
            nodes={[
              { label: 'Take part', labelClass: 'text-primary', title: 'Enter a Campaign or Event' },
              { label: 'Advance', labelClass: 'text-space-violet', title: 'Top teams progress to the finals' },
              {
                label: 'The final',
                labelClass: 'text-brand-gold-ink',
                title: 'Annual Championship event',
                titleClass: 'text-brand-gold-ink',
                cardClass: 'bg-pathway-amber-bg border border-pathway-amber/30',
                star: true,
              },
            ]}
          />
        </div>
      </section>

      {/* ── Step 2 — Pick a theme ─────────────────────────────────────── */}
      <section className="section-padding bg-surface">
        <div className="container-max">
          <SectionHeading step="STEP 2" stepClassName="text-space-violet" title="Pick a theme" className="mb-2" />
          <p className="text-lg text-content-secondary mb-9 max-w-2xl leading-relaxed">
            Each competition is built on one real-world theme for the 2027 school year. Open to all high
            school students.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {themes.map((t) => (
              <ThemeCard key={t.name} {...t} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Step 3 — See what's included ──────────────────────────────── */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <SectionHeading step="STEP 3" stepClassName="text-enviro-green" title={<>See what&rsquo;s included</>} className="mb-2" />
          <p className="text-lg text-content-secondary max-w-3xl leading-relaxed">
            Core material is, and always will be, <strong className="text-ink">free</strong>. Unlock your
            membership — by participating in a competition — to gather the tools and resources to succeed.
          </p>

          {showMaterialTiers ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-8 items-start">
                {tiers.map((tier) => (
                  <TierCard key={tier.name} {...tier} price={formatTierPrice(tierPrices[tier.name])} />
                ))}
              </div>

              <div className="mt-5 flex flex-col gap-1.5">
                <p className="text-sm text-content-muted">
                  Registering for a Competition assigns your students{' '}
                  <strong className="text-content-secondary">Explorer</strong> membership as well.
                </p>
                <Link href="/membership" className="text-sm font-semibold text-primary inline-flex items-center gap-1">
                  View membership tiers <ArrowRight size={14} />
                </Link>
              </div>
            </>
          ) : (
            <div className="mt-8 border border-dashed border-line rounded-panel p-9 bg-surface text-center">
              <p className="font-bold text-ink">Membership tiers are being reworked</p>
              <p className="text-content-secondary mt-1.5">
                This section is hidden while the new membership structure is finalised.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────── */}
      <CtaBand
        title="Ready to start?"
        body="Register for an upcoming live event, or download curriculum to run a campaign in your classroom."
        actions={
          <>
            <Button href="/events" as={Link} variant="primary">
              View Events
            </Button>
            <Button href="/curriculum" as={Link} variant="outlineWhite">
              Download Curriculum
            </Button>
          </>
        }
      />
    </>
  )
}
