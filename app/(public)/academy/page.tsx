import type { Metadata } from 'next'
import Link from 'next/link'
import {
  GraduationCap,
  Users,
  UserCheck,
  BookOpen,
  FileText,
  Video,
  ShieldCheck,
  MessageSquare,
  Infinity as InfinityIcon,
  Presentation,
  Handshake,
  Clock,
  Target,
  RefreshCw,
  ArrowRight,
} from 'lucide-react'

export const metadata: Metadata = {
  title: 'Academy',
  description:
    'The Stellr Academy is the central reference point for every member to upskill — Training, Mentoring, and Coaching in the STEM Skills that tomorrow’s professionals need to succeed.',
}

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

/* ── The three pillars of the Academy ──────────────────────────────── */
const pillars = [
  {
    id: 'training',
    icon: GraduationCap,
    label: 'Training',
    blurb: 'Asynchronous learning material to support your career development.',
  },
  {
    id: 'mentoring',
    icon: Users,
    label: 'Mentoring',
    blurb: 'Small-group mentoring sessions that run over multiple weeks.',
  },
  {
    id: 'coaching',
    icon: UserCheck,
    label: 'Coaching',
    blurb: 'One-on-one private coaching sessions with STEM professionals.',
  },
]

/* ── What are STEM Skills? — 5 examples, the gap, and how Stellr delivers ── */
const stemSkills = [
  {
    icon: Presentation,
    skill: 'Communicating Technical Ideas',
    gap: 'Traditional classes grade the final answer, not your ability to explain it to someone who isn’t an expert.',
    stellr: 'Every competition ends in a live presentation or written proposal pitched to a panel of judges.',
  },
  {
    icon: Handshake,
    skill: 'Collaborating Under Constraint',
    gap: 'Most schoolwork is graded individually, so students rarely practice resolving conflicting ideas inside a team.',
    stellr: 'Design competitions are team-based, with fixed deadlines and real resource limits.',
  },
  {
    icon: Clock,
    skill: 'Project & Time Management',
    gap: 'Deadlines are handed down rather than planned, so students never learn to scope and sequence their own work.',
    stellr: 'Advanced material includes PM tools, agentic AI sub-contractors, and multi-week schedules students run themselves.',
  },
  {
    icon: Target,
    skill: 'Problem-Solving With No Single Right Answer',
    gap: 'Textbooks reward the one correct solution; the real world rewards good trade-offs under ambiguity.',
    stellr: 'Open-ended RFP and Mission challenges have no model answer — only stronger and weaker engineering.',
  },
  {
    icon: RefreshCw,
    skill: 'Resilience & Acting on Feedback',
    gap: 'A grade is final, not iterative, so students rarely learn to improve a design after honest critique.',
    stellr: 'Mentoring and coaching give recorded, tailored feedback that students act on across multiple rounds.',
  },
]

/* ── How the Academy empowers each member type (from the doc table) ──── */
const memberMatrix = [
  {
    type: 'High School Students',
    training: 'Complete mandatory training for competitions, and find optional material for career development.',
    mentoring: 'Competition participants can access free mentoring sessions.',
    coaching: 'Competition award winners receive free coaching sessions.',
  },
  {
    type: 'College Students',
    training: 'Sharpen the STEM-specific soft skills you’ll need to stand out — at college and beyond.',
    mentoring: 'Join sessions to participate as a competition volunteer.',
    coaching: 'Connect with industry professionals and ask for career advice.',
  },
  {
    type: 'Educators',
    training: 'Complete CTE training.',
    mentoring: 'Join CTE groups.',
    coaching: 'Optional sessions for enhanced competition delivery.',
  },
]

/* ── #training detail ──────────────────────────────────────────────── */
const trainingMaterial = [
  {
    icon: BookOpen,
    title: 'Complete Courses',
    description: 'Comprehensive, structured material on a STEM topic, from fundamentals through mastery.',
  },
  {
    icon: FileText,
    title: 'Reference Resources',
    description: 'Worksheets, guidelines, how-to guides, and lesson plans you can pull from on demand.',
  },
  {
    icon: Video,
    title: 'Webinars & AMAs',
    description: 'Scheduled for live attendance, then recorded for offline access by our members.',
  },
]

