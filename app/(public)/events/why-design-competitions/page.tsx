import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, CheckCircle, Users, Lightbulb, Briefcase, Award } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Why Design Competitions',
  description:
    'Design competitions bridge the gap between traditional education and real workplace readiness — developing the skills, relationships, and career insights students need.',
}

const benefits = [
  {
    icon: Briefcase,
    title: 'Real-world scenarios',
    body: 'Students tackle authentic industry challenges with no textbook answer — exactly the kind of multi-variable, competing-priority problems professionals face every day.',
  },
  {
    icon: Users,
    title: 'Industry mentors in the room',
    body: 'Professionals from engineering, aerospace, environmental science, and business mentor teams actively throughout the event — not just at judging.',
  },
  {
    icon: Lightbulb,
    title: 'Career insights that stick',
    body: 'Students don\'t just learn about careers — they simulate them. Adopting professional roles in a team gives students a concrete sense of what working in industry actually feels like.',
  },
  {
    icon: Award,
    title: 'Soft skills you can\'t teach from a textbook',
    body: 'Communication, collaboration, resilience, and adaptive problem-solving under pressure. These are the skills employers demand and traditional curricula struggle to deliver.',
  },
]

const forEducators = [
  'Open-ended challenges suited to students of all ability levels across STEM disciplines',
  'Industry simulation context that makes classroom learning tangible and relevant',
  'Competitive team environment that develops communication, leadership, and resilience',
  'A textbook example of Project Based Learning — with measurable outcomes',
  'CPD opportunity for educators attending alongside their students',
]

export default function WhyDesignCompetitionsPage() {
  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="bg-brand-blue-dark text-white py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto max-w-3xl">
          <p className="text-sm font-bold uppercase tracking-widest text-brand-orange mb-4">
            Events
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold mb-6 leading-tight">
            Why Design Competitions?
          </h1>
          <p className="text-lg text-content-faint max-w-2xl leading-relaxed">
            Modern curricula lack the flexibility to teach the soft skills and adaptive
            problem-solving that 21st-century careers demand. Design competitions fill that gap —
            bridging the distance between education and the real world of work.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link
              href="/events/register"
              className="inline-flex items-center gap-2 px-6 py-3 bg-brand-orange text-white font-heading font-medium rounded-md hover:bg-amber-500 transition-colors"
            >
              Register Now <ArrowRight size={16} />
            </Link>
            <Link
              href="/events"
              className="inline-flex items-center gap-2 px-6 py-3 bg-white/10 text-white font-medium rounded-md hover:bg-white/20 transition-colors"
            >
              Upcoming Events
            </Link>
          </div>
        </div>
      </section>

      {/* ── The problem ──────────────────────────────────────────────── */}
      <section className="section-padding">
        <div className="container-max max-w-4xl">
          <p className="text-sm font-bold uppercase tracking-widest text-brand-blue mb-3">
            The Challenge
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-brand-blue-dark mb-6">
            School prepares students for exams. Industry needs something more.
          </h2>
          <div className="space-y-4 text-lg text-brand-grey-dark leading-relaxed">
            <p>
              Today&apos;s students are smart, ambitious, and hard-working — but traditional education
              rarely gives them the chance to experience the complexity of real professional
              environments. Managing competing priorities, collaborating under pressure, and
              communicating across disciplines are skills that take years to develop on the job.
            </p>
            <p>
              Stellr design competitions compress that experience into a single, high-intensity event
              — giving students career-defining exposure years before they enter the workforce.
            </p>
          </div>
        </div>
      </section>

      {/* ── Quote ────────────────────────────────────────────────────── */}
      <section className="bg-brand-blue-dark text-white py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto max-w-3xl text-center">
          <blockquote className="text-2xl sm:text-3xl font-bold leading-snug">
            &ldquo;Design Competitions are a textbook example of Project Based Learning. We provide
            an open-ended challenge for students to creatively problem solve.&rdquo;
          </blockquote>
          <footer className="mt-6 text-brand-orange font-medium">
            Mr. Ty White — AZ Rural Teacher of the Year, 2023
          </footer>
        </div>
      </section>

      {/* ── Four benefits ────────────────────────────────────────────── */}
      <section className="section-padding bg-brand-grey-light">
        <div className="container-max">
          <p className="text-sm font-bold uppercase tracking-widest text-brand-blue mb-3">
            What Students Gain
          </p>
          <h2 className="text-3xl font-bold text-brand-blue-dark mb-10">
            Four things a competition delivers that a classroom can&apos;t
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {benefits.map(({ icon: Icon, title, body }) => (
              <div key={title} className="bg-white rounded-xl p-6 shadow-sm flex gap-4">
                <div className="shrink-0 w-10 h-10 rounded-lg bg-brand-blue flex items-center justify-center">
                  <Icon size={20} className="text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-brand-blue-dark mb-1">{title}</h3>
                  <p className="text-sm text-brand-grey-dark leading-relaxed">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats ────────────────────────────────────────────────────── */}
      <section className="section-padding">
        <div className="container-max">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
            {[
              { stat: '90%+', label: 'of participants go on to study STEM at college' },
              { stat: 'US-wide', label: 'competitions across multiple states in 2026–27' },
              { stat: '100%', label: 'real-world, industry-simulated challenges' },
            ].map((item) => (
              <div key={item.stat} className="p-8 bg-brand-grey-light rounded-xl">
                <p className="text-4xl font-bold text-brand-blue">{item.stat}</p>
                <p className="mt-2 text-sm text-brand-grey-dark">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── For Educators ────────────────────────────────────────────── */}
      <section className="section-padding bg-brand-grey-light">
        <div className="container-max max-w-4xl">
          <p className="text-sm font-bold uppercase tracking-widest text-brand-blue mb-3">
            For Educators
          </p>
          <h2 className="text-3xl font-bold text-brand-blue-dark mb-6">
            Built around curriculum — but beyond it
          </h2>
          <p className="text-lg text-brand-grey-dark mb-8">
            Stellr competitions are designed to complement what students already know. They don&apos;t
            require a specific subject — they reward cross-disciplinary thinking and give every
            student a way to contribute.
          </p>
          <ul className="space-y-3">
            {forEducators.map((point) => (
              <li key={point} className="flex items-start gap-3">
                <CheckCircle size={20} className="text-brand-blue mt-0.5 shrink-0" />
                <span className="text-brand-grey-dark">{point}</span>
              </li>
            ))}
          </ul>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link
              href="/events/register"
              className="inline-flex items-center gap-2 px-6 py-3 bg-brand-blue text-white font-medium rounded-md hover:bg-blue-800 transition-colors"
            >
              Register Your Students <ArrowRight size={16} />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 px-6 py-3 border border-brand-blue text-brand-blue font-medium rounded-md hover:bg-blue-50 transition-colors"
            >
              Talk to Our Team
            </Link>
          </div>
        </div>
      </section>

      {/* ── CTA band ─────────────────────────────────────────────────── */}
      <section className="bg-brand-blue text-white py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to see it for yourself?</h2>
          <p className="text-blue-200 max-w-xl mx-auto mb-8">
            Browse upcoming Stellr design competitions across the US and register your team today.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href="/events"
              className="inline-flex items-center gap-2 px-6 py-3 bg-white text-brand-blue font-medium rounded-md hover:bg-surface transition-colors"
            >
              View Upcoming Events <ArrowRight size={16} />
            </Link>
            <Link
              href="/events/curriculum"
              className="inline-flex items-center gap-2 px-6 py-3 bg-white/10 text-white font-medium rounded-md hover:bg-white/20 transition-colors"
            >
              Explore Curriculum Activities
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
