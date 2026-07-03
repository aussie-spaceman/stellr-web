import type { Metadata } from 'next'
import Link from 'next/link'
import { UserPlus, FileCheck, GraduationCap, CalendarCheck, Users, Megaphone, ShieldCheck } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Volunteer with Stellr',
  description:
    'Support Stellr events and campaigns as a volunteer. Create a free account, complete volunteer training, and tell us which events you can help with.',
}

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

// Sends new volunteers through sign-up straight into the volunteer onboarding
// path (role locked to 'volunteer', 18+ required).
const SIGNUP_HREF = `${AUTH_URL}/sign-up?next=${encodeURIComponent('/account/onboarding?role=volunteer')}`

const steps = [
  {
    icon: UserPlus,
    title: '1. Create your free account',
    description:
      'Sign up as a Stellr volunteer in a couple of minutes. Volunteering is free — your account gives you member access too.',
  },
  {
    icon: FileCheck,
    title: '2. Sign your Volunteer Agreement',
    description:
      'We’ll email your Volunteer Agreement to sign electronically, and run a background check — standard for everyone who works with our students.',
  },
  {
    icon: GraduationCap,
    title: '3. Complete volunteer training',
    description:
      'A short mandatory training course in your Volunteer Hub covers safeguarding, event logistics, and how we work.',
  },
  {
    icon: CalendarCheck,
    title: '4. Tell us where you can help',
    description:
      'Browse upcoming events and campaigns, raise your hand for the ones that fit your schedule, and we’ll confirm your assignments.',
  },
]

const roles = [
  {
    icon: Users,
    title: 'Event support',
    description:
      'Help live competitions run smoothly — check-in, wayfinding, room support, and being an extra pair of hands where it counts.',
  },
  {
    icon: Megaphone,
    title: 'Campaign support',
    description:
      'Support asynchronous campaigns and outreach — reviewing submissions, cheering teams on, and helping us reach more schools.',
  },
  {
    icon: ShieldCheck,
    title: 'Trusted community',
    description:
      'Every volunteer is trained, background-checked, and part of the Volunteer Hub — a dedicated space with resources and updates.',
  },
]

export default function VolunteerPage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="bg-brand-blue-dark text-white py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-brand-orange font-semibold uppercase tracking-widest text-sm mb-4">
            Community → Volunteer with Stellr
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold mb-6 max-w-3xl">
            Lend a hand where the future is being built.
          </h1>
          <p className="text-lg text-content-faint max-w-2xl leading-relaxed">
            Stellr volunteers keep our events and campaigns running — from check-in desks to
            competition floors. No STEM background required: just your time, energy, and a
            commitment to our students.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={SIGNUP_HREF} className="btn-primary bg-brand-orange hover:bg-amber-500">
              Become a Volunteer
            </a>
            <Link href="/mentors" className="btn-outline-white">
              Prefer to mentor students?
            </Link>
          </div>
          <p className="mt-6 text-sm text-content-faint">
            Volunteers must be 18 or older. All volunteers complete a background check.
          </p>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────── */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <div className="max-w-2xl mb-10">
            <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">How it works</h2>
            <p className="text-brand-grey-dark leading-relaxed">
              Four steps from sign-up to your first event. Most volunteers are ready to be
              assigned within a week.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map((s) => {
              const Icon = s.icon
              return (
                <div key={s.title} className="bg-brand-grey-light rounded-xl p-6">
                  <div className="w-12 h-12 rounded-lg bg-brand-blue/10 flex items-center justify-center mb-4">
                    <Icon size={24} className="text-brand-blue" />
                  </div>
                  <h3 className="font-bold text-brand-blue-dark mb-2">{s.title}</h3>
                  <p className="text-sm text-brand-grey-dark leading-relaxed">{s.description}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── What volunteers do ────────────────────────────────────────── */}
      <section className="section-padding bg-brand-grey-light">
        <div className="container-max">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">What volunteers do</h2>
            <p className="text-brand-grey-dark leading-relaxed">
              You choose the events and campaigns you can support — we handle the rest.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {roles.map((r) => {
              const Icon = r.icon
              return (
                <div key={r.title} className="bg-white rounded-xl p-6 shadow-sm">
                  <div className="w-12 h-12 rounded-lg bg-brand-blue/10 flex items-center justify-center mb-4">
                    <Icon size={24} className="text-brand-blue" />
                  </div>
                  <h3 className="font-bold text-brand-blue-dark mb-2">{r.title}</h3>
                  <p className="text-sm text-brand-grey-dark leading-relaxed">{r.description}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── Closing CTA ───────────────────────────────────────────────── */}
      <section className="section-padding bg-brand-blue-dark text-white text-center">
        <div className="container-max max-w-2xl">
          <h2 className="text-3xl font-bold mb-4">Ready to help?</h2>
          <p className="text-content-faint leading-relaxed mb-8">
            Create your free volunteer account and tell us which upcoming events you can support.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a href={SIGNUP_HREF} className="btn-primary bg-brand-orange hover:bg-amber-500">
              Become a Volunteer
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
