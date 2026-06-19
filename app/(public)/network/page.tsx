import type { Metadata } from 'next'
import {
  Factory,
  GraduationCap,
  Building2,
  Megaphone,
  Lightbulb,
  TrendingUp,
  School,
  Handshake,
  Users,
  Globe,
  ArrowRight,
} from 'lucide-react'
import { JoinNetworkForm } from '@/components/forms/JoinNetworkForm'

export const metadata: Metadata = {
  title: 'Network',
  description:
    'The Stellr Network is the largest STEM community of practice globally — connecting industry, universities, and corporate partners. Join us and help move the STEM flywheel.',
}

/* ── Anchor sections — Industry / University / Corporate ────────────── */
const partnerTypes = [
  {
    id: 'industry',
    icon: Factory,
    label: 'Industry Partners',
    headline: 'For STEM education & service providers',
    who: [
      'If you’re doing amazing things with STEM education, we want to hear from you.',
      'You could be running events, offering curriculum packages, or training educators — at any level, pre-K through college.',
      'You can be a for-profit, a B-Corp, or a non-profit, based anywhere on the planet (just be aware we operate in English).',
      'We have some requirements — to protect our students and stay aligned with our vision and mission — but they’re minimal.',
    ],
    benefits: [
      {
        icon: Globe,
        title: 'A Truly Global Network',
        description:
          'Increase the opportunities for students joining your events to be part of a global network — they get more value, which adds value to your offering.',
      },
      {
        icon: Megaphone,
        title: 'A Larger Voice',
        description:
          'We make a concerted effort to promote all our partners on all our platforms. There’s strength in numbers.',
      },
      {
        icon: Lightbulb,
        title: 'Idea Cross-Pollination',
        description:
          'Share ideas in a safe, collaborative environment. Imagine what you could learn from your peers by interacting with them regularly.',
      },
    ],
  },
  {
    id: 'university',
    icon: GraduationCap,
    label: 'University Partners',
    headline: 'For colleges & universities',
    who: [
      'We’ve partnered with universities and colleges across the globe to further our cradle-to-grave STEM community of practice.',
      'College is a key component of our members’ career trajectory, and we want to provide as much visibility over options at this stage as possible.',
      'Stellr has always focused on regional and rural areas — what we colloquially call “STEM underserved communities.” If you operate in a regional area (land-grant colleges in the USA are a great example), please reach out!',
    ],
    benefits: [
      {
        icon: School,
        title: 'Reach Local High Schoolers',
        description:
          'Highlight your STEM capabilities to the local high school community and the students considering their next step.',
      },
      {
        icon: Users,
        title: 'Grow Future Mentors',
        description:
          'Offer Stellr upskill material to your students — they join as mentors and develop future-ready skills.',
      },
      {
        icon: Handshake,
        title: 'Strengthen Regional Ties',
        description:
          'Build better relationships with professionals and private organizations across your region.',
      },
    ],
  },
  {
    id: 'corporate',
    icon: Building2,
    label: 'Corporate Partners',
    headline: 'For professional organizations',
    who: [
      'As a cradle-to-grave STEM community of practice, the Stellr Network relies on professional members to keep shaping the career trajectories of our members.',
      'We work with organizations of all shapes and sizes — from independent contractors to multinational corporations.',
      'In an ever-changing professional environment, we recognize that better collaboration across our entire ecosystem produces better outcomes — for our members and our partners.',
    ],
    benefits: [
      {
        icon: TrendingUp,
        title: 'Recruit From the Top',
        description:
          'Many corporate partners recruit directly from the Stellr membership. Your next intern, grad, or CEO is waiting.',
      },
      {
        icon: Handshake,
        title: 'Relationships at Every Level',
        description:
          'Build connections across high schools, colleges, industry partners, and other professional organizations.',
      },
      {
        icon: Megaphone,
        title: 'Flexible Sponsorship',
        description:
          'A number of in-kind and paid sponsorship opportunities are available — start with what works for you.',
      },
    ],
  },
]