export default function AcademyPage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="bg-brand-blue-dark text-white py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-brand-orange font-semibold uppercase tracking-widest text-sm mb-4">
            Academy
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold mb-6 max-w-3xl">
            The central reference point for every member to upskill
          </h1>
          <p className="text-lg text-content-faint max-w-2xl leading-relaxed">
            The Stellr Academy delivers the critical STEM Skills that tomorrow&rsquo;s professionals
            need to succeed. We offer as much of it as we can, for free — sign up and start learning
            today.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={`${AUTH_URL}/sign-up`} className="btn-primary bg-brand-orange hover:bg-amber-500">
              Sign Up Free
            </a>
            <a href={`${AUTH_URL}/sign-in`} className="btn-outline-white">
              Log In
            </a>
          </div>
        </div>
      </section>

      {/* ── In-page anchor nav ────────────────────────────────────────── */}
      <nav
        aria-label="Academy sections"
        className="sticky top-20 z-30 bg-white/95 backdrop-blur border-b border-line-light"
      >
        <div className="container-max flex gap-2 sm:gap-6 px-4 sm:px-6 lg:px-8 overflow-x-auto">
          {pillars.map((p) => (
            <a
              key={p.id}
              href={`#${p.id}`}
              className="whitespace-nowrap py-4 text-sm font-semibold text-brand-grey-dark hover:text-brand-blue transition-colors"
            >
              {p.label}
            </a>
          ))}
        </div>
      </nav>

      {/* ── Intro + three pillars ─────────────────────────────────────── */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <div className="max-w-3xl mb-12">
            <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">Three ways to grow</h2>
            <p className="text-brand-grey-dark leading-relaxed">
              We&rsquo;re teaching, delivering, and upskilling STEM Skills — sometimes called
              &ldquo;soft skills,&rdquo; but that language does a disservice to how important they
              are. They&rsquo;re the critical know-how that tomorrow&rsquo;s STEM professionals will
              need to succeed.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {pillars.map((p) => {
              const Icon = p.icon
              return (
                <a
                  key={p.id}
                  href={`#${p.id}`}
                  className="bg-brand-grey-light rounded-xl p-8 flex flex-col gap-4 hover:shadow-md transition-shadow group"
                >
                  <div className="w-12 h-12 rounded-lg bg-brand-blue/10 flex items-center justify-center">
                    <Icon size={24} className="text-brand-blue" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-brand-blue-dark group-hover:text-brand-blue transition-colors">
                      {p.label}
                    </h3>
                    <p className="text-sm text-brand-grey-dark mt-2 leading-relaxed">{p.blurb}</p>
                  </div>
                  <span className="text-brand-blue text-sm font-semibold flex items-center gap-1 mt-auto">
                    Explore <ArrowRight size={14} />
                  </span>
                </a>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── What are STEM Skills? ─────────────────────────────────────── */}
      <section className="section-padding bg-brand-grey-light">
        <div className="container-max">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <p className="text-sm font-bold uppercase tracking-widest text-brand-blue mb-3">
              What Are STEM Skills?
            </p>
            <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">
              The skills traditional education leaves out
            </h2>
            <p className="text-brand-grey-dark leading-relaxed">
              STEM Skills are the human capabilities that turn technical knowledge into real impact.
              Here are five we deliberately build into everything we do — and how our activities
              deliver them.
            </p>
          </div>
          <div className="space-y-4">
            {stemSkills.map((s) => {
              const Icon = s.icon
              return (
                <div
                  key={s.skill}
                  className="bg-white rounded-xl p-6 sm:p-8 shadow-sm grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6"
                >
                  <div className="w-12 h-12 rounded-lg bg-brand-blue/10 flex items-center justify-center shrink-0">
                    <Icon size={24} className="text-brand-blue" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-brand-blue-dark mb-3">{s.skill}</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-brand-orange-alt mb-1">
                          The gap
                        </p>
                        <p className="text-sm text-brand-grey-dark leading-relaxed">{s.gap}</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-brand-blue mb-1">
                          How Stellr delivers
                        </p>
                        <p className="text-sm text-brand-grey-dark leading-relaxed">{s.stellr}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── Member-type matrix ────────────────────────────────────────── */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <div className="max-w-2xl mb-10">
            <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">Built for every member</h2>
            <p className="text-brand-grey-dark leading-relaxed">
              The goal of our Academy team is to empower all our members — not just our students, but
              also our volunteer mentors and the educators who support our activities.
            </p>
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block overflow-hidden rounded-xl border border-line">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-brand-blue-dark text-white">
                  <th className="p-4 font-semibold text-sm w-44">&nbsp;</th>
                  <th className="p-4 font-semibold text-sm">Training</th>
                  <th className="p-4 font-semibold text-sm">Mentoring</th>
                  <th className="p-4 font-semibold text-sm">Coaching</th>
                </tr>
              </thead>
              <tbody className="text-sm text-brand-grey-dark">
                {memberMatrix.map((row, i) => (
                  <tr key={row.type} className={i % 2 === 1 ? 'bg-brand-grey-light' : 'bg-white'}>
                    <th className="p-4 font-bold text-brand-blue-dark align-top">{row.type}</th>
                    <td className="p-4 align-top leading-relaxed">{row.training}</td>
                    <td className="p-4 align-top leading-relaxed">{row.mentoring}</td>
                    <td className="p-4 align-top leading-relaxed">{row.coaching}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: stacked cards */}
          <div className="md:hidden space-y-4">
            {memberMatrix.map((row) => (
              <div key={row.type} className="rounded-xl border border-line overflow-hidden">
                <p className="bg-brand-blue-dark text-white font-bold p-4">{row.type}</p>
                <dl className="divide-y divide-line-light text-sm">
                  {(['Training', 'Mentoring', 'Coaching'] as const).map((col) => (
                    <div key={col} className="p-4">
                      <dt className="font-semibold text-brand-blue mb-1">{col}</dt>
                      <dd className="text-brand-grey-dark leading-relaxed">
                        {col === 'Training' ? row.training : col === 'Mentoring' ? row.mentoring : row.coaching}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── #training ─────────────────────────────────────────────────── */}
      <section id="training" className="section-padding bg-brand-grey-light scroll-mt-36">
        <div className="container-max">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            <div>
              <p className="text-sm font-bold uppercase tracking-widest text-brand-blue mb-3">
                Training
              </p>
              <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">
                Learn on your own schedule
              </h2>
              <p className="text-brand-grey-dark leading-relaxed mb-4">
                Our training courses are designed to meet you where you are. We provide a
                custom-built Learning Management System (LMS) to access virtual training content
                anytime, anywhere.
              </p>
              <p className="text-brand-grey-dark leading-relaxed mb-4">
                If you&rsquo;re participating in one of our competitions, you&rsquo;ll find the
                training material you need ready and waiting. If you&rsquo;re an educator, you&rsquo;ll
                find supporting documentation to deliver classroom instruction as part of our
                Campaigns — plus CTE material available for you.
              </p>
              <div className="flex items-start gap-3 bg-white rounded-lg p-4 border border-line-light">
                <ShieldCheck size={20} className="text-brand-blue shrink-0 mt-0.5" />
                <p className="text-sm text-brand-grey-dark leading-relaxed">
                  We take cybersecurity seriously. All material, student details, and access
                  information is encrypted and secure.
                </p>
              </div>
            </div>
            <div className="space-y-4">
              {trainingMaterial.map((m) => {
                const Icon = m.icon
                return (
                  <div key={m.title} className="bg-white rounded-xl p-6 flex gap-4 shadow-sm">
                    <div className="w-11 h-11 rounded-lg bg-brand-blue/10 flex items-center justify-center shrink-0">
                      <Icon size={22} className="text-brand-blue" />
                    </div>
                    <div>
                      <h3 className="font-bold text-brand-blue-dark">{m.title}</h3>
                      <p className="text-sm text-brand-grey-dark mt-1 leading-relaxed">
                        {m.description}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── #mentoring ────────────────────────────────────────────────── */}
      <section id="mentoring" className="section-padding bg-white scroll-mt-36">
        <div className="container-max">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            {/* Graphic placeholder */}
            <div className="order-2 lg:order-1">
              <div className="aspect-[4/3] rounded-2xl bg-brand-grey-light border border-dashed border-line flex flex-col items-center justify-center text-center p-8">
                <Users size={40} className="text-brand-grey mb-3" />
                <p className="text-sm text-brand-grey font-medium">
                  Image placeholder — mentoring cohort session
                </p>
                <p className="text-xs text-brand-grey mt-1 italic">Reference asset to be added.</p>
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <p className="text-sm font-bold uppercase tracking-widest text-brand-blue mb-3">
                Mentoring
              </p>
              <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">
                Go deeper, in a small group
              </h2>
              <ul className="space-y-4 text-brand-grey-dark">
                <li className="flex gap-3">
                  <MessageSquare size={20} className="text-brand-blue shrink-0 mt-0.5" />
                  <span className="leading-relaxed">
                    Stellr mentoring is designed for small groups, built around a specific topic, and
                    often running over multiple weeks.
                  </span>
                </li>
                <li className="flex gap-3">
                  <InfinityIcon size={20} className="text-brand-blue shrink-0 mt-0.5" />
                  <span className="leading-relaxed">
                    When you join a mentoring cohort, you keep access to all the material indefinitely
                    — recorded calls, group chat, and shared training and support resources.
                  </span>
                </li>
                <li className="flex gap-3">
                  <Users size={20} className="text-brand-blue shrink-0 mt-0.5" />
                  <span className="leading-relaxed">
                    Our sessions are run by STEM professionals — members of our community
                    contributing their time to impart lessons and share their unique perspectives.
                  </span>
                </li>
                <li className="flex gap-3">
                  <Target size={20} className="text-brand-blue shrink-0 mt-0.5" />
                  <span className="leading-relaxed">
                    Mentoring is designed to take the skills you learn in a Stellr Competition and
                    enhance and embed them — going deeper into the STEM skills that matter most.
                  </span>
                </li>
              </ul>
              <p className="mt-6 text-sm text-brand-grey-dark">
                Mentoring is available as part of member tiers.{' '}
                <Link href="/membership" className="text-brand-blue font-semibold hover:underline">
                  Learn more about Stellr Membership
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── #coaching ─────────────────────────────────────────────────── */}
      <section id="coaching" className="section-padding bg-brand-grey-light scroll-mt-36">
        <div className="container-max">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            <div>
              <p className="text-sm font-bold uppercase tracking-widest text-brand-blue mb-3">
                Coaching
              </p>
              <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">
                One-on-one, tailored to you
              </h2>
              <p className="text-brand-grey-dark leading-relaxed mb-4">
                Stellr Coaching pairs student members with trained professional members of the Stellr
                community in dedicated one-on-one sessions. It&rsquo;s a unique opportunity to receive
                specific, tailored feedback on your career trajectory.
              </p>
              <div className="flex items-start gap-3 bg-white rounded-lg p-4 border border-line-light">
                <InfinityIcon size={20} className="text-brand-blue shrink-0 mt-0.5" />
                <p className="text-sm text-brand-grey-dark leading-relaxed">
                  All coaching material is maintained indefinitely against your Stellr member profile
                  — recorded calls, private coaching chat, and shared material.
                </p>
              </div>
            </div>
            <div className="bg-white rounded-2xl p-8 shadow-sm">
              <p className="text-sm font-semibold text-brand-blue-dark mb-4">
                What coaching can help with:
              </p>
              <ul className="space-y-3 text-sm text-brand-grey-dark">
                {[
                  'How to build professional networks',
                  'Improving specific STEM skills',
                  'School students: support and guidance on college decisions',
                  'College students: support and guidance on internships and graduate jobs',
                ].map((item) => (
                  <li key={item} className="flex gap-3">
                    <UserCheck size={18} className="text-brand-blue shrink-0 mt-0.5" />
                    <span className="leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Closing CTA ───────────────────────────────────────────────── */}
      <section className="section-padding bg-brand-blue-dark text-white text-center">
        <div className="container-max max-w-2xl">
          <h2 className="text-3xl font-bold mb-4">Start learning today</h2>
          <p className="text-content-faint leading-relaxed mb-8">
            Sign up for free to unlock the Academy and begin building the STEM Skills that set you
            apart.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a href={`${AUTH_URL}/sign-up`} className="btn-primary bg-brand-orange hover:bg-amber-500">
              Sign Up Free
            </a>
            <Link href="/membership" className="btn-outline-white">
              Explore Membership
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
