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
  Check,
} from 'lucide-react'
import { Hero, Button, Eyebrow } from '@stellr/web-ui'
import { PdCertificateSample } from '@/components/sections/PdCertificateSample'
import { EVENT_PD_HOURS, PD_STANDARDS } from '@/lib/pd-standards'
import { PullQuoteWall } from '@/components/sections/PullQuoteWall'
import { VideoTestimonial } from '@/components/sections/VideoTestimonial'
import { AudioTestimonial } from '@/components/sections/AudioTestimonial'
import { ProofStrip } from '@/components/sections/ProofStrip'
import { WorkCard } from '@/components/sections/WorkCard'
import { AUDIO, PHOTOS, VIDEOS, QUOTES, COMPETITION } from '@/lib/media-manifest'
import {
  GRANT_AMOUNTS,
  GRANT_PD_HOURS,
  GRANT_PLACES,
  GRANT_PROGRAM_YEAR,
  grantAmount,
} from '@/lib/grant'
import { GuideFaq } from '@/components/guides/GuideFaq'
import { BookCallButton } from '@/components/sections/BookCallButton'

/* Rendered visibly and as FAQPage JSON-LD from the same strings. Grant
   figures come from lib/grant, the same source /grant renders. */
const EDUCATOR_FAQS = [
  {
    q: 'How can a teacher bring Stellr competitions to their school?',
    a: 'Two ways. Run a free Campaign in class or as a club using Stellr’s material, or bring a team to a one-day live Challenge. Registering as a Stellr Educator is free.',
  },
  {
    q: 'Is there funding for teachers who run Stellr activities?',
    a: `Yes. The Teacher Grant Program pays US high school teachers up to ${grantAmount(GRANT_AMOUNTS.annualMaximum)} a year for bringing a team to a live Challenge and running a Campaign, plus ${GRANT_PD_HOURS} documented PD contact hours and free Catalyst membership. There are ${GRANT_PLACES} places for ${GRANT_PROGRAM_YEAR}.`,
  },
  {
    q: 'Do Stellr activities count toward PD or CTE hours?',
    a: `Every educator who supports a Challenge or Campaign receives a PD certificate for ${EVENT_PD_HOURS} hours, depending on the event, with the Common Core standards covered mapped on the back. Whether they count toward CTE or recertification is decided by your district or state.`,
  },
  {
    q: 'Do I have to stay with students at a live Challenge?',
    a: 'Yes — teachers bringing a team stay at the venue for the day. You don’t need to be an engineer or scientist, and you can join in or use the time for your own work.',
  },
  {
    q: 'How is student information protected?',
    a: 'Student details are encrypted and stored securely, never shared or sold, and group registration captures the agreements your school requires.',
  },
] as const

export const metadata: Metadata = {
  alternates: { canonical: '/educators' },
  title: 'For Educators & Schools',
  description:
    'Stellr supports the educators and schools who bring real-world STEM challenges to their students — with curriculum material, CTE pathways, and classroom support.',
}

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

/* NOTE: The Educators and Schools sections were left blank in the source doc;
   the copy below is on-brand draft placeholder content for review. The Teacher Grant
   section is NOT placeholder — it is the approved program copy, and its numbers
   come from lib/grant.ts so the page, the agreement and the API route agree. */