export default function NetworkPage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="bg-brand-blue-dark text-white py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-brand-orange font-semibold uppercase tracking-widest text-sm mb-4">
            Network
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold mb-6 max-w-3xl">
            The largest STEM community of practice, globally
          </h1>
          <p className="text-lg text-content-faint max-w-2xl leading-relaxed">
            The Stellr Network is a premier community — representing the best of STEM education and
            service providers. Our strength lies in the breadth and variety of our network. Join us
            today and start helping move the STEM flywheel.
          </p>
          <div className="mt-8">
            <a href="#join" className="btn-primary bg-brand-orange hover:bg-amber-500">
              Join The Network
            </a>
          </div>
        </div>
      </section>

      {/* ── In-page anchor nav ────────────────────────────────────────── */}
      <nav
        aria-label="Network sections"
        className="sticky top-20 z-30 bg-white/95 backdrop-blur border-b border-line-light"
      >
        <div className="container-max flex gap-2 sm:gap-6 px-4 sm:px-6 lg:px-8 overflow-x-auto">
          {partnerTypes.map((p) => (
            <a
              key={p.id}
              href={`#${p.id}`}
              className="whitespace-nowrap py-4 text-sm font-semibold text-brand-grey-dark hover:text-brand-blue transition-colors"
            >
              {p.label}
            </a>
          ))}
          <a
            href="#join"
            className="whitespace-nowrap py-4 text-sm font-semibold text-brand-blue hover:text-brand-blue-dark transition-colors"
          >
            Join
          </a>
        </div>
      </nav>

      {/* ── Intro: three partner types ────────────────────────────────── */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">
              One network, three ways to belong
            </h2>
            <p className="text-brand-grey-dark leading-relaxed">
              Wherever you sit in the STEM ecosystem, there&rsquo;s a place for you in the Stellr
              Network.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {partnerTypes.map((p) => {
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
                    <p className="text-sm text-brand-grey-dark mt-2 leading-relaxed">{p.headline}</p>
                  </div>
                  <span className="text-brand-blue text-sm font-semibold flex items-center gap-1 mt-auto">
                    Learn more <ArrowRight size={14} />
                  </span>
                </a>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── Partner-type detail sections ──────────────────────────────── */}
      {partnerTypes.map((p, idx) => {
        const Icon = p.icon
        const tinted = idx % 2 === 1
        return (
          <section
            key={p.id}
            id={p.id}
            className={`section-padding scroll-mt-36 ${tinted ? 'bg-brand-grey-light' : 'bg-white'}`}
          >
            <div className="container-max">
              {/* Who */}
              <div className="max-w-3xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-11 h-11 rounded-lg bg-brand-blue/10 flex items-center justify-center">
                    <Icon size={22} className="text-brand-blue" />
                  </div>
                  <p className="text-sm font-bold uppercase tracking-widest text-brand-blue">
                    {p.label}
                  </p>
                </div>
                <h2 className="text-3xl font-bold text-brand-blue-dark mb-6">{p.headline}</h2>
                <div className="space-y-4 text-brand-grey-dark leading-relaxed">
                  {p.who.map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>
              </div>

              {/* Benefits */}
              <div className="mt-10">
                <p className="text-sm font-bold uppercase tracking-wide text-brand-orange-alt mb-4">
                  Why join
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {p.benefits.map((b) => {
                    const BIcon = b.icon
                    return (
                      <div
                        key={b.title}
                        className={`rounded-xl p-6 shadow-sm ${tinted ? 'bg-white' : 'bg-brand-grey-light'}`}
                      >
                        <div className="w-11 h-11 rounded-lg bg-brand-blue/10 flex items-center justify-center mb-4">
                          <BIcon size={22} className="text-brand-blue" />
                        </div>
                        <h3 className="font-bold text-brand-blue-dark mb-2">{b.title}</h3>
                        <p className="text-sm text-brand-grey-dark leading-relaxed">
                          {b.description}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </section>
        )
      })}

      {/* ── Partner logos placeholder ─────────────────────────────────── */}
      <section className="section-padding bg-white">
        <div className="container-max text-center">
          <p className="text-sm font-bold uppercase tracking-widest text-brand-grey mb-8">
            Some of the organizations in our network
          </p>
          <div className="flex flex-wrap justify-center items-center gap-10 opacity-60">
            {/* Placeholder logos — replace with real partner logos */}
            {['Partner 1', 'Partner 2', 'Partner 3', 'Partner 4', 'Partner 5'].map((p) => (
              <div
                key={p}
                className="w-32 h-12 bg-brand-grey-light border border-dashed border-line rounded flex items-center justify-center text-xs text-brand-grey"
              >
                {p}
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-brand-grey italic">Partner logos to be added.</p>
        </div>
      </section>

      {/* ── #join — Join The Stellr Network form ──────────────────────── */}
      <section id="join" className="section-padding bg-brand-grey-light scroll-mt-36">
        <div className="container-max grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
          <div className="lg:sticky lg:top-36">
            <p className="text-sm font-bold uppercase tracking-widest text-brand-blue mb-3">
              Get Involved
            </p>
            <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">Join The Stellr Network</h2>
            <p className="text-brand-grey-dark leading-relaxed mb-6">
              Tell us a little about yourself and your organization. We&rsquo;ll review your details
              and get in touch to find the right way for you to join our global STEM community of
              practice.
            </p>
            <ul className="space-y-3 text-sm text-brand-grey-dark">
              {[
                'Minimal requirements — built to protect students and align on mission',
                'Open to for-profits, B-Corps, and non-profits, anywhere in the world',
                'Promotion across all Stellr platforms once you’re aboard',
              ].map((point) => (
                <li key={point} className="flex gap-3">
                  <Handshake size={18} className="text-brand-blue shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{point}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm">
            <JoinNetworkForm />
          </div>
        </div>
      </section>
    </>
  )
}
