import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Check } from 'lucide-react'
import { Document, Award, Orbit, Environment } from '@stellr/icons'
import { Hero, Eyebrow, Button } from '@stellr/web-ui'
import { getAllCampaigns } from '@/lib/sanity'
import { getCampaignDates, campaignStatusFromDates, type CampaignSeason } from '@/lib/campaigns'

export const metadata: Metadata = {
  title: 'Activities',
  description:
    'Download real engineering challenge material and run it in your classroom any time, for free. Optionally enter a seasonal Campaign for a path to the national championships.',
}

export const revalidate = 3600

interface Campaign {
  _id: string
  title: string
  season?: CampaignSeason
  campaignYear?: number
  registrationOpen?: boolean
}

const FALLBACK_CAMPAIGNS: Campaign[] = [
  { _id: 'fallback-1', title: '2027 Space Design Campaign', season: 'fall', campaignYear: 2026 },
  { _id: 'fallback-2', title: '2027 Environmental Design Campaign', season: 'spring', campaignYear: 2027 },
]

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'
const SIGNUP_URL = `${AUTH_URL}/signup`

const gettingStarted = [
  {
    n: 1,
    title: 'Create your free account',
    body: 'Always free. Access the Competition material and see how you could use it in your classroom.',
    amber: false,
  },
  {
    n: 2,
    title: 'Unlock the full material',
    body: (
      <>
        Teachers can choose to upgrade their membership to access lesson plans, support material, and CTE
        credits. See{' '}
        <Link href="/membership" className="font-semibold text-primary">
          membership
        </Link>{' '}
        for details.
      </>
    ),
    amber: false,
  },
  {
    n: 3,
    title: 'Teach it on your schedule',
    body: 'Run the challenge whenever suits your class. No deadlines unless you choose to enter a Campaign.',
    amber: false,
  },
  {
    n: 4,
    title: 'Optionally, enter a Campaign',
    body: 'Want it to count? Submit in the Fall or Spring window for a shot at the national championships.',
    amber: true,
  },
]

const themes = [
  {
    name: 'Space',
    Icon: Orbit,
    cardBg: 'bg-gradient-to-b from-space-violet-bg to-white',
    border: 'border-space-violet-chip',
    iconBg: 'bg-space-violet',
    pillText: 'text-space-violet-text',
    pillBg: 'bg-space-violet-chip',
    linkColor: 'text-space-violet',
    title: 'Space Design Challenge',
    blurb:
      'Engineering inspired by space exploration — students tackle the systems that keep a mission alive and on course.',
  },
  {
    name: 'Environmental',
    Icon: Environment,
    cardBg: 'bg-gradient-to-b from-enviro-green-bg to-white',
    border: 'border-enviro-green-chip',
    iconBg: 'bg-enviro-green',
    pillText: 'text-enviro-green-text',
    pillBg: 'bg-enviro-green-chip',
    linkColor: 'text-enviro-green-text',
    title: 'Environmental Design Challenge',
    blurb:
      'Real-world environmental problems solved through systems thinking, sustainable design and honest engineering trade-offs.',
  },
]

const freeBullets = [
  'Request for Proposal (RFP)',
  'Mission Handbook',
  'See how to use the material in your classroom',
]
const paidBullets = [
  'Lesson plans & support material',
  'CTE credits',
  'Worksheets, assessment guides & marking rubric',
  'Student certificates & awards',
  'Mentoring & coaching for award winners',
  'A path to the National Championships',
]

function pickWindow(campaigns: Campaign[], season: CampaignSeason, fallbackYear: number) {
  const match = campaigns.find((c) => c.season === season && c.campaignYear)
  const year = match?.campaignYear ?? fallbackYear
  const dates = getCampaignDates(season, year)
  const status = campaignStatusFromDates(dates, match?.registrationOpen)
  return { label: dates.label, status }
}

