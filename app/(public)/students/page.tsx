import type { Metadata } from 'next'
import Link from 'next/link'
import {
  GraduationCap,
  School,
  Users,
  Rocket,
  Trophy,
  ShieldCheck,
  Briefcase,
  Compass,
  TrendingUp,
  Heart,
  DollarSign,
  ArrowRight,
} from 'lucide-react'

export const metadata: Metadata = {
  title: 'For Students',
  description:
    'Students are the core of the Stellr Community. Discover why high school and college students join Stellr — and what a Stellr membership means for your future.',
}

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

/* ── In-page anchor sections ───────────────────────────────────────── */
const sections = [
  { id: 'high-school', label: 'High School' },
  { id: 'college', label: 'College' },
  { id: 'parents', label: 'Parents' },
]

/* ── High School: Why Join ─────────────────────────────────────────── */
const hsWhyJoin = [
  {
    icon: Compass,
    title: 'You’re STEM-Curious',
    description:
      'You want to better understand your career trajectory in Science, Technology, Engineering, and Mathematics.',
  },
  {
    icon: TrendingUp,
    title: 'You Want to Excel',
    description:
      'Challenge yourself to learn skills that aren’t available anywhere else.',
  },
  {
    icon: Rocket,
    title: 'You’re Passionate About Our Themes',
    description:
      'Our Space and Environmental competitions immerse students in connected industries. Want to expand humanity’s horizons, or leave the planet a better place?',
  },
]

/* ── High School: "A down-payment on your future" ──────────────────── */
const hsDownPayment = [
  'Build your global professional network while you’re still in high school.',
  'Join the top 1% of high school STEM achievers.',
  'Don’t learn skills AI will take — learn how to be the professional the future needs through real soft-skills development.',
  'Get accredited with specific competencies you can show colleges and employers.',
  'Pre-validate your college options and save yourself valuable time and money.',
]

/* ── Parents: Why a STEM career ────────────────────────────────────── */
const parentReasons = [
  {
    icon: ShieldCheck,
    title: 'Job Security',
    description:
      'In a rapidly changing world, a STEM foundation helps future-proof your child’s career.',
  },
  {
    icon: Heart,
    title: 'Impact',
    description: 'STEM professionals solve the problems that matter most to society and the planet.',
  },
  {
    icon: DollarSign,
    title: 'Strong Salaries',
    description:
      'STEM careers are consistently among the best-compensated paths available to graduates.',
  },
]

