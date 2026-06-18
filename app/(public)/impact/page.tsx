import type { Metadata } from 'next'
import Link from 'next/link'
import { TrendingUp, Cpu, Target, BookOpen, Bot, GraduationCap } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Impact',
  description:
    'The impact Stellr has on student career trajectories — and how we are openly and actively incorporating AI into STEM education.',
}

const sections = [
  { id: 'careertrajectory', label: 'Career Trajectory' },
  { id: 'AInote', label: 'A Note on AI' },
]

const aiApproaches = [
  {
    icon: Target,
    title: 'Competition Requirements',
    description:
      'Students must show not only how they used AI to complete tasks, but quantify the benefit they achieved — recognizing the ROI possible from deploying AI. (And if they don’t know what ROI is, we have an Academy training course on that!)',
  },
  {
    icon: BookOpen,
    title: 'Dedicated Academy Content',
    description:
      'Engineering is the application of knowledge. We aim to provide our members the knowledge to best apply AI in their careers.',
  },
  {
    icon: Bot,
    title: 'Agentic AI Sub-Contractors',
    description:
      'We replicate industry using custom-built agentic AI for students to interact with, better simulating the professional environment we ask them to immerse themselves in.',
  },
  {
    icon: GraduationCap,
    title: 'Educator Guidance',
    description:
      'AI in education is incredibly fluid. We work hard to give educators in our community the tools, lessons, and support to use AI themselves — and to safely encourage their students to do so.',
  },
]

export default function ImpactPage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="bg-brand-blue-dark text-white py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-brand-orange font-semibold uppercase tracking-widest text-sm mb-4">
            About → Impact
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold mb-6 max-w-3xl">The impact we have</h1>
          <p className="text-lg text-gray-300 max-w-2xl leading-relaxed">
            After people ask <em>why</em> we do what we do, they usually ask what impact we have.
            Here&rsquo;s how we change student career trajectories — and where we stand on the
            technology reshaping their future.
          </p>
        </div>
      </section>

      {/* ── In-page anchor nav ────────────────────────────────────────── */}
      <nav
        aria-label="Impact sections"
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

      {/* ── #careertrajectory ─────────────────────────────────────────── */}
      <section id="careertrajectory" className="section-padding bg-white scroll-mt-36">
        <div className="container-max">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-11 h-11 rounded-lg bg-brand-blue/10 flex items-center justify-center">
              <TrendingUp size={22} className="text-brand-blue" />
            </div>
            <p className="text-sm font-bold uppercase tracking-widest text-brand-blue">
              Career Trajectory
            </p>
          </div>
          <h2 className="text-3xl font-bold text-brand-blue-dark mb-6 max-w-2xl">
            Setting young professionals on a STEM path
          </h2>
          {/* NOTE: Career Trajectory detail was blank in source doc — placeholder copy + stats. */}
          <p className="text-brand-grey-dark leading-relaxed max-w-3xl mb-10">
            We help students see — and step onto — a STEM career path long before they have to commit
            to one. By connecting high school, college, and professional life into a single
            community, we remove the opacity between each phase of the journey.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-3xl">
            {[
              { stat: '100k', label: 'students we aim to positively impact over the next 10 years' },
              { stat: 'Top 1%', label: 'of high school STEM achievers in our community' },
              { stat: 'Cradle-to-grave', label: 'network spanning high school through retirement' },
            ].map((item) => (
              <div key={item.label} className="bg-brand-grey-light rounded-xl p-6 text-center">
                <p className="text-3xl font-bold text-brand-blue">{item.stat}</p>
                <p className="mt-2 text-sm text-brand-grey-dark leading-relaxed">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── #AInote ───────────────────────────────────────────────────── */}
      <section id="AInote" className="section-padding bg-brand-grey-light scroll-mt-36">
        <div className="container-max">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-11 h-11 rounded-lg bg-brand-blue/10 flex items-center justify-center">
              <Cpu size={22} className="text-brand-blue" />
            </div>
            <p className="text-sm font-bold uppercase tracking-widest text-brand-blue">
              A Note on AI
            </p>
          </div>

          <blockquote className="text-2xl sm:text-3xl font-bold text-brand-blue-dark leading-snug max-w-3xl mb-8">
            &ldquo;AI is eating education.&rdquo;
          </blockquote>

          <div className="space-y-4 text-brand-grey-dark leading-relaxed max-w-3xl mb-12">
            <p>
              Stellr believes in providing students with real-world experiences that can have a
              positive influence on their career trajectories.
            </p>
            <p>
              Generative AI, large language models, and agentic systems are having an immediate impact
              on how professionals work. Work is literally changing week by week.
            </p>
            <p>
              We believe the future of work will involve this technology, and students cannot afford
              to shy away from it. So we are openly, and actively, incorporating AI into our
              competitions — in multiple ways:
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {aiApproaches.map((a) => {
              const Icon = a.icon
              return (
                <div key={a.title} className="bg-white rounded-xl p-6 shadow-sm">
                  <div className="w-12 h-12 rounded-lg bg-brand-blue/10 flex items-center justify-center mb-4">
                    <Icon size={24} className="text-brand-blue" />
                  </div>
                  <h3 className="font-bold text-brand-blue-dark mb-2">{a.title}</h3>
                  <p className="text-sm text-brand-grey-dark leading-relaxed">{a.description}</p>
                </div>
              )
            })}
          </div>

          <p className="mt-10 text-sm text-brand-grey-dark max-w-3xl">
            If you have any questions, queries, or concerns regarding how Stellr is deploying AI to
            support STEM learning outcomes, please{' '}
            <Link href="/contact" className="text-brand-blue font-semibold hover:underline">
              contact us directly
            </Link>
            .
          </p>
        </div>
      </section>

      {/* ── Closing CTA ───────────────────────────────────────────────── */}
      <section className="section-padding bg-brand-blue-dark text-white text-center">
        <div className="container-max max-w-2xl">
          <h2 className="text-3xl font-bold mb-4">Learn more about why we do this</h2>
          <p className="text-gray-300 leading-relaxed mb-8">
            Read our mission, meet the team, or get in touch to find out how Stellr can make an impact
            in your community.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/about#mission" className="btn-primary bg-brand-orange hover:bg-amber-500">
              Our Mission
            </Link>
            <Link href="/contact" className="btn-outline-white">
              Contact Us
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