const sections = [
  { id: 'educators', label: 'For Educators' },
  { id: 'credentials', label: 'PD Certificates' },
  { id: 'grant', label: 'Teacher Grant' },
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
      <Hero
        breadcrumb="Community → For Educators & Schools"
        title="Bring real-world STEM to your students"
        lead="Educators are at the heart of how Stellr reaches students. We give you the curriculum, the training, and the support to deliver industry-grade STEM experiences — without adding to your workload."
        pills={['Free to register', `${EVENT_PD_HOURS} PD hours per event`, 'Common Core aligned']}
      >
        <div className="mt-8 flex flex-wrap gap-3">
          <Button href={`${AUTH_URL}/sign-up`} variant="primary">
            Register as an Educator
          </Button>
          <Button href="/curriculum" as={Link} variant="outlineWhite">
            Browse Curriculum
          </Button>
          <BookCallButton location="educators_hero" variant="outlineWhite" />
        </div>
      </Hero>

      {/* ── In-page anchor nav ────────────────────────────────────────── */}
      <nav
        aria-label="Educator sections"
        className="sticky top-[var(--header-h)] z-30 bg-white border-b border-line-light"
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
          <PullQuoteWall quotes={[QUOTES['teacher-multiple-events']]} columns={1} className="max-w-2xl mx-auto" />
        </div>
      </section>

      {/* ── #educators ────────────────────────────────────────────────── */}
      <section id="educators" className="section-padding bg-white scroll-mt-14">
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

      {/* ── #credentials — the PD certificate ─────────────────────────────
          The sample is the real certificate (scripts/pd-certificate-sample.ts)
          and the standards list is the one printed on its back, so the page
          can't promise what the paper doesn't say. */}
      <section id="credentials" className="section-padding bg-surface scroll-mt-14">
        <div className="container-max">
          <Eyebrow>Professional development</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3 max-w-3xl">Earn PD hours for supporting your students</h2>
          <p className="text-lg text-content-secondary mt-3 max-w-3xl leading-relaxed">
            Every educator who supports a Challenge or Campaign receives a two-page certificate: your PD
            hours on the front, and a map of the Common Core standards your students worked on, on the back.
            Take it to your district for recertification or CTE hours.
          </p>

          <div className="mt-9">
            <PdCertificateSample />
          </div>

          <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-start">
            <div>
              <h3 className="font-bold text-ink">What&rsquo;s on it</h3>
              <ul className="mt-3 space-y-2.5">
                {[
                  'Your hours of effort, with the event, its date and location',
                  'What your students produced, and the professional learning focus',
                  `A standards alignment map: ${PD_STANDARDS.length} Common Core standards, marked against each stage of the event`,
                  'A certificate number your district can verify online',
                  'One click to add it to your LinkedIn profile',
                ].map((item) => (
                  <li key={item} className="flex gap-2.5 text-content-secondary leading-relaxed">
                    <Check size={18} className="mt-0.5 shrink-0 text-enviro-green-text" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="font-bold text-ink">How you earn hours</h3>
              <dl className="mt-3 divide-y divide-line-light rounded-ds-card border border-line bg-white">
                {[
                  ['Bring a team to a live Challenge', `${EVENT_PD_HOURS} hours, depending on the event`],
                  ['Run a Campaign with your students', `${EVENT_PD_HOURS} hours, depending on the Campaign`],
                  ['Join the Teacher Grant Program', `${GRANT_PD_HOURS} documented contact hours`],
                ].map(([how, hours]) => (
                  <div key={how} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                    <dt className="text-sm text-content-secondary">{how}</dt>
                    <dd className="text-sm font-semibold text-ink sm:text-right">{hours}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-sm text-content-muted leading-relaxed">
                Whether hours count toward recertification or CTE is decided by your district or state.
              </p>
            </div>
          </div>

          <details className="mt-8 rounded-ds-card border border-line bg-white px-5 py-4">
            <summary className="cursor-pointer font-semibold text-ink">
              The {PD_STANDARDS.length} standards on the certificate
            </summary>
            <ul className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 md:grid-cols-2">
              {PD_STANDARDS.map((s) => (
                <li key={s.code} className="text-sm text-content-secondary">
                  <span className="font-semibold text-ink">{s.code}</span> — {s.label}
                </li>
              ))}
            </ul>
          </details>
        </div>
      </section>

      {/* ── Educator video testimonials (moved above Teacher Grant) ─── */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <div className="grid gap-6 sm:grid-cols-2 max-w-5xl mx-auto items-start">
            <AudioTestimonial audio={AUDIO['testimonial-jeremiah-dibley']} />
            {[VIDEOS['testimonial-maureen-lancaster']].map((v) => (
              <figure key={v.id}>
                <VideoTestimonial src={v.src} poster={v.poster} posterSrcSet={v.posterSrcSet} captionsSrc={v.captions} title={v.title} />
                <figcaption className="mt-3 text-sm font-semibold text-brand-blue-dark">{v.title}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* ── #grant ────────────────────────────────────────────────────────
          Teaser only. The full program — earnings table, FAQ (with its FAQPage
          schema) and the application form — lives once, at /grant. Two pages
          carrying the same copy would compete for the same search terms and
          double every future edit. */}
      <section id="grant" className="section-padding bg-brand-grey-light scroll-mt-14">
        <div className="container-max">
          <div className="max-w-3xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-11 h-11 rounded-lg bg-brand-blue/10 flex items-center justify-center">
                <Wallet size={22} className="text-brand-blue" />
              </div>
              <p className="text-sm font-bold uppercase tracking-widest text-brand-blue">
                Teacher Grant
              </p>
            </div>
            <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">
              We support the teachers who want to offer Stellr activities to their students
            </h2>
            <p className="text-brand-grey-dark leading-relaxed mb-6">
              Taking a team to a live Challenge or running a Campaign at your school takes real
              time. The Teacher Grant Program is how we recognize that work —{' '}
              {grantAmount(GRANT_AMOUNTS.annualMaximum)}{' '}
              a year at most, plus {GRANT_PD_HOURS} documented PD contact hours and free Catalyst
              membership. Open to U.S. high school teachers, {GRANT_PLACES} places for{' '}
              {GRANT_PROGRAM_YEAR}.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/grant" prefetch={false} className="btn-primary">
                See the Teacher Grant <ArrowRight size={16} />
              </Link>
              <Link href="/grant#apply" className="btn-outline">
                Apply now
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── #schools ──────────────────────────────────────────────────── */}
      <section id="schools" className="section-padding bg-white scroll-mt-14">
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
          <ProofStrip photos={[PHOTOS['educators-2']]} captions={false} columns={1} />
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-5">
            {[COMPETITION['mission-handbook-2026'], COMPETITION['student-presentation-2026']].map((c) => (
              <WorkCard key={c.id} asset={c} eyebrow="Previous Competition Resource" />
            ))}
          </div>
        </div>
      </section>

      <GuideFaq faqs={EDUCATOR_FAQS} />

      {/* ── Closing CTA ───────────────────────────────────────────────── */}
      <section className="section-padding bg-brand-blue-dark text-white text-center">
        <div className="container-max max-w-2xl">
          <h2 className="text-3xl font-bold mb-4">Ready to bring Stellr to your students?</h2>
          <p className="text-hero-lead leading-relaxed mb-8">
            Register as an Educator to unlock Baseline curriculum, or talk to our team about a
            school-wide partnership.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a href={`${AUTH_URL}/sign-up`} className="btn-primary bg-brand-orange text-ink hover:bg-pathway-amber">
              Register as an Educator
            </a>
            <BookCallButton location="educators_cta" variant="outlineWhite" />
          </div>
        </div>
      </section>
    </>
  )
}
