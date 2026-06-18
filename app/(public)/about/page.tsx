import type { Metadata } from 'next'
import Link from 'next/link'
import { Linkedin, Award, Lightbulb, Eye, Network as NetworkIcon } from 'lucide-react'

export const metadata: Metadata = {
  title: 'About Stellr',
  description:
    'Stellr is building a self-reinforcing global network of STEM professionals — from high school through retirement. Read our mission, vision, values, and meet the team.',
}

/* ── The Challenge — four facets from the doc ──────────────────────── */
const challenge = [
  {
    icon: Award,
    title: 'STEM Power Skills',
    description:
      'The so-called “soft skills” aren’t directly taught, even though they’re foundational to professional success.',
  },
  {
    icon: NetworkIcon,
    title: 'Career Trajectories',
    description:
      'Society nudges students toward a defined career (narrow) or a career path (broad) — rarely with the context to choose well.',
  },
  {
    icon: Eye,
    title: 'Career Visibility',
    description:
      'We ask high schoolers to make college decisions based on future careers without giving them visibility over those careers. It’s a three-phase journey — high school → college → professional — with opacity between each phase.',
  },
  {
    icon: Lightbulb,
    title: 'Career Networking',
    description:
      'Existing professional networks don’t span the whole cradle-to-grave career, short-changing young professionals and preventing senior experts from imparting knowledge.',
  },
]

/* ── Values from the doc ───────────────────────────────────────────── */
const values = [
  {
    title: 'Members First, Last, and Always',
    description:
      'Everything we do is oriented around providing educational benefits for our members — regardless of age, membership tier, or any other metric. You trust us as a Member, and we respect it.',
  },
  {
    title: 'Careers Start Now',
    description:
      'Your career doesn’t start when you graduate — just as you don’t stop learning because you graduated. So what if you’re at school? Your career has already begun.',
  },
  {
    title: 'Learning First, Tools Second',
    description:
      'STEM professionals must understand how tools work before they can deploy them. We will always prioritize learning foundational skills.',
  },
  {
    title: 'Respectfully Inclusive',
    description:
      'We want our Community to reflect modern society, and strive to include everyone. In return, we expect mutual respect — to themselves, to other Members and Partners, and to Stellr.',
  },
]

/* ── Team & Advisory Board from the doc ────────────────────────────── */
const founder = {
  name: 'David Shaw',
  role: 'Founder & Chief Inspiration Officer (CIO)',
  linkedIn: 'https://www.linkedin.com/in/davidmichaelshaw87/',
}

const advisoryBoard = [
  { name: 'Jim Christensen', linkedIn: 'https://www.linkedin.com/in/jim-christensen-7b3708122/' },
  { name: 'Rick Griffiths', linkedIn: 'https://www.linkedin.com/in/richard-a-griffith-41327534/' },
  {
    name: 'Bill Allen',
    linkedIn: 'https://www.linkedin.com/in/bill-allen-b7006b114/',
    bio: 'Bill remains a believer in and advocate for ISD competitions based on the positive results he has seen with former students continuing their studies and careers in engineering and STEM. By attending these competitions, students from the Midwest truly begin to see a pathway to the careers they are interested in, and begin to understand their dreams can become reality.',
  },
  { name: 'Janet Ivey', linkedIn: 'https://www.linkedin.com/in/janetsplanet/' },
]

function Avatar({ name, size = 'lg' }: { name: string; size?: 'lg' | 'sm' }) {
  const dim = size === 'lg' ? 'w-32 h-32 text-3xl' : 'w-20 h-20 text-xl'
  return (
    <div
      className={`${dim} mx-auto rounded-full bg-brand-grey-light flex items-center justify-center font-bold text-brand-grey-mid`}
    >
      {name.charAt(0)}
    </div>
  )
}

