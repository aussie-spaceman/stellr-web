import type { Metadata } from 'next'
import Link from 'next/link'
import { Global, Team, Satellite, Idea, Launch, Environment } from '@stellr/icons'
import { Hero, Eyebrow, Button, CtaBand, StepCard, PathwayCard } from '@stellr/web-ui'
import { WorkCard } from '@/components/sections/WorkCard'
import { FutureHistoryCycle } from '@/components/sections/FutureHistoryCycle'
import { COMPETITION } from '@/lib/media-manifest'
import { CURRENT_SCHOOL_YEAR, eraForSchoolYear, inSentence, storyYear } from '@/lib/future-history'

/* The world every competition is set in, told from what students do in it —
   the same at a live Challenge and in a classroom Campaign. Kept generic on
   purpose: company and supplier names change each year, so the page describes
   roles, not the cast (David, 27 Oct 2026). The year and region come from
   lib/future-history.ts. Never reveal the RFP here. */

const era = eraForSchoolYear(CURRENT_SCHOOL_YEAR)
const year = storyYear(CURRENT_SCHOOL_YEAR)

export const metadata: Metadata = {
  title: 'Future History',
  description: `Every Stellr competition is set in a forecast future, 20 to 35 years ahead. This year: ${era.name}, ${year}. See the world students step into and what they do in it, at a live Challenge or in a classroom Campaign.`,
  alternates: { canonical: '/competitions/mission' },
}

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

const roles = [
  {
    Icon: Global,
    title: 'The client',
    body: 'A global agency funding humanity’s future, on Earth and across the solar system. It issues the Request for Proposal (RFP), sets the requirements, and its judges decide what a winning design looks like.',
  },
  {
    Icon: Team,
    title: 'Your company',
    body: 'One of three rival engineering companies bidding for the same contract, each with its own history, strengths, weaknesses and finances. At a Challenge you’re placed in one on the day; in a Campaign, your group becomes one.',
  },
  {
    Icon: Satellite,
    title: 'Subcontractors',
    body: 'Specialist firms that sell to every company: atmosphere processing, construction materials and more. You choose which to hire, set what they must deliver, and carry their cost in your budget.',
  },
  {
    Icon: Idea,
    title: 'Your role',
    body: 'Inside your company, students take professional roles — executives, department leads and engineers. You split the work, then pull it back together into one proposal.',
  },
]

const steps = [
  { n: 1, title: 'Read the future history', body: 'The world your client remembers. Every requirement in the brief has a reason in it.' },
  { n: 2, title: 'Get the brief', body: 'A Request for Proposal: what the client needs — never how to build it.' },
  { n: 3, title: 'Organize your company', body: 'Choose leaders, split the requirements across departments, set your own deadlines.' },
  { n: 4, title: 'Design and decide', body: 'Research, calculate and run trade studies. Choose your subcontractors and hold them to account.' },
  { n: 5, title: 'Deliver the proposal', body: 'A live presentation to judges at a Challenge, or a written proposal in a Campaign.' },
  { n: 6, title: 'Win the contract', body: 'Judges choose the winning company; mentors choose standout individuals for awards.' },
]

const pathways = [
  {
    eyebrow: 'In person',
    name: 'Live Challenge',
    tagline: 'One or two days at a venue near you',
    headerClass: 'bg-gradient-to-br from-primary to-primary-deep',
    rows: [
      ['Your company', 'Formed on the day'],
      ['Time', 'Fixed, and tight'],
      ['You deliver', 'A live presentation'],
      ['Judged by', 'Industry professionals'],
    ] as [string, string][],
    cta: { label: 'Browse events', href: '/events', className: 'bg-primary-soft text-primary hover:bg-primary/15' },
  },
  {
    eyebrow: 'At school',
    name: 'Campaign',
    tagline: 'In class or as a club, on your schedule',
    headerClass: 'bg-gradient-to-br from-pathway-amber to-pathway-amber-deep',
    rows: [
      ['Your company', 'Your group'],
      ['Time', 'You set the pace'],
      ['You deliver', 'A written proposal'],
      ['Judged by', 'Stellr’s panel, with written feedback'],
    ] as [string, string][],
    cta: { label: 'Download curriculum', href: '/curriculum', className: 'bg-pathway-amber-bg text-gold-ink hover:bg-pathway-amber/15' },
  },
]