export default function StudentsPage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="bg-brand-blue-dark text-white py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-brand-orange font-semibold uppercase tracking-widest text-sm mb-4">
            Community → For Students
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold mb-6 max-w-3xl">
            Students are the core of our Community
          </h1>
          <p className="text-lg text-gray-300 max-w-2xl leading-relaxed">
            You&rsquo;re the focus of the majority of our activities. Whether you&rsquo;re in high
            school or college, Stellr is where you start building the career — and the network —
            you&rsquo;ll carry for life.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={`${AUTH_URL}/sign-up`} className="btn-primary bg-brand-orange hover:bg-amber-500">
              Join Free
            </a>
            <Link href="/events" className="btn-outline-white">
              Find an Event
            </Link>
          </div>
        </div>
      </section>

      {/* ── In-page anchor nav ────────────────────────────────────────── */}
      <nav
        aria-label="Student sections"
        className="sticky top-20 z-30 bg-white/95 backdrop-blur border-b border-gray-100"
      >
        <div className="container-max flex gap-2 sm:gap-6 px-4 sm:px-6 lg:px-8 overflow-x-auto">
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="whitespace-nowrap py-4 text-sm font-semibold text-brand-grey-dark hover:text-brand-blue transition-colors"
            >
              {s.label}
            </a>
          ))}
        </div>
      </nav>

      {/* ── #high-school ──────────────────────────────────────────────── */}
      <section id="high-school" className="section-padding bg-white scroll-mt-36">
        <div className="container-max">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-11 h-11 rounded-lg bg-brand-blue/10 flex items-center justify-center">
              <School size={22} className="text-brand-blue" />
            </div>
            <p className="text-sm font-bold uppercase tracking-widest text-brand-blue">High School</p>
          </div>
          <h2 className="text-3xl font-bold text-brand-blue-dark mb-6 max-w-2xl">
            A down-payment on your future as a professional
          </h2>

          <p className="text-sm font-bold uppercase tracking-wide text-brand-orange-alt mb-4">
            Why join?
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            {hsWhyJoin.map((c) => {
              const Icon = c.icon
              return (
                <div key={c.title} className="bg-brand-grey-light rounded-xl p-6">
                  <div className="w-12 h-12 rounded-lg bg-brand-blue/10 flex items-center justify-center mb-4">
                    <Icon size={24} className="text-brand-blue" />
                  </div>
                  <h3 className="font-bold text-brand-blue-dark mb-2">{c.title}</h3>
                  <p className="text-sm text-brand-grey-dark leading-relaxed">{c.description}</p>
                </div>
              )
            })}
          </div>

          <div className="bg-brand-blue-dark text-white rounded-2xl p-8 sm:p-10">
            <p className="text-xl sm:text-2xl font-bold mb-6 max-w-xl">
              &ldquo;A down-payment on your future as a professional.&rdquo;
            </p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
              {hsDownPayment.map((point) => (
                <li key={point} className="flex gap-3">
                  <Trophy size={18} className="text-brand-orange shrink-0 mt-0.5" />
                  <span className="text-sm text-gray-200 leading-relaxed">{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── #college ──────────────────────────────────────────────────── */}
      <section id="college" className="section-padding bg-brand-grey-light scroll-mt-36">
        <div className="container-max">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-11 h-11 rounded-lg bg-brand-blue/10 flex items-center justify-center">
              <GraduationCap size={22} className="text-brand-blue" />
            </div>
            <p className="text-sm font-bold uppercase tracking-widest text-brand-blue">College</p>
          </div>
          <h2 className="text-3xl font-bold text-brand-blue-dark mb-6 max-w-2xl">
            Keep building — at college and beyond
          </h2>

          {/* NOTE: Draft placeholder copy — College section was blank in source doc. */}
          <p className="text-sm font-bold uppercase tracking-wide text-brand-orange-alt mb-4">
            Why join?
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: Briefcase,
                title: 'Stand Out',
                description:
                  'Sharpen the STEM-specific soft skills you’ll need to set yourself apart with employers and graduate programs.',
              },
              {
                icon: Users,
                title: 'Give Back as a Mentor',
                description:
                  'Volunteer as a competition mentor — develop leadership skills while supporting the next generation of students.',
              },
              {
                icon: Compass,
                title: 'Connect to Industry',
                description:
                  'Tap into the Stellr Network of industry professionals for advice on internships, graduate jobs, and career direction.',
              },
            ].map((c) => {
              const Icon = c.icon
              return (
                <div key={c.title} className="bg-white rounded-xl p-6 shadow-sm">
                  <div className="w-12 h-12 rounded-lg bg-brand-blue/10 flex items-center justify-center mb-4">
                    <Icon size={24} className="text-brand-blue" />
                  </div>
                  <h3 className="font-bold text-brand-blue-dark mb-2">{c.title}</h3>
                  <p className="text-sm text-brand-grey-dark leading-relaxed">{c.description}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── #parents ──────────────────────────────────────────────────── */}
      <section id="parents" className="section-padding bg-white scroll-mt-36">
        <div className="container-max">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-lg bg-brand-blue/10 flex items-center justify-center">
                  <Heart size={22} className="text-brand-blue" />
                </div>
                <p className="text-sm font-bold uppercase tracking-widest text-brand-blue">
                  Parents
                </p>
              </div>
              <h2 className="text-3xl font-bold text-brand-blue-dark mb-6">
                Looking for a STEM path that challenges your child?
              </h2>
              <div className="space-y-4 text-brand-grey-dark leading-relaxed">
                <p>
                  If you&rsquo;re a parent reading this, you&rsquo;re likely looking for a STEM option
                  for your child that will challenge them to excel and encourage them down a
                  STEM-oriented future.
                </p>
                <p>
                  A career in STEM is beneficial for many reasons — and Stellr is built to give your
                  child a head start on all of them.
                </p>
              </div>

              {/* NOTE: "Why Consider Stellr?" was blank in source doc — draft placeholder below. */}
              <div className="mt-8 bg-brand-grey-light rounded-xl p-6">
                <h3 className="font-bold text-brand-blue-dark mb-2">Why consider Stellr?</h3>
                <p className="text-sm text-brand-grey-dark leading-relaxed">
                  We give students real-world industry experience, a global professional network, and
                  the foundational skills that AI can&rsquo;t replace — all while they&rsquo;re still
                  in school. Check out our white paper, or look at the impact we have, to learn more
                  about why we do what we do.
                </p>
                <Link
                  href="/impact"
                  className="inline-flex items-center gap-1 mt-4 text-brand-blue text-sm font-semibold hover:underline"
                >
                  See our Impact <ArrowRight size={14} />
                </Link>
              </div>
            </div>

            <div className="space-y-4">
              {parentReasons.map((r) => {
                const Icon = r.icon
                return (
                  <div key={r.title} className="bg-white rounded-xl p-6 flex gap-4 shadow-sm border border-gray-100">
                    <div className="w-11 h-11 rounded-lg bg-brand-blue/10 flex items-center justify-center shrink-0">
                      <Icon size={22} className="text-brand-blue" />
                    </div>
                    <div>
                      <h3 className="font-bold text-brand-blue-dark">{r.title}</h3>
                      <p className="text-sm text-brand-grey-dark mt-1 leading-relaxed">
                        {r.description}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── Closing CTA ───────────────────────────────────────────────── */}
      <section className="section-padding bg-brand-blue-dark text-white text-center">
        <div className="container-max max-w-2xl">
          <h2 className="text-3xl font-bold mb-4">Your career starts now</h2>
          <p className="text-gray-300 leading-relaxed mb-8">
            Join free, find a competition, and start building the STEM Skills that set you apart.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a href={`${AUTH_URL}/sign-up`} className="btn-primary bg-brand-orange hover:bg-amber-500">
              Join Free
            </a>
            <Link href="/competitions" className="btn-outline-white">
              Explore Competitions
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