export default function AboutPage() {
  return (
    <>
      {/* ── Page Header ──────────────────────────────────────────────── */}
      <section className="bg-brand-blue-dark text-white py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <p className="text-brand-orange font-semibold uppercase tracking-widest text-sm mb-4">
            About
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold mb-4">
            We connect students to the future they&apos;re studying for.
          </h1>
        </div>
      </section>

      {/* ── In-page anchor nav ────────────────────────────────────────── */}
      <nav
        aria-label="About sections"
        className="sticky top-20 z-30 bg-white/95 backdrop-blur border-b border-gray-100"
      >
        <div className="container-max flex gap-2 sm:gap-6 px-4 sm:px-6 lg:px-8 overflow-x-auto">
          {[
            { id: 'mission', label: 'Mission' },
            { id: 'team', label: 'Our Team' },
          ].map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="whitespace-nowrap py-4 text-sm font-semibold text-brand-grey-dark hover:text-brand-blue transition-colors"
            >
              {s.label}
            </a>
          ))}
          <Link
            href="/impact"
            className="whitespace-nowrap py-4 text-sm font-semibold text-brand-grey-dark hover:text-brand-blue transition-colors"
          >
            Impact
          </Link>
        </div>
      </nav>

      {/* ── #mission ─────────────────────────────────────────────────── */}
      <section id="mission" className="section-padding bg-white scroll-mt-36">
        <div className="container-max max-w-5xl">
          <p className="text-sm font-bold uppercase tracking-widest text-brand-blue mb-3">
            Our Mission
          </p>

          {/* The Challenge */}
          <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">The Challenge</h2>
          <p className="text-brand-grey-dark leading-relaxed max-w-3xl mb-8">
            To solve the challenges of today and tomorrow, society needs not just more STEM
            professionals, but professionals who are better positioned to address them. The challenge
            breaks down into four parts:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-16">
            {challenge.map((c) => {
              const Icon = c.icon
              return (
                <div key={c.title} className="bg-brand-grey-light rounded-xl p-6">
                  <div className="w-12 h-12 rounded-lg bg-brand-blue/10 flex items-center justify-center mb-4">
                    <Icon size={24} className="text-brand-blue" />
                  </div>
                  <h3 className="font-bold text-brand-blue-dark mb-2">{c.title}</h3>
                  <p className="text-sm text-brand-grey-dark leading-relaxed">{c.description}</p>
                </div>
              )
            })}
          </div>

          {/* Our Goal */}
          <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">Our Goal</h2>
          <p className="text-brand-grey-dark leading-relaxed max-w-3xl mb-6">
            To build a self-reinforcing global network of STEM professionals — starting at high school
            and progressing through to retirement — to:
          </p>
          <ol className="space-y-4 mb-16 max-w-3xl">
            {[
              'Help set young professionals on STEM career trajectories.',
              'Impart soft skills to deliver more proficient professionals into industry.',
              'Facilitate knowledge transfer to solve bigger problems faster.',
            ].map((goal, i) => (
              <li key={goal} className="flex gap-4">
                <span className="shrink-0 w-8 h-8 rounded-full bg-brand-blue text-white font-bold flex items-center justify-center text-sm">
                  {i + 1}
                </span>
                <span className="text-brand-grey-dark leading-relaxed pt-1">{goal}</span>
              </li>
            ))}
          </ol>

          {/* Our Vision */}
          <div className="bg-brand-blue-dark text-white rounded-2xl p-8 sm:p-10 mb-16">
            <p className="text-sm font-bold uppercase tracking-widest text-brand-orange mb-3">
              Our Vision
            </p>
            <h2 className="text-2xl sm:text-3xl font-bold mb-6">The Engineering Education Network</h2>
            <ul className="space-y-3 text-gray-200 leading-relaxed">
              {[
                'Develop careers through industry simulation competitions and events.',
                'Provide future leaders the skills and tools they’ll need to solve tomorrow’s problems.',
                'Build a global support and collaboration network connecting students, professionals, and retired experts.',
                'We are the “Model UN for Engineers.”',
                'Our members learn the soft skills, and develop the relationships, that won’t be replaced by AI — every activity is oriented at a “High School Engineering MBA.”',
                'We will positively impact 100,000 students over the next 10 years.',
              ].map((point) => (
                <li key={point} className="flex gap-3">
                  <span className="text-brand-orange font-bold shrink-0">›</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Values */}
          <h2 className="text-3xl font-bold text-brand-blue-dark mb-8">Our Values</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {values.map((v) => (
              <div key={v.title} className="border border-gray-200 rounded-xl p-6">
                <h3 className="font-bold text-brand-blue-dark mb-2">{v.title}</h3>
                <p className="text-sm text-brand-grey-dark leading-relaxed">{v.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── #team ────────────────────────────────────────────────────── */}
      <section id="team" className="section-padding bg-brand-grey-light scroll-mt-36">
        <div className="container-max">
          <p className="text-sm font-bold uppercase tracking-widest text-brand-blue mb-3">Our Team</p>
          <h2 className="text-3xl font-bold text-brand-blue-dark mb-10">The people behind Stellr</h2>

          {/* Founder */}
          <div className="bg-white rounded-2xl p-8 shadow-sm max-w-md mb-12">
            <Avatar name={founder.name} />
            <div className="text-center mt-4">
              <h3 className="font-bold text-brand-blue-dark text-lg">{founder.name}</h3>
              <p className="text-sm text-brand-grey-mid mt-0.5">{founder.role}</p>
              <a
                href={founder.linkedIn}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${founder.name} on LinkedIn`}
                className="inline-flex items-center gap-1 mt-3 text-brand-blue hover:text-blue-700 transition-colors text-sm"
              >
                <Linkedin size={16} /> LinkedIn
              </a>
            </div>
          </div>

          {/* Advisory Board */}
          <h3 className="text-xl font-bold text-brand-blue-dark mb-6">Advisory Board</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {advisoryBoard.map((member) => (
              <div key={member.name} className="bg-white rounded-xl p-6 text-center shadow-sm">
                <Avatar name={member.name} size="sm" />
                <h4 className="font-bold text-brand-blue-dark mt-4">{member.name}</h4>
                {member.bio && (
                  <p className="text-xs text-brand-grey-dark mt-2 leading-relaxed text-left">
                    {member.bio}
                  </p>
                )}
                <a
                  href={member.linkedIn}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${member.name} on LinkedIn`}
                  className="inline-flex items-center gap-1 mt-3 text-brand-blue hover:text-blue-700 transition-colors text-sm"
                >
                  <Linkedin size={16} /> LinkedIn
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Closing CTA ──────────────────────────────────────────────── */}
      <section className="section-padding bg-white text-center">
        <div className="container-max max-w-2xl">
          <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">See the difference we make</h2>
          <p className="text-brand-grey-dark leading-relaxed mb-8">
            Explore the impact Stellr has on student career trajectories — and where we stand on AI in
            education.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/impact" className="btn-primary">
              Our Impact
            </Link>
            <Link href="/contact" className="btn-outline">
              Contact Us
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
