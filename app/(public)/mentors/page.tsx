import type { Metadata } from 'next'
import Link from 'next/link'
import { Users, Heart, Globe, Award, Clock, ArrowRight } from 'lucide-react'

export const metadata: Metadata = {
  title: 'For Volunteers & Mentors',
  description:
    'Share your STEM experience with the next generation. Become a Stellr volunteer or mentor and help shape the career trajectories of students worldwide.',
}

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

/* NOTE: The Mentors page was left blank in the source doc. The copy below is
   on-brand draft placeholder content for review. */

const benefits = [
  {
    icon: Heart,
    title: 'Give Back',
    description:
      'Pass on the hard-won lessons of your career to students who are just getting started — and see the impact first-hand.',
  },
  {
    icon: Globe,
    title: 'Join a Global Community',
    description:
      'Connect with fellow professionals, educators, and students across the worldwide Stellr Network.',
  },
  {
    icon: Award,
    title: 'Build Your Profile',
    description:
      'Volunteering with Stellr is a recognized contribution to STEM education — and a meaningful addition to your professional story.',
  },
]

const ways = [
  {
    icon: Users,
    title: 'Mentor a Cohort',
    description:
      'Lead a small-group mentoring cohort over several weeks, going deep on a topic you know well.',
  },
  {
    icon: Clock,
    title: 'Volunteer at an Event',
    description:
      'Support a live competition as a judge, facilitator, or subject-matter expert — in person or virtually.',
  },
  {
    icon: Award,
    title: 'Coach One-on-One',
    description:
      'Provide tailored, one-on-one guidance to student members on their career trajectories.',
  },
]

export default function MentorsPage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="bg-brand-blue-dark text-white py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-brand-orange font-semibold uppercase tracking-widest text-sm mb-4">
            Community → For Volunteers &amp; Mentors
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold mb-6 max-w-3xl">
            Share what you know. Shape what&rsquo;s next.
          </h1>
          <p className="text-lg text-content-faint max-w-2xl leading-relaxed">
            Our volunteers and mentors are STEM professionals who give their time to impart lessons
            and share their unique perspectives. Whatever stage of your career you&rsquo;re at,
            there&rsquo;s a way for you to contribute.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={`${AUTH_URL}/sign-up`} className="btn-primary bg-brand-orange hover:bg-amber-500">
              Become a Mentor
            </a>
            <Link href="/academy#mentoring" className="btn-outline-white">
              How Mentoring Works
            </Link>
          </div>
        </div>
      </section>

      {/* ── Why volunteer ─────────────────────────────────────────────── */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <div className="max-w-2xl mb-10">
            <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">Why volunteer with Stellr?</h2>
            <p className="text-brand-grey-dark leading-relaxed">
              Mentoring is one of the most rewarding ways to stay connected to your field — and to
              help build the cradle-to-grave STEM community of practice we&rsquo;re creating.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {benefits.map((b) => {
              const Icon = b.icon
              return (
                <div key={b.title} className="bg-brand-grey-light rounded-xl p-6">
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

      {/* ── Ways to get involved ──────────────────────────────────────── */}
      <section className="section-padding bg-brand-grey-light">
        <div className="container-max">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">Ways to get involved</h2>
            <p className="text-brand-grey-dark leading-relaxed">
              Pick the level of commitment that fits your schedule. Every contribution makes a
              difference.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {ways.map((w) => {
              const Icon = w.icon
              return (
                <div key={w.title} className="bg-white rounded-xl p-6 shadow-sm">
                  <div className="w-12 h-12 rounded-lg bg-brand-blue/10 flex items-center justify-center mb-4">
                    <Icon size={24} className="text-brand-blue" />
                  </div>
                  <h3 className="font-bold text-brand-blue-dark mb-2">{w.title}</h3>
                  <p className="text-sm text-brand-grey-dark leading-relaxed">{w.description}</p>
                </div>
              )
            })}
          </div>
          <div className="mt-10 text-center">
            <Link
              href="/network"
              className="inline-flex items-center gap-1 text-brand-blue text-sm font-semibold hover:underline"
            >
              Representing an organization? Explore the Stellr Network <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Closing CTA ───────────────────────────────────────────────── */}
      <section className="section-padding bg-brand-blue-dark text-white text-center">
        <div className="container-max max-w-2xl">
          <h2 className="text-3xl font-bold mb-4">Ready to make an impact?</h2>
          <p className="text-content-faint leading-relaxed mb-8">
            Join free, tell us about your experience, and we&rsquo;ll help you find the right way to
            contribute.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a href={`${AUTH_URL}/sign-up`} className="btn-primary bg-brand-orange hover:bg-amber-500">
              Become a Mentor
            </a>
            <Link href="/contact" className="btn-outline-white">
              Ask a Question
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
