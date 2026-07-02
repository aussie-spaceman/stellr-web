import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  Check,
  ShieldCheck,
  BookOpen,
  FileText,
  Video,
  MessageSquare,
  Infinity as InfinityIcon,
  Users,
  Target,
  UserCheck,
} from 'lucide-react'
import { Launch, Certificate, Idea, Document, Team, Award } from '@stellr/icons'
import { Hero, Eyebrow, Button } from '@stellr/web-ui'
import { PageMedia } from '@/components/sections/PageMedia'
import { PHOTOS, VIDEOS } from '@/lib/media-manifest'

export const metadata: Metadata = {
  title: 'Academy',
  description:
    'The Stellr Academy is where high-school and college students build career-ready ability — through Competition training, hands-on career preparation, and the STEM Power Skills schools rarely teach.',
}

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'
const SIGNUP_URL = `${AUTH_URL}/sign-up`
/* Training lives in the member portal. Deep-link there so guests are bounced
   into the sign-up flow with training preserved as the post-onboarding
   destination, while signed-in members land straight in training. */
const TRAINING_URL = `${AUTH_URL}/community/training`
/* Mentoring is genuinely self-serve — the CTA deep-links straight into the live
   member discovery flow (open cohorts, included-credit vs one-off top-up). Guests
   hit the app's sign-in gate and land here after auth. No dead-end anchors. */
const MENTORING_URL = `${AUTH_URL}/community/mentoring/discover`

/* Toggles the "Why we built it" section (#3). Wire to CMS / a feature flag if
   the marketing team want to hide it. */
const showWhy = true

const pillars = [
  {
    Icon: Launch,
    tileBg: 'bg-primary-soft',
    tileColor: 'text-primary',
    title: 'Competition training',
    body: 'Everything you need to enter and do well in a Stellr Competition — self-paced courses, reference material and recorded webinars, ready the moment you sign up.',
  },
  {
    Icon: Certificate,
    tileBg: 'bg-pathway-amber-bg',
    tileColor: 'text-brand-gold-ink',
    title: 'Career preparation',
    body: 'Practical activities that turn engineering interest into a path — for high-school students choosing a direction and college students heading into internships and jobs.',
  },
  {
    Icon: Idea,
    tileBg: 'bg-space-violet-chip',
    tileColor: 'text-space-violet',
    title: 'STEM Power Skills',
    body: 'The human skills that turn technical knowledge into impact — communicating, collaborating, leading work and recovering from setbacks. Schools rarely grade them; we build them into everything.',
  },
]

const formats = [
  {
    Icon: Document,
    headerBg: 'bg-primary-soft',
    tileColor: 'text-primary',
    name: 'Training',
    featured: false,
    leadBold: 'Learn it on your own.',
    leadRest: 'Self-paced courses and resources you work through anytime.',
    format: 'Self-paced courses within Academy',
    guidance: 'On your own',
    accessLabel: 'Free, or upgrade',
    accessText: 'text-enviro-green-text',
    accessBg: 'bg-enviro-green-bg',
    button: { label: 'Join Free to access training', href: TRAINING_URL, variant: 'softBlue' as const },
  },
  {
    Icon: Team,
    headerBg: 'bg-gradient-to-b from-space-violet-chip to-space-violet-bg',
    tileColor: 'text-space-violet',
    name: 'Mentoring',
    featured: true,
    badge: 'Most popular',
    leadBold: 'Practise it in a group.',
    leadRest: 'A cohort led by a working STEM professional over several weeks.',
    format: 'Small group, multi-week',
    guidance: 'Led by industry professionals',
    accessLabel: 'Competitions or purchase',
    accessText: 'text-space-violet-text',
    accessBg: 'bg-space-violet-chip',
    button: { label: 'Book a mentoring session', href: MENTORING_URL, variant: 'primary' as const },
  },
  {
    Icon: Award,
    headerBg: 'bg-[#E3F6F8]',
    tileColor: 'text-avatar-teal',
    name: 'Coaching',
    featured: false,
    leadBold: 'Refine it one-on-one.',
    leadRest: 'Private sessions with a professional matched to your goals.',
    format: 'Private 1:1 sessions',
    guidance: 'One-on-one, tailored',
    accessLabel: 'Request, earn or buy',
    accessText: 'text-[#0E8C99]',
    accessBg: 'bg-[#E3F6F8]',
    button: { label: 'Request a coaching session', href: '/academy/coaching/request', variant: 'softBlue' as const },
  },
]

