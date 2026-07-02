import type { Metadata } from 'next'
import { ArrowRight, Check } from 'lucide-react'
import { Launch, Certificate, Team, Award, Global } from '@stellr/icons'
import { Hero, Eyebrow, Button } from '@stellr/web-ui'
import { VideoTestimonial } from '@/components/sections/VideoTestimonial'
import { WorkCard } from '@/components/sections/WorkCard'
import { VIDEOS, QUOTES, COMPETITION } from '@/lib/media-manifest'

export const metadata: Metadata = {
  title: 'Why Stellr?',
  description:
    'Stellr connects high school, college and professional life into a single community. Here is what that means for students, teachers, parents, mentors and donors.',
}

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'
const WWW = 'https://www.stellreducation.org'

const jumpLinks = [
  { label: 'Students', href: '#students' },
  { label: 'Teachers', href: '#teachers' },
  { label: 'Parents', href: '#parents' },
  { label: 'Mentors', href: '#mentors' },
  { label: 'Donors', href: '#donors' },
]

/* ── Section header (accent tile + eyebrow) ───────────────────────────── */
function SectionHead({
  Icon,
  tileBg,
  eyebrowColor,
  eyebrow,
}: {
  Icon: React.ComponentType<{ size?: number }>
  tileBg: string
  eyebrowColor: string
  eyebrow: string
}) {
  return (
    <div className="flex items-center gap-3.5">
      <span className={`w-11 h-11 rounded-xl flex items-center justify-center text-white ${tileBg}`}>
        <Icon size={24} />
      </span>
      <Eyebrow className={eyebrowColor}>{eyebrow}</Eyebrow>
    </div>
  )
}

