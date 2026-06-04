import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, CheckCircle } from 'lucide-react'
import { getTestimonialsByRole } from '@/lib/sanity'

export const metadata: Metadata = {
  title: 'Why Stellr?',
  description: 'Find out what Stellr means for you — students, teachers, parents, mentors, and donors.',
}

export const revalidate = 3600

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

const roles = [
  { label: 'Student', anchor: 'student' },
  { label: 'Teacher', anchor: 'teacher' },
  { label: 'Parent', anchor: 'parent' },
  { label: 'Mentor', anchor: 'mentor' },
  { label: 'Donor', anchor: 'donor' },
]

interface Testimonial {
  _id: string
  quote: string
  author: string
  role: string
  event?: string
}

function TestimonialBlock({ testimonials }: { testimonials: Testimonial[] }) {
  if (!testimonials.length) return null
  return (
    <div className="mt-8 space-y-4">
      {testimonials.slice(0, 2).map((t) => (
        <blockquote key={t._id} className="border-l-4 border-brand-blue pl-5 italic text-brand-grey-dark">
          <p>&ldquo;{t.quote}&rdquo;</p>
          <footer className="mt-2 text-sm font-semibold text-brand-blue-dark not-italic">
            — {t.author}{t.event ? `, ${t.event}` : ''}
          </footer>
        </blockquote>
      ))}
    </div>
  )
}