const trainingFeatures = [
  {
    Icon: BookOpen,
    title: 'Complete Courses',
    body: 'Comprehensive, structured material on a STEM topic, from fundamentals through mastery.',
  },
  {
    Icon: FileText,
    title: 'Reference Resources',
    body: 'Worksheets, guidelines, how-to guides, and lesson plans you can pull from on demand.',
  },
  {
    Icon: Video,
    title: 'Webinars & AMAs',
    body: 'Scheduled for live attendance, then recorded for offline access by our members.',
  },
]

const mentoringBullets = [
  {
    Icon: MessageSquare,
    text: 'Stellr mentoring is designed for small groups, built around a specific topic, and often running over multiple weeks.',
  },
  {
    Icon: InfinityIcon,
    text: 'When you join a mentoring cohort, you keep access to all the material indefinitely — recorded calls, group chat, and shared training and support resources.',
  },
  {
    Icon: Users,
    text: 'Our sessions are run by STEM professionals — members of our community contributing their time to impart lessons and share their unique perspectives.',
  },
  {
    Icon: Target,
    text: 'Mentoring is designed to take the skills you learn in a Stellr Competition and enhance and embed them — going deeper into the STEM skills that matter most.',
  },
]

const coachingHelps = [
  'How to build professional networks',
  'Improving specific STEM skills',
  'School students: support and guidance on college decisions',
  'College students: support and guidance on internships and graduate jobs',
]

