import type { Metadata } from 'next'
import Link from 'next/link'
import {
  BookOpen,
  Award,
  Wallet,
  Building2,
  Users,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react'
import { PullQuoteWall } from '@/components/sections/PullQuoteWall'
import { VideoTestimonial } from '@/components/sections/VideoTestimonial'
import { ProofStrip } from '@/components/sections/ProofStrip'
import { WorkCard } from '@/components/sections/WorkCard'
import { PHOTOS, VIDEOS, QUOTES, COMPETITION } from '@/lib/media-manifest'
import {
  STIPEND_AMOUNTS,
  STIPEND_PD_HOURS,
  STIPEND_PLACES,
  STIPEND_PROGRAM_YEAR,
  stipendAmount,
} from '@/lib/stipend'

export const metadata: Metadata = {
  alternates: { canonical: '/educators' },
  title: 'For Educators & Schools',
  description:
    'Stellr supports the educators and schools who bring real-world STEM challenges to their students — with curriculum material, CTE pathways, and classroom support.',
}

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

/* NOTE: The Educators and Schools sections were left blank in the source doc;
   the copy below is on-brand draft placeholder content for review. The Stipend
   section is NOT placeholder — it is the approved program copy, and its numbers
   come from lib/stipend.ts so the page, the agreement and the API route agree. */

const sections = [
  { id: 'educators', label: 'For Educators' },
  { id: 'stipend', label: 'Teacher Stipend' },
  { id: 'schools', label: 'For Schools' },
]

const educatorBenefits = [
  {
    icon: BookOpen,
    title: 'Classroom-Ready Curriculum',
    description:
      'Run a Stellr Campaign with lesson plans, worksheets, and delivery guides designed to drop straight into your classroom.',
  },
  {
    icon: Award,
    title: 'CTE Accreditation',
    description:
      'Access CTE-aligned material and training, with documented PD contact hours you can take to your district.',
  },
  {
    icon: Users,
    title: 'A Professional Community',
    description:
      'Join a global community of educators sharing ideas, resources, and support across the Stellr Network.',
  },
]




export default function EducatorsPage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="bg-brand-blue-dark text-white py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-brand-orange font-semibold uppercase tracking-widest text-sm mb-4">
            Community → For Educators &amp; Schools
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold mb-6 max-w-3xl">
            Bring real-world STEM to your students
          </h1>
          <p className="text-lg text-content-faint max-w-2xl leading-relaxed">
            Educators are at the heart of how Stellr reaches students. We give you the curriculum,
            the training, and the support to deliver industry-grade STEM experiences — without
            adding to your workload.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={`${AUTH_URL}/sign-up`} className="btn-primary bg-brand-orange hover:bg-amber-500">
              Register as an Educator
            </a>
            <Link href="/curriculum" className="btn-outline-white">
              Browse Curriculum
            </Link>
          </div>
        </div>
      </section>

      {/* ── In-page anchor nav ────────────────────────────────────────── */}
      <nav
        aria-label="Educator sections"
        className="sticky top-20 z-30 bg-white/95 backdrop-blur border-b border-line-light"
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

      {/* ── Written testimonial (moved to top, below heading) ─────────── */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <PullQuoteWall quotes={[QUOTES['nahuel-de-bittencourt']]} columns={1} className="max-w-2xl mx-auto" />
        </div>
      </section>

      {/* ── #educators ────────────────────────────────────────────────── */}
      <section id="educators" className="section-padding bg-white scroll-mt-36">
        <div className="container-max">
          <div className="max-w-2xl mb-10">
            <p className="text-sm font-bold uppercase tracking-widest text-brand-blue mb-3">
              For Educators
            </p>
            <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">
              Everything you need to deliver
            </h2>
            <p className="text-brand-grey-dark leading-relaxed">
              Whether you run a single Campaign in one class or coordinate across a whole department,
              Stellr gives you the material and the backing to make it a success.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {educatorBenefits.map((b) => {
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
          <div className="mt-8 flex items-start gap-3 bg-brand-grey-light rounded-lg p-4 max-w-2xl">
            <ShieldCheck size={20} className="text-brand-blue shrink-0 mt-0.5" />
            <p className="text-sm text-brand-grey-dark leading-relaxed">
              Student safety comes first. All student details and access information are encrypted and
              secure, and our group registration captures the agreements your school requires.
            </p>
          </div>
        </div>
      </section>

      {/* ── Educator video testimonials (moved above Teacher Stipend) ─── */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <div className="grid gap-6 sm:grid-cols-2 max-w-5xl mx-auto">
            {[VIDEOS['testimonial-jeremiah-dibley'], VIDEOS['testimonial-willcox-teachers']].map((v) => (
              <figure key={v.id}>
                <VideoTestimonial src={v.src} poster={v.poster} captionsSrc={v.captions} title={v.title} />
                <figcaption className="mt-3 text-sm font-semibold text-brand-blue-dark">{v.title}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* ── #stipend ──────────────────────────────────────────────────────
          Teaser only. The full program — earnings table, FAQ (with its FAQPage
          schema) and the application form — lives once, at /stipend. Two pages
          carrying the same copy would compete for the same search terms and
          double every future edit. */}
      <section id="stipend" className="section-padding bg-brand-grey-light scroll-mt-36">
        <div className="container-max">
          <div className="max-w-3xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-11 h-11 rounded-lg bg-brand-blue/10 flex items-center justify-center">
                <Wallet size={22} className="text-brand-blue" />
              </div>
              <p className="text-sm font-bold uppercase tracking-widest text-brand-blue">
                Teacher Stipend
              </p>
            </div>
            <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">
              We support the teachers who want to offer Stellr activities to their students
            </h2>
            <p className="text-brand-grey-dark leading-relaxed mb-6">
              Taking a team to a live Challenge or running a Campaign at your school takes real
              time. The Teacher Stipend recognizes that work — {stipendAmount(STIPEND_AMOUNTS.annualMaximum)}{' '}
              a year at most, plus {STIPEND_PD_HOURS} documented PD contact hours and free Catalyst
              membership. Open to U.S. high school teachers, {STIPEND_PLACES} places for{' '}
              {STIPEND_PROGRAM_YEAR}.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/stipend" className="btn-primary">
                See the Teacher Stipend <ArrowRight size={16} />
              </Link>
              <Link href="/stipend#apply" className="btn-outline">
                Apply now
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── #schools ──────────────────────────────────────────────────── */}
      <section id="schools" className="section-padding bg-white scroll-mt-36">
        <div className="container-max">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-lg bg-brand-blue/10 flex items-center justify-center">
                  <Building2 size={22} className="text-brand-blue" />
                </div>
                <p className="text-sm font-bold uppercase tracking-widest text-brand-blue">
                  For Schools
                </p>
              </div>
              <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">
                Partner with Stellr at the school level
              </h2>
              {/* NOTE: Schools section was blank in source doc — placeholder copy. */}
              <p className="text-brand-grey-dark leading-relaxed mb-4">
                Stellr works with schools and districts to bring STEM competitions to whole cohorts
                of students. Group registration, district-wide campaigns, and dedicated support make
                it simple to scale beyond a single classroom.
              </p>
              <p className="text-brand-grey-dark leading-relaxed">
                We handle the agreements, the logistics, and the curriculum so your team can focus on
                students.
              </p>
            </div>
            <div className="bg-brand-grey-light rounded-2xl p-8">
              <p className="text-sm font-semibold text-brand-blue-dark mb-4">
                Ways to get your school involved:
              </p>
              <ul className="space-y-3 text-sm text-brand-grey-dark">
                {[
                  'Register a group of students for a live event',
                  'Run a curriculum Campaign across multiple classes',
                  'Host a Stellr event at your facility',
                  'Set up CTE pathways for participating educators',
                ].map((item) => (
                  <li key={item} className="flex gap-3">
                    <ArrowRight size={16} className="text-brand-blue shrink-0 mt-0.5" />
                    <span className="leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/host-an-event"
                className="inline-flex items-center gap-1 mt-6 text-brand-blue text-sm font-semibold hover:underline"
              >
                Learn about hosting <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── What educators see: photos + previous competition resources ─ */}
      <section className="section-padding bg-brand-grey-light">
        <div className="container-max max-w-4xl mx-auto">
          <ProofStrip
            photos={[PHOTOS['educators-1'], PHOTOS['educators-2']]}
            captions={false}
            columns={2}
          />
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-5">
            {[COMPETITION['jsc-2025-program-book'], COMPETITION['jsc-2025-student-presentation']].map((c) => (
              <WorkCard key={c.id} asset={c} eyebrow="Previous Competition Resource" />
            ))}
          </div>
        </div>
      </section>

      {/* ── Closing CTA ───────────────────────────────────────────────── */}
      <section className="section-padding bg-brand-blue-dark text-white text-center">
        <div className="container-max max-w-2xl">
          <h2 className="text-3xl font-bold mb-4">Ready to bring Stellr to your students?</h2>
          <p className="text-content-faint leading-relaxed mb-8">
            Register as an Educator to unlock Baseline curriculum, or talk to our team about a
            school-wide partnership.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a href={`${AUTH_URL}/sign-up`} className="btn-primary bg-brand-orange hover:bg-amber-500">
              Register as an Educator
            </a>
            <Link href="/contact" className="btn-outline-white">
              Contact Us
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