export default async function WhyStellarPage() {
  const [students, teachers, parents, mentors, donors] = await Promise.all([
    getTestimonialsByRole('Student').catch(() => []),
    getTestimonialsByRole('Teacher').catch(() => []),
    getTestimonialsByRole('Parent').catch(() => []),
    getTestimonialsByRole('Mentor').catch(() => []),
    getTestimonialsByRole('Donor').catch(() => []),
  ])

  return (
    <>
      {/* ── Page Header ──────────────────────────────────────────────── */}
      <section className="bg-brand-blue-dark text-white py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-bold mb-4">Why Stellr?</h1>
          <p className="text-lg text-gray-300 mb-8 max-w-xl">
            Find out what Stellr means for you.
          </p>
          <div className="flex flex-wrap gap-3">
            {roles.map((r) => (
              <a
                key={r.anchor}
                href={`#${r.anchor}`}
                className="px-4 py-2 rounded-full bg-white/10 text-white text-sm font-medium hover:bg-brand-blue transition-colors"
              >
                {r.label}
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ── For Students ─────────────────────────────────────────────── */}
      <section id="student" className="section-padding scroll-mt-20">
        <div className="container-max max-w-4xl">
          <p className="text-sm font-bold uppercase tracking-widest text-brand-blue mb-3">For Students</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-brand-blue-dark mb-6">
            Learn what it&apos;s really like to work in industry — before you get there.
          </h2>
          <div className="space-y-4 text-brand-grey-dark">
            <p className="text-lg">
              You&apos;ll collaborate with, and compete against, some of the sharpest students in the country — mentored by industry professionals. Learn in one event what many adults take a decade to master.
            </p>
            <p>
              Stellr competitions are built around real-world industry scenarios across aerospace, engineering, environmental science, and business. You won&apos;t just apply what you&apos;ve studied — you&apos;ll work across disciplines under pressure, the way professionals do every day.
            </p>
          </div>
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { stat: '90%+', label: 'go on to study STEM at college' },
              { stat: 'US-wide', label: 'competitions across multiple states' },
              { stat: 'Real', label: 'industry mentors at every event' },
            ].map((item) => (
              <div key={item.stat} className="text-center p-6 bg-brand-grey-light rounded-xl">
                <p className="text-3xl font-bold text-brand-blue">{item.stat}</p>
                <p className="mt-1 text-sm text-brand-grey-dark">{item.label}</p>
              </div>
            ))}
          </div>
          <TestimonialBlock testimonials={(students ?? []) as Testimonial[]} />
          <div className="mt-8">
            <a href={`${AUTH_URL}/signup`} className="btn-primary inline-flex items-center gap-2">
              Create Free Account <ArrowRight size={16} />
            </a>
          </div>
        </div>
      </section>

      <div className="border-t border-gray-100" />

      {/* ── For Teachers ─────────────────────────────────────────────── */}
      <section id="teacher" className="section-padding bg-brand-grey-light scroll-mt-20">
        <div className="container-max max-w-4xl">
          <p className="text-sm font-bold uppercase tracking-widest text-brand-blue mb-3">For Teachers</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-brand-blue-dark mb-6">
            One of the only multi-disciplinary STEM competitions available to your students.
          </h2>
          <p className="text-lg text-brand-grey-dark mb-8">
            Unlike curriculum-specific activities, Stellr events require students to deploy skills across disciplines — engineering, science, business, communication — to solve real-world problems.
          </p>
          <ul className="space-y-3">
            {[
              'Complex, open-ended challenges suited to students of all ability levels',
              'Industry simulation context that brings classroom learning to life',
              'Competitive environment that teaches large-group communication and leadership',
              'CPD opportunity — attend as an educator and observe professional mentoring in action',
            ].map((benefit) => (
              <li key={benefit} className="flex items-start gap-3">
                <CheckCircle size={20} className="text-brand-blue mt-0.5 shrink-0" />
                <span className="text-brand-grey-dark">{benefit}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8 p-6 bg-brand-blue-dark text-white rounded-xl">
            <p className="text-2xl font-bold">90%</p>
            <p className="text-blue-200 mt-1">of Stellr participants pursue STEM or medicine at college — a measurable outcome you can point to.</p>
          </div>
          <TestimonialBlock testimonials={(teachers ?? []) as Testimonial[]} />
          <div className="mt-8">
            <Link href="/events" className="btn-primary inline-flex items-center gap-2">
              Register Your Students <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      <div className="border-t border-gray-100" />

      {/* ── For Parents ──────────────────────────────────────────────── */}
      <section id="parent" className="section-padding scroll-mt-20">
        <div className="container-max max-w-4xl">
          <p className="text-sm font-bold uppercase tracking-widest text-brand-blue mb-3">For Parents</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-brand-blue-dark mb-6">
            Give your child an experience they&apos;ll talk about for years.
          </h2>
          <p className="text-lg text-brand-grey-dark mb-8">
            Stellr events are safe, structured, and professionally run — giving your child the chance to test themselves in a real-world environment alongside their peers.
          </p>
          <div className="p-6 bg-blue-50 rounded-xl border-l-4 border-brand-blue">
            <blockquote className="text-lg italic text-brand-grey-dark">
              &ldquo;My son said it was one of the most exciting, exhilarating, challenging and memorable events in his life.&rdquo;
            </blockquote>
            <p className="mt-2 text-sm font-semibold text-brand-blue-dark">— Parent, 2022</p>
          </div>
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { title: 'Safe & structured', body: 'Professionally organised events with full supervision throughout.' },
              { title: 'Peer networking', body: 'Your child competes alongside motivated students from across the country.' },
              { title: 'Mentored environment', body: 'Industry professionals guide teams — not just judges, but active mentors.' },
            ].map((item) => (
              <div key={item.title} className="p-5 bg-brand-grey-light rounded-xl">
                <p className="font-bold text-brand-blue-dark mb-1">{item.title}</p>
                <p className="text-sm text-brand-grey-dark">{item.body}</p>
              </div>
            ))}
          </div>
          <TestimonialBlock testimonials={(parents ?? []) as Testimonial[]} />
          <div className="mt-8">
            <Link href="/events" className="btn-primary inline-flex items-center gap-2">
              Find an Event Near You <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      <div className="border-t border-gray-100" />

      {/* ── For Mentors ──────────────────────────────────────────────── */}
      <section id="mentor" className="section-padding bg-brand-grey-light scroll-mt-20">
        <div className="container-max max-w-4xl">
          <p className="text-sm font-bold uppercase tracking-widest text-brand-blue mb-3">For Mentors</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-brand-blue-dark mb-6">
            Give back. Grow your network. Stay connected to the next generation.
          </h2>
          <div className="space-y-4 text-brand-grey-dark">
            <p className="text-lg">
              As a Stellr Alumni or industry professional, you&apos;ll mentor student teams, share your experience, and help shape the engineers and scientists of tomorrow.
            </p>
            <p>
              You don&apos;t just judge — you&apos;re in the room with students as they work, answering questions, challenging assumptions, and sharing the kind of practical knowledge that doesn&apos;t make it into textbooks.
            </p>
          </div>
          <div className="mt-6 p-5 bg-white rounded-xl border border-gray-200">
            <p className="font-bold text-brand-blue-dark mb-1">Alumni upgrade</p>
            <p className="text-sm text-brand-grey-dark">
              Former student participants automatically receive Alumni membership upon graduating — staying connected to the Stellr community as they enter industry.
            </p>
          </div>
          <TestimonialBlock testimonials={(mentors ?? []) as Testimonial[]} />
          <div className="mt-8">
            <Link href="/contact?type=mentor" className="btn-primary inline-flex items-center gap-2">
              Volunteer as a Mentor <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      <div className="border-t border-gray-100" />

      {/* ── For Donors ───────────────────────────────────────────────── */}
      <section id="donor" className="section-padding scroll-mt-20">
        <div className="container-max max-w-4xl">
          <p className="text-sm font-bold uppercase tracking-widest text-brand-blue mb-3">For Donors &amp; Sponsors</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-brand-blue-dark mb-6">
            Invest in the next generation of STEM leaders.
          </h2>
          <div className="space-y-4 text-brand-grey-dark">
            <p className="text-lg">
              Stellr events are made possible by the generous support of donors and sponsors. Your contribution funds scholarships, resources, and access for students who would otherwise miss out.
            </p>
            <p>
              With 90%+ of participants going on to STEM careers, every dollar you invest has a direct and measurable impact on the next generation of engineers, scientists, and innovators.
            </p>
          </div>
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { title: 'Event sponsorship', body: 'Associate your brand with high-achieving STEM students and industry professionals.' },
              { title: 'Scholarship funding', body: 'Ensure talented students can participate regardless of financial circumstances.' },
              { title: 'Resource grants', body: 'Fund the materials and technology that make challenges possible.' },
              { title: 'Legacy giving', body: 'Make a lasting contribution to STEM education in the US.' },
            ].map((item) => (
              <div key={item.title} className="p-5 bg-brand-grey-light rounded-xl">
                <p className="font-bold text-brand-blue-dark mb-1">{item.title}</p>
                <p className="text-sm text-brand-grey-dark">{item.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 p-6 bg-brand-grey-light rounded-xl flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="flex-1">
              <p className="font-bold text-brand-blue-dark">Download Sponsor Prospectus</p>
              <p className="text-sm text-brand-grey-dark mt-1">Full sponsorship packages, reach statistics, and impact data.</p>
            </div>
            <Link href="/contact?type=sponsorship" className="btn-primary shrink-0">
              Request Prospectus
            </Link>
          </div>
          <TestimonialBlock testimonials={(donors ?? []) as Testimonial[]} />
          <div className="mt-8">
            <Link href="/donate" className="btn-primary inline-flex items-center gap-2">
              Make a Donation <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