export default function WhyStellrPage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <Hero
        breadcrumb="About → Why Stellr"
        title="Why Stellr?"
        lead="Stellr connects high school, college and professional life into a single community — so the path into a STEM career stops being a mystery. Here is what that means for you."
      >
        <div className="flex flex-wrap gap-3 mt-8">
          {jumpLinks.map((j) => (
            <a
              key={j.href}
              href={j.href}
              className="text-[14.5px] font-medium text-[#DDE3FB] bg-white/5 border border-white/15 px-[18px] py-[9px] rounded-full hover:bg-white/10 transition-colors"
            >
              {j.label}
            </a>
          ))}
        </div>
      </Hero>

      {/* ── Students ──────────────────────────────────────────────────── */}
      <section id="students" className="section-padding bg-white scroll-mt-28">
        <div className="container-max grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-14 items-start">
          <div>
            <SectionHead Icon={Launch} tileBg="bg-primary" eyebrowColor="text-primary" eyebrow="Students" />
            <h2 className="text-3xl font-bold text-ink mt-5 leading-tight">
              The best of high-school STEM — and a head start on what comes next.
            </h2>
            <div className="mt-5 space-y-4 text-base text-content-body leading-relaxed">
              <p>
                Stellr brings the most ambitious high-school STEM students together for cross-disciplinary
                challenges judged the way real projects are judged — by working professionals, in the room
                with your team.
              </p>
              <p>
                Take part once and you are part of the community for good: alumni membership keeps you
                connected through college and into industry, with the mentors, events and opportunities that
                turn an interest in STEM into a career.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 mt-7">
              <Button href={`${AUTH_URL}/sign-up`} variant="primary">
                Create your free account
              </Button>
              <Button href={`${WWW}/students`} variant="secondary">
                For students
              </Button>
            </div>
          </div>

          {/* Stat cards */}
          <div className="flex flex-col gap-4">
            {[
              {
                stat: 'Top 1%',
                statClass: 'text-primary',
                body: 'of high-school STEM achievers are part of the Stellr community.',
              },
              {
                stat: 'Cross-disciplinary',
                statClass: 'text-ink',
                body: 'Engineering, science, business and communication — in one challenge.',
              },
              {
                stat: 'Real mentors',
                statClass: 'text-ink',
                body: 'Industry professionals in the room with your team at every event.',
              },
            ].map((c) => (
              <div
                key={c.stat}
                className="bg-white border border-line rounded-ds-card px-6 py-[22px] shadow-card-lift"
              >
                <p className={`text-2xl font-bold ${c.statClass}`}>{c.stat}</p>
                <p className="mt-1.5 text-[15px] text-content-secondary leading-relaxed">{c.body}</p>
              </div>
            ))}
            {/* Free-to-download document (moved here as a fourth card) */}
            <WorkCard asset={COMPETITION['legacy-rfp-south-dakota-2025']} />
          </div>
        </div>
      </section>

      {/* ── Teachers ──────────────────────────────────────────────────── */}
      <section id="teachers" className="section-padding bg-surface border-t border-line-light scroll-mt-28">
        <div className="container-max grid grid-cols-1 lg:grid-cols-[0.95fr_1.05fr] gap-14 items-start">
          <div>
            <SectionHead
              Icon={Certificate}
              tileBg="bg-enviro-green"
              eyebrowColor="text-enviro-green-text"
              eyebrow="Teachers"
            />
            <h2 className="text-3xl font-bold text-ink mt-5 leading-tight">
              Bring real-world STEM into your classroom — with support at every step.
            </h2>
            <p className="mt-5 text-base text-content-body leading-relaxed">
              Stellr gives you open-ended, industry-grade challenges your students can take on at any ability
              level, plus the lessons, mentoring and CPD to deliver them with confidence.
            </p>

            {/* AI callout */}
            <div className="mt-6 bg-space-violet-bg border-l-[3px] border-space-violet rounded-r-xl px-6 py-5">
              <p className="text-[15px] text-content-body leading-relaxed">
                <span className="font-semibold text-ink">A note on AI.</span> We give educators the tools,
                lessons and support to use AI themselves — and to safely encourage their students to do so.
              </p>
              <a
                href={`${WWW}/impact`}
                className="inline-flex items-center gap-1 mt-2.5 text-sm font-semibold text-space-violet-text"
              >
                Read our approach <ArrowRight size={14} />
              </a>
            </div>

            <div className="flex flex-wrap gap-3 mt-7">
              <Button href={`${WWW}/events`} variant="primary">
                Register your students
              </Button>
              <Button href={`${WWW}/educators`} variant="secondary">
                For educators &amp; schools
              </Button>
            </div>

            {/* Video testimonial (moved here, under the CTA buttons) */}
            <figure className="mt-8">
              <VideoTestimonial
                src={VIDEOS['testimonial-sepp'].src}
                poster={VIDEOS['testimonial-sepp'].poster}
                captionsSrc={VIDEOS['testimonial-sepp'].captions}
                title={VIDEOS['testimonial-sepp'].title}
              />
              <figcaption className="mt-3 text-sm font-semibold text-ink">{VIDEOS['testimonial-sepp'].title}</figcaption>
            </figure>
          </div>

          {/* Checklist card */}
          <div className="bg-white border border-line rounded-ds-card p-1.5 shadow-card-lift">
            {[
              'Complex, open-ended challenges suited to students of every ability level.',
              'An industry-simulation context that brings classroom learning to life.',
              'A competitive setting that builds large-group communication and leadership.',
              'CPD for you — attend as an educator and observe professional mentoring in action.',
            ].map((item, i, arr) => (
              <div
                key={item}
                className={`flex gap-3.5 px-6 py-5 ${i < arr.length - 1 ? 'border-b border-line-light' : ''}`}
              >
                <span className="shrink-0 w-6 h-6 rounded-full bg-enviro-green-bg flex items-center justify-center mt-0.5">
                  <Check size={14} strokeWidth={2.6} className="text-enviro-green" />
                </span>
                <p className="text-[15px] text-content-body leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Parents ───────────────────────────────────────────────────── */}
      <section id="parents" className="section-padding bg-white scroll-mt-28">
        <div className="container-max grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-14 items-start">
          <div>
            <SectionHead
              Icon={Team}
              tileBg="bg-space-violet"
              eyebrowColor="text-space-violet-text"
              eyebrow="Parents"
            />
            <h2 className="text-3xl font-bold text-ink mt-5 leading-tight">
              A safe, structured place for your child to do their most exciting work.
            </h2>
            <p className="mt-5 text-base text-content-body leading-relaxed">
              Stellr events are mentored, supervised and built around teamwork — a setting where students
              stretch themselves, meet like-minded peers from across the country, and discover what a STEM
              career can really look like.
            </p>

            {/* Testimonial — Jason Zibart, 2025 */}
            <blockquote className="mt-7 bg-space-violet-bg border-l-[3px] border-space-violet rounded-r-xl px-7 py-6">
              <p className="font-display text-xl font-medium text-ink leading-snug">
                &ldquo;{QUOTES['jason-zibart'].text}&rdquo;
              </p>
              <footer className="mt-3 text-[13.5px] text-[#6B6790]">
                &mdash; {QUOTES['jason-zibart'].name} · {QUOTES['jason-zibart'].meta}
              </footer>
            </blockquote>

            <div className="mt-7">
              <Button href={`${WWW}/events`} variant="primary">
                Find an event near you
              </Button>
            </div>
          </div>

          {/* Feature cards — right side, stacked */}
          <div className="flex flex-col gap-4">
            {[
              {
                title: 'Safe & structured',
                body: 'Supervised, mentored events with clear safeguarding and a supportive team setting.',
              },
              {
                title: 'Peer networking',
                body: 'Your child meets ambitious, like-minded students from across the country.',
              },
              {
                title: 'Mentored environment',
                body: 'Industry professionals guide each team, modelling how real STEM work gets done.',
              },
            ].map((c) => (
              <div key={c.title} className="bg-white border border-line rounded-ds-card p-5">
                <h3 className="font-display text-[17px] font-bold text-ink">{c.title}</h3>
                <p className="mt-2 text-[14.5px] text-content-secondary leading-relaxed">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Mentors ───────────────────────────────────────────────────── */}
      <section id="mentors" className="section-padding bg-surface border-t border-line-light scroll-mt-28">
        <div className="container-max grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-14 items-center">
          <div>
            <SectionHead
              Icon={Award}
              tileBg="bg-avatar-teal"
              eyebrowColor="text-[#0E8A95]"
              eyebrow="Mentors"
            />
            <h2 className="text-3xl font-bold text-ink mt-5 leading-tight">
              Spend a day with the next generation of STEM talent.
            </h2>
            <p className="mt-5 text-base text-content-body leading-relaxed">
              As a Stellr mentor you sit alongside student teams as they tackle real challenges — sharing how
              the profession actually works, and helping shape the engineers, scientists and leaders who
              follow you.
            </p>
            <div className="flex flex-wrap gap-3 mt-7">
              <Button href={`${WWW}/contact?type=mentor`} variant="primary">
                Volunteer as a mentor
              </Button>
              <Button href={`${WWW}/mentors`} variant="secondary">
                For volunteers &amp; mentors
              </Button>
            </div>
          </div>

          {/* Dark callout card */}
          <div className="relative overflow-hidden bg-midnight rounded-panel p-[30px] text-white">
            <p className="text-[11px] font-display font-bold uppercase tracking-[0.13em] text-[#5BD6E2]">
              Alumni upgrade
            </p>
            <h3 className="font-display text-[21px] font-bold mt-2 leading-tight">
              From student to mentor, automatically.
            </h3>
            <p className="mt-3 text-[15px] text-hero-lead leading-relaxed">
              Former student participants receive Alumni membership on graduating — staying connected to the
              Stellr community as they enter industry, and stepping back in to mentor the teams that follow
              them.
            </p>
          </div>
        </div>
      </section>

      {/* ── Donors ────────────────────────────────────────────────────── */}
      <section id="donors" className="section-padding bg-white scroll-mt-28">
        <div className="container-max">
          <div className="max-w-[680px]">
            <SectionHead
              Icon={Global}
              tileBg="bg-donate-gold"
              eyebrowColor="text-[#B5791E]"
              eyebrow="Donors"
            />
            <h2 className="text-3xl font-bold text-ink mt-5 leading-tight">
              Fund the access that makes talent, not circumstance, the deciding factor.
            </h2>
            <p className="mt-5 text-base text-content-body leading-relaxed">
              Stellr is a registered 501(c)(3). Donations and sponsorships fund the scholarships, resources
              and access that let talented students take part regardless of circumstance — as we work to
              positively impact 100,000 students over the next decade.
            </p>
          </div>

          {/* Gold cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
            {[
              {
                title: 'Event sponsorship',
                body: 'Associate your brand with high-achieving STEM students and industry professionals.',
              },
              {
                title: 'Scholarship funding',
                body: 'Ensure talented students can participate regardless of financial circumstances.',
              },
              {
                title: 'Resource grants',
                body: 'Fund the materials and technology that make our challenges possible.',
              },
              {
                title: 'Legacy giving',
                body: 'Make a lasting contribution to STEM education across the US and beyond.',
              },
            ].map((c) => (
              <div
                key={c.title}
                className="bg-[#FBF4E7] border border-[#F0E3C4] rounded-ds-card p-[22px]"
              >
                <h3 className="font-display text-base font-bold text-ink">{c.title}</h3>
                <p className="mt-2 text-sm text-[#6A5A38] leading-relaxed">{c.body}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-8">
            {/* Prospectus download — inactive until the document is ready (matches /network). */}
            <button
              type="button"
              disabled
              aria-disabled="true"
              title="Coming soon"
              className="inline-flex items-center justify-center gap-2 rounded-control px-6 py-3 font-subheading font-semibold text-sm text-content-faint bg-surface border border-line cursor-not-allowed opacity-70"
            >
              Request prospectus
            </button>
            <a
              href={`${WWW}/donate`}
              className="inline-flex items-center justify-center gap-2 rounded-control px-6 py-3 font-subheading font-semibold text-sm text-white bg-donate-gold hover:bg-[#C9892C] transition-colors"
            >
              Make a donation
            </a>
            <p className="text-[13.5px] text-content-faint">
              Prospectus coming soon — full packages, reach statistics and impact data.
            </p>
          </div>
        </div>
      </section>

      {/* ── Closing CTA ───────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-midnight text-white text-center py-20 px-4 sm:px-6 lg:px-8 bg-[radial-gradient(120%_140%_at_15%_-20%,#28306B_0%,#141A3D_50%,#0E1330_100%)]">
        <div className="container-max max-w-xl">
          <h2 className="text-3xl font-bold leading-tight">Find your place at Stellr.</h2>
          <p className="mt-4 text-[17px] text-hero-lead leading-relaxed">
            Wherever you start — student, educator, parent, mentor or supporter — there is a way to be part
            of the community.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mt-8">
            <Button href={`${AUTH_URL}/sign-up`} variant="primary">
              Join free
            </Button>
            <Button href={`${WWW}/membership`} variant="outlineWhite">
              Explore membership
            </Button>
          </div>
        </div>
      </section>
    </>
  )
}