export default function FutureHistoryPage() {
  return (
    <>
      <Hero
        breadcrumb="Educate → Competitions → Future History"
        pill={{ accent: 'Future History', rest: `This year: ${era.name}, ${year}` }}
        title="Your competition is set in the future"
        lead="Every Stellr competition drops students into a future history: a forecast world 20 to 35 years from now, with a client, a contract and a deadline. At a live Challenge or in a classroom Campaign, the job is the same — win the contract."
      >
        <div className="mt-8 flex flex-wrap gap-3">
          <Button href="/events" as={Link} variant="primary">
            Browse events
          </Button>
          <Button href="/curriculum" as={Link} variant="outlineWhite">
            Download curriculum
          </Button>
        </div>
      </Hero>

      {/* ── This year's world ─────────────────────────────────────────── */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <Eyebrow>The {CURRENT_SCHOOL_YEAR} school year</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3">It is {year}.</h2>
          <p className="text-lg text-content-secondary mt-3 max-w-3xl leading-relaxed">
            A quarter-century of forecast history has turned spaceflight into a working solar economy, with a
            client that has the budget to build what comes next. Students read that history as their client&rsquo;s
            memory: every requirement in the brief exists because of it.
          </p>

          <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="rounded-panel border border-space-violet-chip bg-gradient-to-b from-space-violet-bg to-white p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-space-violet text-white">
                  <Launch size={22} />
                </span>
                <p className="text-xl font-bold text-space-violet-text">Space · {era.name}</p>
              </div>
              <p className="mt-4 text-content-secondary leading-relaxed">
                This year&rsquo;s space competitions are set around {inSentence(era.scope)}. {era.designDrivers}
              </p>
            </div>
            <div className="rounded-panel border border-enviro-green-chip bg-gradient-to-b from-enviro-green-bg to-white p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-enviro-green text-white">
                  <Environment size={22} />
                </span>
                <p className="text-xl font-bold text-enviro-green-text">Environmental · Earth</p>
              </div>
              <p className="mt-4 text-content-secondary leading-relaxed">
                Running alongside, in the same year: the client&rsquo;s long-term program to restore the home
                world. Same future history, same client — the brief is on Earth.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── The four-year rotation ────────────────────────────────────── */}
      <section className="section-padding bg-surface">
        <div className="container-max">
          <Eyebrow className="text-space-violet-text">Four-year rotation</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3">A new part of the solar system every year</h2>
          <p className="text-lg text-content-secondary mt-3 mb-8 max-w-3xl leading-relaxed">
            Space competitions move outward one region per school year, each set further into the future.
          </p>
          <FutureHistoryCycle />
        </div>
      </section>

      {/* ── Who's who ─────────────────────────────────────────────────── */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <Eyebrow>The cast</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3">Who&rsquo;s who in the future history</h2>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {roles.map(({ Icon, title, body }) => (
              <div key={title} className="rounded-ds-card border border-line bg-white p-5 shadow-card">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <Icon size={22} />
                </span>
                <h3 className="mt-4 font-bold text-ink">{title}</h3>
                <p className="mt-2 text-sm text-content-secondary leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── What you'll do ────────────────────────────────────────────── */}
      <section className="section-padding bg-surface">
        <div className="container-max">
          <Eyebrow>The job</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3">What you&rsquo;ll do</h2>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {steps.map((step) => (
              <StepCard key={step.n} {...step} />
            ))}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-4 rounded-ds-card bg-ink px-6 py-5 text-white">
            <span className="font-subheading text-xs font-semibold uppercase tracking-[0.06em] text-donate-gold shrink-0">
              No right answers
            </span>
            <span className="text-base text-hero-lead leading-relaxed flex-1 min-w-0 basis-full sm:basis-auto sm:min-w-[280px]">
              The brief never asks for the correct design, because there isn&rsquo;t one. What separates winners
              is <strong className="text-white">justification</strong>: the trade-off you faced, the options you
              weighed, and why your priorities chose this answer.
            </span>
          </div>

          <p className="mt-6 text-content-secondary">
            Then the awards.{' '}
            <Link href="/competitions#awards" className="font-semibold text-primary-deep hover:underline">
              See what students can win
            </Link>
            .
          </p>
        </div>
      </section>

      {/* ── Same future, two ways in ──────────────────────────────────── */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <Eyebrow>Two ways in</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3">Same future, same contract</h2>
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {pathways.map((p) => (
              <PathwayCard key={p.name} {...p} linkAs={Link} />
            ))}
          </div>
          <WorkCard asset={COMPETITION['mission-handbook-2026']} eyebrow="Previous Competition Resource" className="mt-8 max-w-lg" />
        </div>
      </section>

      <CtaBand
        title={`Step into ${year}`}
        body="Register for a live Challenge, or run a Campaign with your class."
        actions={
          <>
            <Button href="/events" as={Link} variant="primary">
              View Events
            </Button>
            <Button href={`${AUTH_URL}/sign-up?audience=educator`} variant="outlineWhite">
              Register as an Educator
            </Button>
          </>
        }
      />
    </>
  )
}