export default async function ActivitiesPage() {
  const sanityData = await getAllCampaigns().catch(() => null)
  const campaigns: Campaign[] = (sanityData as Campaign[] | null) ?? FALLBACK_CAMPAIGNS
  const fall = pickWindow(campaigns, 'fall', 2026)
  const spring = pickWindow(campaigns, 'spring', 2027)

  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <Hero
        breadcrumb="Competitions · Activities"
        title="Real engineering challenges, ready for your classroom."
        lead="Download the material and use it any time you like — it's yours to run on your own schedule. Or enter a seasonal Campaign and give your students a path all the way to the national championships."
      >
        <div className="flex flex-wrap gap-3 mt-8">
          <Button href={SIGNUP_URL} variant="primary">
            Get the material — free
          </Button>
          <Button href="#campaigns" variant="outlineWhite">
            Explore Campaigns <ArrowRight size={16} />
          </Button>
        </div>
        <div className="flex flex-wrap gap-x-7 gap-y-2 mt-10">
          {['Free to start', 'Use it on your own schedule', 'Available worldwide'].map((label) => (
            <span key={label} className="inline-flex items-center gap-2 text-[13.5px] text-hero-lead/70">
              <span className="w-[7px] h-[7px] rounded-full bg-enviro-green" /> {label}
            </span>
          ))}
        </div>
      </Hero>

      {/* ── Context breadcrumb ────────────────────────────────────────── */}
      <section className="bg-[#FBF0E3] border-b border-[#EDD9BE]">
        <div className="container-max px-4 sm:px-6 lg:px-8 py-6 flex flex-wrap items-center gap-5">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-gold-ink">
            Two ways to compete
          </span>
          {/* Active — Activities */}
          <div className="bg-white border-[1.5px] border-pathway-amber rounded-[10px] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="font-subheading font-bold text-ink text-sm">Activities</span>
              <span className="rounded-full bg-pathway-amber text-white text-[9.5px] font-bold uppercase tracking-wide px-2 py-0.5">
                You are here
              </span>
            </div>
            <p className="text-xs text-content-muted mt-0.5">Classroom · on your schedule</p>
          </div>
          <span className="font-subheading font-bold text-[#C0A877]">or</span>
          {/* Events */}
          <Link
            href="/events"
            className="group bg-white border border-[#ECD9BC] rounded-[10px] px-4 py-2.5 flex items-center gap-3 transition-colors hover:border-pathway-amber"
          >
            <div>
              <span className="font-subheading font-bold text-[#A98C5E] text-sm">Events</span>
              <p className="text-xs text-content-muted mt-0.5">Live · in-person, fixed dates</p>
            </div>
            <ArrowRight size={16} className="text-primary" />
          </Link>
          <p className="text-[13.5px] text-[#9A8453] max-w-[300px] leading-snug">
            Both are Stellr Competitions. Activities brings the same challenges into your classroom.
          </p>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────── */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3">Use the material your way.</h2>
          <p className="text-content-secondary mt-3 max-w-xl leading-relaxed">
            Take the material into your classroom whenever it suits you — and enter a Campaign only if you
            want the competition edge.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-9 items-stretch">
            {/* Card A — anytime */}
            <div className="flex flex-col bg-white border border-line rounded-panel p-7 shadow-card-lift">
              <span className="w-[50px] h-[50px] rounded-[13px] bg-primary-soft text-primary flex items-center justify-center">
                <Document size={26} />
              </span>
              <p className="text-xs font-subheading font-semibold uppercase tracking-[0.1em] text-primary mt-5">
                Always available
              </p>
              <h3 className="text-xl font-bold text-ink mt-1">Use the material any time</h3>
              <ul className="mt-4 space-y-2.5 flex-1">
                {[
                  'Run it on your own schedule, at your own pace',
                  'Free Core Material — no account required to preview',
                  'See how it fits your classroom before you upgrade',
                ].map((b) => (
                  <li key={b} className="flex gap-2.5 text-sm text-content-secondary leading-relaxed">
                    <Check size={18} className="shrink-0 mt-0.5 text-primary" /> {b}
                  </li>
                ))}
              </ul>
              <Button href="#tiers" variant="primary" className="mt-6 self-start">
                Get the material <ArrowRight size={16} />
              </Button>
            </div>

            {/* Card B — campaign */}
            <div className="relative flex flex-col bg-gradient-to-b from-[#FFF8EF] to-white border-[1.5px] border-pathway-amber rounded-panel p-7 shadow-[0_18px_40px_-30px_rgba(224,146,47,0.45)]">
              <span className="absolute top-5 right-5 rounded-full bg-pathway-amber-bg text-brand-gold-ink text-xs font-bold uppercase tracking-wide px-3 py-1">
                Optional
              </span>
              <span className="w-[50px] h-[50px] rounded-[13px] bg-pathway-amber-bg text-pathway-amber flex items-center justify-center">
                <Award size={26} />
              </span>
              <p className="text-xs font-subheading font-semibold uppercase tracking-[0.1em] text-pathway-amber mt-5">
                Twice a year · Fall &amp; Spring
              </p>
              <h3 className="text-xl font-bold text-ink mt-1">Enter a Campaign</h3>
              <ul className="mt-4 space-y-2.5 flex-1">
                {[
                  'Two windows a year — Fall and Spring',
                  'A path to national championship activities',
                  'Register in minutes — not required to use the material',
                ].map((b) => (
                  <li key={b} className="flex gap-2.5 text-sm text-content-secondary leading-relaxed">
                    <Check size={18} className="shrink-0 mt-0.5 text-pathway-amber" /> {b}
                  </li>
                ))}
              </ul>
              <Button href="#campaigns" variant="energy" className="mt-6 self-start">
                See the Campaigns <ArrowRight size={16} />
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Competition Themes ────────────────────────────────────────── */}
      <section className="section-padding bg-surface">
        <div className="container-max">
          <Eyebrow>Competitions</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3">Competition Themes</h2>
          <p className="text-content-secondary mt-3 max-w-2xl leading-relaxed">
            Both build from first principles — no prior experience needed. Download and teach either one
            today, and you can enter your students into either Campaign if you want to give them that extra
            edge.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-9 items-stretch">
            {themes.map((t) => (
              <div key={t.name} className={`flex flex-col rounded-panel border ${t.border} ${t.cardBg} p-7`}>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className={`w-11 h-11 rounded-xl text-white flex items-center justify-center ${t.iconBg}`}>
                    <t.Icon size={22} />
                  </span>
                  <span className={`rounded-full text-xs font-bold px-3 py-1 ${t.pillBg} ${t.pillText}`}>
                    ✦ {t.name}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-enviro-green-bg text-enviro-green-text text-xs font-bold px-3 py-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-enviro-green" /> Available now
                  </span>
                </div>
                <h3 className="text-xl font-bold text-ink mt-4">{t.title}</h3>
                <p className="text-content-secondary mt-2 leading-relaxed flex-1">{t.blurb}</p>
                <div className="mt-5 bg-white rounded-[10px] border border-line px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-content-faint">Access</p>
                  <p className="text-sm text-content-secondary mt-0.5">
                    Free account, then upgrade for the full material
                  </p>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-4">
                  <Button href="#tiers" variant="primary">
                    Get the material
                  </Button>
                  <a
                    href="#campaigns"
                    className={`inline-flex items-center gap-1 text-sm font-semibold ${t.linkColor}`}
                  >
                    Enter a Campaign <ArrowRight size={14} />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Campaigns ─────────────────────────────────────────────────── */}
      <section id="campaigns" className="section-padding bg-white scroll-mt-24">
        <div className="container-max">
          <div className="rounded-cta overflow-hidden bg-gradient-to-br from-[#1B2350] to-[#10153A] text-white">
            <div className="px-7 sm:px-11 pt-10">
              <Eyebrow className="text-[#F0B864]">Campaigns · optional</Eyebrow>
              <h2 className="text-display font-bold mt-3 max-w-xl leading-tight">
                Two Campaigns a year. A path to the national championships.
              </h2>
              <p className="text-hero-lead mt-4 max-w-2xl leading-relaxed">
                Classes, clubs, and student groups can choose to take the Competition material and
                participate in a Campaign — competing with others nationally. Submitting student work opens
                the door to award winners receiving industry-leading mentoring and coaching, and the
                possibility of invites to National Championships!
              </p>
            </div>
            {/* Window cells */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-white/[0.08] mt-9">
              {/* Fall */}
              <div className="bg-[#10153A] px-7 sm:px-11 py-8">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-enviro-green/20 text-[#6FE3C0] text-xs font-bold px-3 py-1">
                  {fall.status === 'Open' ? 'Open now' : fall.status}
                </span>
                <p className="text-hero-dim text-sm font-semibold mt-3">{fall.label}</p>
                <h3 className="text-xl font-bold mt-1">Fall Campaign</h3>
                <p className="text-hero-lead text-sm mt-2 leading-relaxed">
                  Kick off in the autumn term and submit before the winter break.
                </p>
                <Button href={SIGNUP_URL} variant="energy" className="mt-5">
                  Register your class <ArrowRight size={16} />
                </Button>
              </div>
              {/* Spring */}
              <div className="bg-[#10153A] px-7 sm:px-11 py-8">
                <span className="inline-flex items-center rounded-full bg-white/10 text-hero-lead text-xs font-bold px-3 py-1">
                  {spring.status === 'Open' ? 'Open now' : 'Opens later'}
                </span>
                <p className="text-hero-dim text-sm font-semibold mt-3">{spring.label}</p>
                <h3 className="text-xl font-bold mt-1">Spring Campaign</h3>
                <p className="text-hero-lead text-sm mt-2 leading-relaxed">
                  Run it in the new year — perfect for a spring-semester project.
                </p>
                <Button href="/contact" variant="outlineWhite" className="mt-5">
                  Register interest
                </Button>
              </div>
            </div>
          </div>

          {/* Progression row */}
          <div className="mt-9 flex flex-wrap items-stretch justify-center gap-3.5">
            {[
              { title: 'Run the challenge', sub: 'In your classroom', highlight: false },
              { title: 'Participate in a Campaign', sub: 'Fall or Spring window', highlight: false },
              { title: 'National championships', sub: 'Top participants progress', highlight: true },
            ].map((node, i, arr) => (
              <div key={node.title} className="flex items-center gap-3.5">
                <div
                  className={`rounded-ds-card px-5 py-4 min-w-[180px] ${
                    node.highlight
                      ? 'bg-[#FFF8EF] border-[1.5px] border-pathway-amber'
                      : 'bg-white border border-line'
                  }`}
                >
                  <p className={`font-bold text-sm ${node.highlight ? 'text-brand-gold-ink' : 'text-ink'}`}>
                    {node.title}
                  </p>
                  <p className={`text-xs mt-0.5 ${node.highlight ? 'text-brand-gold-ink' : 'text-content-muted'}`}>
                    {node.sub}
                  </p>
                </div>
                {i < arr.length - 1 && <span className="text-content-faint text-xl">→</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Getting started ───────────────────────────────────────────── */}
      <section className="section-padding bg-surface">
        <div className="container-max">
          <Eyebrow>Getting started</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3">Simple to run in any classroom.</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mt-9">
            {gettingStarted.map((s) => (
              <div key={s.n} className="bg-white border border-line rounded-ds-card p-6">
                <div
                  className={`w-[34px] h-[34px] rounded-full flex items-center justify-center font-bold ${
                    s.amber ? 'bg-pathway-amber-bg text-pathway-amber' : 'bg-primary-soft text-primary'
                  }`}
                >
                  {s.n}
                </div>
                <p className="font-bold text-ink mt-4">{s.title}</p>
                <p className="text-sm text-content-secondary mt-1.5 leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Material levels ───────────────────────────────────────────── */}
      <section id="tiers" className="section-padding bg-white scroll-mt-24">
        <div className="container-max">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <Eyebrow>Material levels</Eyebrow>
              <h2 className="text-3xl font-bold text-ink mt-3">Start free. Unlock more as you go.</h2>
              <p className="text-content-secondary mt-3 leading-relaxed">
                Create a free account to access the Competition material. Upgrade your teacher membership for
                the full teaching material — see the membership page for tiers and pricing.
              </p>
            </div>
            <Link href="/membership" className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
              See membership &amp; pricing <ArrowRight size={14} />
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-[18px] mt-8 items-stretch">
            {/* Free */}
            <div className="flex flex-col rounded-card border border-line overflow-hidden bg-white">
              <div className="bg-enviro-green-bg px-7 py-5">
                <p className="text-xs font-subheading font-semibold uppercase tracking-[0.1em] text-enviro-green-text">
                  Always free · create an account
                </p>
                <h3 className="text-xl font-bold text-ink mt-1">Competition material</h3>
              </div>
              <div className="px-7 py-6 flex flex-col flex-1">
                <ul className="space-y-3 flex-1">
                  {freeBullets.map((b) => (
                    <li key={b} className="flex gap-2.5 text-sm text-content-secondary leading-relaxed">
                      <Check size={18} className="shrink-0 mt-0.5 text-enviro-green" /> {b}
                    </li>
                  ))}
                </ul>
                <Button
                  href={SIGNUP_URL}
                  variant="primary"
                  className="mt-6 w-full bg-enviro-green hover:bg-enviro-green-text"
                >
                  Create free account
                </Button>
              </div>
            </div>

            {/* Paid — featured */}
            <div className="relative flex flex-col rounded-card border-[1.5px] border-primary overflow-hidden bg-white shadow-featured">
              <div className="h-1 bg-primary" />
              <div className="bg-primary-soft px-7 py-5">
                <p className="text-xs font-subheading font-semibold uppercase tracking-[0.1em] text-primary">
                  Upgrade your membership
                </p>
                <h3 className="text-xl font-bold text-ink mt-1">Full teaching material</h3>
              </div>
              <div className="px-7 py-6 flex flex-col flex-1">
                <ul className="space-y-3 flex-1">
                  {paidBullets.map((b) => (
                    <li key={b} className="flex gap-2.5 text-sm text-content-secondary leading-relaxed">
                      <Check size={18} className="shrink-0 mt-0.5 text-primary" /> {b}
                    </li>
                  ))}
                </ul>
                <Button href="/membership" as={Link} variant="primary" className="mt-6 w-full">
                  View membership &amp; pricing
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden text-white py-20 px-4 sm:px-6 lg:px-8 bg-[radial-gradient(120%_130%_at_15%_0%,#1B2350_0%,#10153A_55%,#0E1330_100%)]">
        <div className="container-max text-center">
          <Eyebrow className="text-hero-dim">Ready to start?</Eyebrow>
          <h2 className="text-display font-bold mt-3 max-w-2xl mx-auto leading-tight">
            Bring a real engineering challenge to your class.
          </h2>
          <p className="text-hero-lead mt-4 max-w-lg mx-auto leading-relaxed">
            Download the material for free and teach it on your schedule — then enter a Campaign whenever
            you&rsquo;re ready.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mt-8">
            <Button href={SIGNUP_URL} variant="primary">
              Get the material — free
            </Button>
            <Button href="#campaigns" variant="outlineWhite">
              Explore Campaigns <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      </section>
    </>
  )
}