export default function AcademyPage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <Hero
        breadcrumb="The Stellr Academy"
        title="The skills that get you hired aren't on your transcript."
        lead="The Academy is where high-school and college students build career-ready ability — through training that powers our Competitions, hands-on career preparation, and the STEM Power Skills schools rarely teach."
      >
        <div className="flex flex-wrap gap-3.5 mt-8">
          <Button href={MENTORING_URL} variant="primary">
            Book a mentoring session
          </Button>
          <Button href="/membership" as={Link} variant="outlineWhite">
            See tiers &amp; pricing
          </Button>
        </div>
        <p className="text-[13px] text-hero-dim mt-6">
          Start free with your Stellr membership · Mentoring &amp; Coaching available year round
        </p>
      </Hero>

      {/* ── Why we built it (toggleable) ──────────────────────────────── */}
      {showWhy && (
        <section className="section-padding bg-surface border-t border-line-light">
          <div className="container-max grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-14 items-start">
            <div>
              <Eyebrow className="text-space-violet">Why we built it</Eyebrow>
              <h2 className="text-3xl font-bold text-ink mt-3 max-w-sm leading-tight">
                There&rsquo;s a gap between school and a STEM career. We close it.
              </h2>
            </div>
            <div>
              <p className="text-lg font-medium text-ink leading-relaxed">
                Some of the most career-critical skills in STEM are never taught in high school or college —
                communicating an idea, leading real work, recovering when a plan fails.
              </p>
              <p className="text-content-secondary mt-4 leading-relaxed">
                We started the Academy to close that gap — a single place where any student can build the
                ability that turns STEM knowledge into a career, on their own terms.
              </p>
              <div className="mt-6 space-y-4">
                <div className="border-l-[3px] border-space-violet pl-4">
                  <p className="font-bold text-ink">Career-critical, classroom-absent</p>
                  <p className="text-sm text-content-secondary mt-1 leading-relaxed">
                    The skills industry hires for are rarely on a syllabus. We make them learnable.
                  </p>
                </div>
                <div className="border-l-[3px] border-primary pl-4">
                  <p className="font-bold text-ink">Open to every student</p>
                  <p className="text-sm text-content-secondary mt-1 leading-relaxed">
                    Anyone can join free and start — no competition or payment required to begin.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── Three things the Academy gives you ────────────────────────── */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <Eyebrow>What you need</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3">Three things the Academy gives you</h2>
          <p className="text-content-secondary mt-3 max-w-2xl leading-relaxed">
            Not a list of named skills — the three things the Academy actually delivers.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-[18px] mt-9 items-stretch">
            {pillars.map((p) => (
              <div key={p.title} className="flex flex-col bg-white border border-line rounded-panel p-7">
                <span className={`w-[50px] h-[50px] rounded-[13px] flex items-center justify-center ${p.tileBg} ${p.tileColor}`}>
                  <p.Icon size={26} />
                </span>
                <h3 className="text-xl font-bold text-ink mt-5">{p.title}</h3>
                <p className="text-[15px] text-content-secondary mt-2 leading-relaxed">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Three ways to access ──────────────────────────────────────── */}
      <section className="section-padding bg-midnight text-white">
        <div className="container-max">
          <Eyebrow className="text-hero-dim">How you get in</Eyebrow>
          <h2 className="text-3xl font-bold mt-3">Three ways to access the Academy</h2>
          <p className="text-hero-lead mt-3 max-w-2xl leading-relaxed">
            Join free, keep going with a paid tier, or earn mentoring and coaching by competing.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-9 items-stretch">
            {/* Free */}
            <div className="flex flex-col rounded-panel bg-[#171E45] border border-[#2A3266] p-7">
              <p className="text-xs font-subheading font-bold uppercase tracking-[0.12em] text-[#6FE3C0]">Free</p>
              <h3 className="text-xl font-bold mt-2">Join and start learning</h3>
              <p className="text-[15px] text-hero-lead mt-3 leading-relaxed flex-1">
                A free membership unlocks core Academy content — anyone can create an account and begin. No
                payment, no competition required.
              </p>
              <Button href={SIGNUP_URL} variant="outlineWhite" className="mt-6 self-start !px-4 !py-2.5">
                Create free account
              </Button>
            </div>
            {/* Upgrade */}
            <div className="flex flex-col rounded-panel bg-[#171E45] border border-[#2A3266] p-7">
              <p className="text-xs font-subheading font-bold uppercase tracking-[0.12em] text-star-gold">Upgrade</p>
              <h3 className="text-xl font-bold mt-2">Keep going further</h3>
              <p className="text-[15px] text-hero-lead mt-3 leading-relaxed flex-1">
                Paid membership tiers continue your learning — more courses, deeper material and ongoing
                resources as you grow. Or purchase mentoring or coaching sessions directly — we&rsquo;re here
                to help you!
              </p>
              <Button href="/membership" as={Link} variant="outlineWhite" className="mt-6 self-start !px-4 !py-2.5">
                Compare tiers
              </Button>
            </div>
            {/* Earn it — featured */}
            <div className="relative flex flex-col rounded-panel bg-[#1B2454] border-[1.5px] border-space-violet p-7 shadow-[0_0_0_4px_rgba(124,92,252,0.12)]">
              <span className="absolute -top-3 left-6 rounded-full bg-space-violet text-white text-[10.5px] font-bold uppercase tracking-wide px-3 py-1">
                The big one
              </span>
              <p className="text-xs font-subheading font-bold uppercase tracking-[0.12em] text-[#C3B6FF]">Earn it</p>
              <h3 className="text-xl font-bold mt-2">Win mentoring &amp; coaching</h3>
              <p className="text-[15px] text-hero-lead mt-3 leading-relaxed flex-1">
                Joining our Competitions — attending in-person events or our remote Campaigns — gives Members
                the opportunity to access higher training tiers, customized mentoring groups, and dedicated
                coaching sessions. Compete to unlock.
              </p>
              <Button href="/competitions" as={Link} variant="primary" className="mt-6 self-start !px-4 !py-2.5">
                See Competitions
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Training, Mentoring & Coaching — difference ───────────────── */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <Eyebrow>The formats</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3">
            Training, Mentoring &amp; Coaching — what&rsquo;s the difference?
          </h2>
          <p className="text-content-secondary mt-3 max-w-2xl leading-relaxed">
            Three formats, three ways to learn — pick the one that matches how you want to grow.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-9 items-stretch">
            {formats.map((f) => (
              <div
                key={f.name}
                className={`flex flex-col rounded-panel overflow-hidden bg-white ${
                  f.featured
                    ? 'border-2 border-space-violet shadow-[0_24px_50px_-28px_rgba(124,92,252,0.7)]'
                    : 'border border-line'
                }`}
              >
                <div className={`px-6 py-5 flex items-center gap-3 ${f.headerBg}`}>
                  <span className={`w-10 h-10 rounded-xl bg-white flex items-center justify-center ${f.tileColor}`}>
                    <f.Icon size={22} />
                  </span>
                  <span className="font-bold text-ink text-lg flex-1">{f.name}</span>
                  {f.badge && (
                    <span className="rounded-full bg-space-violet text-white text-[10.5px] font-bold uppercase tracking-wide px-2.5 py-1">
                      {f.badge}
                    </span>
                  )}
                </div>
                <div className="px-6 py-5 flex flex-col flex-1">
                  <p className="text-[15px] text-content-secondary leading-relaxed">
                    <strong className="text-ink">{f.leadBold}</strong> {f.leadRest}
                  </p>
                  <dl className="mt-4 pt-4 border-t border-line space-y-2.5 flex-1">
                    {[
                      ['Format', f.format],
                      ['Guidance', f.guidance],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-3 text-sm">
                        <dt className="text-content-muted">{k}</dt>
                        <dd className="font-semibold text-ink text-right">{v}</dd>
                      </div>
                    ))}
                    <div className="flex justify-between items-center gap-3 text-sm">
                      <dt className="text-content-muted">Access</dt>
                      <dd>
                        <span className={`rounded-full text-xs font-bold px-2.5 py-1 ${f.accessBg} ${f.accessText}`}>
                          {f.accessLabel}
                        </span>
                      </dd>
                    </div>
                  </dl>
                  <Button
                    href={f.button.href}
                    as={f.button.href.startsWith('/') ? Link : undefined}
                    variant={f.button.variant}
                    className="mt-5 self-start"
                  >
                    {f.button.label} <ArrowRight size={16} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Training deep-dive ────────────────────────────────────────── */}
      <section id="training" className="section-padding bg-surface border-t border-line-light scroll-mt-24">
        <div className="container-max grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-16 items-start">
          <div>
            <Eyebrow>Training</Eyebrow>
            <h2 className="text-3xl font-bold text-ink mt-3">Learn on your own schedule</h2>
            <p className="text-content-secondary mt-4 leading-relaxed">
              Training is a full learning library inside the Academy — work through it anytime, anywhere, at
              your own pace.
            </p>
            <p className="text-content-secondary mt-4 leading-relaxed">
              It carries both the material that powers our Competitions and dedicated educator and CTE
              content, so students and teachers alike have what they need.
            </p>
            <div className="mt-6 flex gap-4 bg-white border border-line rounded-panel p-5 shadow-card-lift">
              <ShieldCheck size={22} className="shrink-0 text-primary" />
              <p className="text-sm text-content-secondary leading-relaxed">
                We take cybersecurity seriously. All material, student details, and access information is
                encrypted and secure.
              </p>
            </div>
          </div>
          <div className="space-y-4">
            {trainingFeatures.map((f) => (
              <div key={f.title} className="flex gap-4 bg-white border border-line rounded-card p-5 shadow-card-lift">
                <span className="w-[46px] h-[46px] rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                  <f.Icon size={22} />
                </span>
                <div>
                  <p className="text-lg font-bold text-ink">{f.title}</p>
                  <p className="text-[14.5px] text-content-secondary mt-1 leading-relaxed">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Mentoring deep-dive ───────────────────────────────────────── */}
      <section id="mentoring" className="section-padding bg-white scroll-mt-24">
        <div className="container-max grid grid-cols-1 lg:grid-cols-[1fr_1.15fr] gap-14 items-center">
          <figure
            className="rounded-panel overflow-hidden border border-line min-h-[340px] bg-gradient-to-br from-space-violet-bg via-primary-soft to-enviro-green-bg flex items-center justify-center"
            aria-label="Placeholder for a Stellr cohort collaboration photo"
          >
            <span className="flex items-center gap-2 text-content-faint text-sm font-medium">
              <Team size={20} /> Cohort photo to be added
            </span>
          </figure>
          <div>
            <Eyebrow className="text-space-violet">Mentoring</Eyebrow>
            <h2 className="text-3xl font-bold text-ink mt-3">Go deeper, in a small group</h2>
            <ul className="mt-6 space-y-5">
              {mentoringBullets.map((b) => (
                <li key={b.text} className="flex gap-3.5">
                  <b.Icon size={22} className="shrink-0 mt-0.5 text-primary" />
                  <span className="text-base text-[#3A416A] leading-relaxed">{b.text}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-[15px] text-content-secondary leading-relaxed">
              Mentoring is included with paid member tiers — browse open cohorts and register in a
              couple of clicks. Extra sessions can be topped up anytime.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button href={MENTORING_URL} variant="primary">
                Book a mentoring session <ArrowRight size={16} />
              </Button>
              <Button href="/membership" as={Link} variant="secondary">
                Explore membership tiers
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Coaching deep-dive ────────────────────────────────────────── */}
      <section id="coaching" className="section-padding bg-surface border-t border-line-light scroll-mt-24">
        <div className="container-max grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-16 items-start">
          <div>
            <Eyebrow className="text-[#0E8C99]">Coaching</Eyebrow>
            <h2 className="text-3xl font-bold text-ink mt-3">One-on-one, tailored to you</h2>
            <p className="text-content-secondary mt-4 leading-relaxed">
              Coaching is private and personal — a professional matched to your goals, working with you
              directly to move you forward.
            </p>
            <div className="mt-6 flex gap-4 bg-white border border-line rounded-panel p-5 shadow-card-lift">
              <InfinityIcon size={22} className="shrink-0 text-avatar-teal" />
              <p className="text-sm text-content-secondary leading-relaxed">
                All coaching material is maintained indefinitely against your Stellr member profile —
                recorded calls, private coaching chat, and shared material.
              </p>
            </div>
            <p className="mt-6 text-[15px] text-content-secondary leading-relaxed">
              Tell us what you want to work on and we&rsquo;ll match you with a coach. Coaching is included with
              our top tiers or earned by competing — otherwise you can pay per session.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button href="/academy/coaching/request" as={Link} variant="primary">
                Request a coaching session <ArrowRight size={16} />
              </Button>
              <Button href="/membership" as={Link} variant="secondary">
                Explore membership tiers
              </Button>
            </div>
          </div>
          <div className="bg-white rounded-panel p-7 sm:p-8 shadow-card-lift">
            <p className="text-lg font-bold text-ink">What coaching can help with:</p>
            <ul className="mt-5 space-y-4">
              {coachingHelps.map((c) => (
                <li key={c} className="flex gap-3">
                  <UserCheck size={20} className="shrink-0 mt-0.5 text-primary" />
                  <span className="text-[15.5px] text-[#3A416A] leading-relaxed">{c}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── CTA band ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden text-white py-16 px-4 sm:px-6 lg:px-8 bg-[radial-gradient(120%_160%_at_80%_-20%,#28306B_0%,#141A3D_50%,#0E1330_100%)]">
        <div className="container-max flex flex-wrap items-center justify-between gap-6">
          <div className="max-w-xl">
            <h2 className="text-3xl font-bold leading-tight">
              Start free today. Access more as and when you need.
            </h2>
            <p className="text-hero-lead mt-3 leading-relaxed">
              Create a free account to start learning, register for a Competition to unlock mentoring and
              coaching, or upgrade your Membership anytime.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button href={SIGNUP_URL} variant="primary">
              Join free
            </Button>
            <Button href="/competitions" as={Link} variant="outlineWhite">
              Explore Competitions
            </Button>
          </div>
        </div>
      </section>

      {/* ── Media: training in action ─────────────────────────────────── */}
      <PageMedia
        heading="Training in action"
        photos={[PHOTOS['academy-1'], PHOTOS['academy-2'], PHOTOS['academy-3']]}
        videos={[VIDEOS['testimonial-tom-wilson']]}
      />
    </>
  )
}
