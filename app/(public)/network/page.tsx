import type { Metadata } from 'next'
import { Fragment } from 'react'
import Link from 'next/link'
import { ArrowRight, Check } from 'lucide-react'
import { Event, Certificate, Team } from '@stellr/icons'
import { Hero, Eyebrow, Button } from '@stellr/web-ui'
import { JoinNetworkForm } from '@/components/forms/JoinNetworkForm'
import { PageMedia } from '@/components/sections/PageMedia'
import { PHOTOS, COMPETITION } from '@/lib/media-manifest'

export const metadata: Metadata = {
  title: 'Network',
  description:
    'The Stellr Network is the providers, universities, and employers who make premier STEM education happen — and who grow alongside it. Join industry, university, and corporate partners.',
}

/* ── Three ways to partner — pathway cards ─────────────────────────── */
const pathways = [
  {
    id: 'industry',
    Icon: Event,
    tileBg: 'bg-pathway-amber-bg',
    iconColor: 'text-pathway-amber',
    accentText: 'text-brand-gold-ink',
    hoverBorder: 'hover:border-pathway-amber',
    eyebrow: 'Industry Partners',
    name: 'STEM Education Providers',
    description: 'You run events, build curriculum, or train educators — pre-K through college.',
  },
  {
    id: 'university',
    Icon: Certificate,
    tileBg: 'bg-enviro-green-bg',
    iconColor: 'text-enviro-green',
    accentText: 'text-enviro-green-text',
    hoverBorder: 'hover:border-enviro-green',
    eyebrow: 'University Partners',
    name: 'Colleges & universities',
    description:
      'You want to reach STEM-minded high school students and get them achieving at your institution.',
  },
  {
    id: 'corporate',
    Icon: Team,
    tileBg: 'bg-space-violet-bg',
    iconColor: 'text-space-violet',
    accentText: 'text-space-violet-text',
    hoverBorder: 'hover:border-space-violet',
    eyebrow: 'Corporate Partners',
    name: 'Employers & professional bodies',
    description:
      'You need STEM talent, and likely want to give back — regardless of whether you are a solo consultancy or a multinational.',
  },
]

/* ── Detail sections — Industry / University / Corporate ────────────── */
type Detail = {
  id: string
  tinted: boolean
  eyebrow: string
  eyebrowColor: string
  checkColor: string
  headline: string
  who: React.ReactNode[]
  whyLabel: string
  benefits: { title: string; description: string }[]
}

const details: Detail[] = [
  {
    id: 'industry',
    tinted: true,
    eyebrow: 'Industry Partners',
    eyebrowColor: 'text-brand-gold-ink',
    checkColor: 'text-pathway-amber',
    headline: 'For STEM education & service providers',
    who: [
      "If you're doing great things with STEM education, we want to hear from you — whether you run events, sell curriculum packages, or train educators, at any level from pre-K to college.",
      'For-profit, B-Corp, or non-profit; based anywhere on the planet (note we operate in English). We ask for a few things to keep students safe and stay true to our mission — but our bar is set to inclusive.',
    ],
    whyLabel: 'Why join',
    benefits: [
      {
        title: 'A truly global audience',
        description:
          'Students at your events automatically join a worldwide community, so your programs are now even more valuable.',
      },
      {
        title: 'Be recognized as a premier STEM provider',
        description:
          'Membership signals quality to the families and educators who choose you, and we promote every partner across all our channels.',
      },
      {
        title: 'Ideas worth sharing',
        description:
          'Swap what works with peers who do what you do, in a safe, collaborative space purpose-built for it.',
      },
    ],
  },
  {
    id: 'university',
    tinted: false,
    eyebrow: 'University Partners',
    eyebrowColor: 'text-enviro-green-text',
    checkColor: 'text-enviro-green',
    headline: 'For colleges & universities',
    who: [
      'College is a pivotal step in a student’s career. We partner with universities and colleges worldwide so our members can see their options clearly — and choose the right next move. We can help you grow your high school recruitment pipeline, showcase your engineering programs, and connect future students with your existing engineering students.',
      <>
        If you are in a regional or rural area — what we colloquially refer to as{' '}
        <em>&lsquo;STEM-underserved communities&rsquo;</em> — we want to hear from you.
      </>,
    ],
    whyLabel: 'Why partner',
    benefits: [
      {
        title: 'Reach local high-schoolers',
        description:
          "Show nearby students what you offer, right as they're weighing up their next step.",
      },
      {
        title: 'Grow future mentors',
        description:
          'Offer Stellr training to your existing students — they join as mentors and build future-ready skills.',
      },
      {
        title: 'Stronger regional ties',
        description: 'Build lasting links with employers and organizations across your region.',
      },
    ],
  },
  {
    id: 'corporate',
    tinted: true,
    eyebrow: 'Corporate Partners',
    eyebrowColor: 'text-space-violet-text',
    checkColor: 'text-space-violet',
    headline: 'For professional organisations',
    who: [
      'Stellr exists to promote STEM careers, and get future STEM professionals career ready. Our Professional members are critical to supporting our student members. We work with organizations of every size, from independent contractors to multinationals.',
      'In a fast-changing professional world, better collaboration across the whole ecosystem produces better outcomes — for our members and for you.',
    ],
    whyLabel: 'Why partner',
    benefits: [
      {
        title: 'Recruit early',
        description:
          'Many partners identify future talent straight from the Stellr Community. Your next intern, graduate, or future engineering lead is waiting.',
      },
      {
        title: 'Connect at every level',
        description: 'Build relationships across high schools, colleges, providers, and fellow employers.',
      },
      {
        title: 'Sponsor your way',
        description: 'In-kind and paid options that start wherever makes sense for you.',
      },
    ],
  },
]

const joinBullets = [
  'Expect a more formal review — built to protect students and ensure mission alignment.',
  'Open to for-profits, B-Corps, and non-profits, anywhere in the world.',
  "Promotion across every Stellr platform once you're aboard.",
]

export default function NetworkPage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <Hero
        breadcrumb="The Stellr Network"
        title="Great STEM education takes more than a classroom."
        lead="Stellr gives high-school and college students premier events, hands-on mentoring, and real career pathways. The Network is the providers, universities, and employers who make that happen — and who grow alongside it."
      >
        <div className="flex flex-wrap gap-3.5 mt-8">
          <Button href="#join" variant="primary">
            Join the Network
          </Button>
          <Button href="#three" variant="outlineWhite">
            See how partnering works <ArrowRight size={16} />
          </Button>
        </div>
        <div className="flex flex-wrap gap-x-7 gap-y-2.5 mt-11 text-sm text-hero-lead/80">
          {['Education Service Providers', 'Universities & Colleges', 'Employers & Professional Bodies'].map(
            (chip) => (
              <span key={chip} className="inline-flex items-center gap-1.5">
                <span className="text-star-gold">✦</span> {chip}
              </span>
            ),
          )}
        </div>
      </Hero>

      {/* ── Three ways to partner ─────────────────────────────────────── */}
      <section id="three" className="section-padding bg-white scroll-mt-24">
        <div className="container-max">
          <div className="max-w-2xl">
            <Eyebrow>Better together</Eyebrow>
            <h2 className="text-3xl font-bold text-ink mt-3 leading-tight">
              One network, three ways to partner
            </h2>
            <p className="text-lg text-content-secondary mt-4 leading-relaxed">
              Wherever you sit in the STEM world — running programs, teaching, or hiring — there&rsquo;s a
              clear reason for you to join our Network.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
            {pathways.map(({ id, Icon, tileBg, iconColor, accentText, hoverBorder, eyebrow, name, description }) => (
              <a
                key={id}
                href={`#${id}`}
                className={`group flex flex-col gap-3.5 bg-white border border-line rounded-ds-card p-7 shadow-card-lift transition-all hover:-translate-y-0.5 ${hoverBorder}`}
              >
                <span className={`w-12 h-12 rounded-xl flex items-center justify-center ${tileBg} ${iconColor}`}>
                  <Icon size={24} />
                </span>
                <p className={`text-xs font-subheading font-semibold uppercase tracking-[0.1em] ${accentText}`}>
                  {eyebrow}
                </p>
                <h3 className="text-lg font-bold text-ink">{name}</h3>
                <p className="text-sm text-content-secondary leading-relaxed">{description}</p>
                <span className="mt-auto inline-flex items-center gap-1 text-sm font-semibold text-primary">
                  Learn more <ArrowRight size={14} />
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ── Detail sections ───────────────────────────────────────────── */}
      {details.map((d) => (
        <Fragment key={d.id}>
        <section
          id={d.id}
          className={`section-padding scroll-mt-24 ${d.tinted ? 'bg-surface border-t border-line-light' : 'bg-white'}`}
        >
          <div className="container-max grid grid-cols-1 lg:grid-cols-2 gap-14 items-start">
            {/* Left — who it's for */}
            <div>
              <Eyebrow className={d.eyebrowColor}>{d.eyebrow}</Eyebrow>
              <h2 className="text-3xl font-bold text-ink mt-3 leading-tight">{d.headline}</h2>
              <div className="mt-5 space-y-4 text-base text-content-body leading-relaxed">
                {d.who.map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
              {/* Prospectus download — inactive until the document is ready. When
                  live, wire to <AssetGate> (name/email → HubSpot subscriber). */}
              {d.id === 'corporate' && (
                <div className="mt-7">
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    title="Coming soon"
                    className="inline-flex items-center gap-2 rounded-[10px] border border-line bg-white px-6 py-3.5 font-display text-[15px] font-semibold text-content-faint cursor-not-allowed opacity-70"
                  >
                    Download Our Prospectus
                  </button>
                  <p className="mt-2 text-[13px] text-content-faint">Coming soon — our partner prospectus is on its way.</p>
                </div>
              )}
            </div>

            {/* Right — why join */}
            <div>
              <p className="text-xs font-subheading font-semibold uppercase tracking-[0.12em] text-content-faint">
                {d.whyLabel}
              </p>
              <div className="mt-1">
                {d.benefits.map((b) => (
                  <div key={b.title} className="flex gap-3.5 border-t border-line py-5">
                    <Check size={20} strokeWidth={2.2} className={`shrink-0 mt-0.5 ${d.checkColor}`} />
                    <div>
                      <p className="font-subheading font-semibold text-ink text-[17px]">{b.title}</p>
                      <p className="text-content-secondary mt-1 leading-relaxed">{b.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Photos from the floor — between Industry and University partners */}
        {d.id === 'industry' && (
          <PageMedia
            eyebrow="See it for yourself"
            heading="Inside the Stellr community"
            intro="Where your partnership lands — students at Stellr events across the US."
            photos={[PHOTOS['events-1'], PHOTOS['events-2'], PHOTOS['events-3'], PHOTOS['events-4'], PHOTOS['events-5']]}
            photoHeading="On the competition floor"
            background="white"
          />
        )}

        {/* Subscriber resources — between University and Corporate partners */}
        {d.id === 'university' && (
          <PageMedia
            eyebrow="Subscriber resources"
            heading="See the work up close"
            intro="Real student deliverables from past competitions — subscribe and we’ll email you the full PDF."
            competition={[COMPETITION['south-west-2022-student-presentation'], COMPETITION['south-west-2025-rfp']]}
            background="surface"
          />
        )}
        </Fragment>
      ))}

      {/* Partner logo wall ("In good company") hidden until we have written
          permission from each partner to display their logo. */}

      {/* ── Join form ─────────────────────────────────────────────────── */}
      <section
        id="join"
        className="relative overflow-hidden bg-midnight text-white py-20 px-4 sm:px-6 lg:px-8 scroll-mt-24 bg-[radial-gradient(120%_130%_at_15%_0%,#1B2550_0%,#0E1330_55%,#09102C_100%)]"
      >
        <div className="container-max grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-14 items-start">
          {/* Left — pitch */}
          <div>
            <Eyebrow className="text-hero-dim">Get involved</Eyebrow>
            <h2 className="text-3xl font-bold mt-3 leading-tight">Join the Stellr Network</h2>
            <p className="text-hero-lead mt-4 leading-relaxed">
              Tell us a little about you and your organization. We&rsquo;ll review your details and get in
              touch to find the right way for you to join.
            </p>
            <ul className="mt-7 space-y-4">
              {joinBullets.map((point) => (
                <li key={point} className="flex gap-3 text-[15px] text-hero-lead">
                  <Check size={18} strokeWidth={2.4} className="shrink-0 mt-0.5 text-[#5CE0B0]" />
                  <span className="leading-relaxed">{point}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Right — form card */}
          <div className="bg-white rounded-panel p-6 sm:p-8 shadow-float">
            <JoinNetworkForm />
          </div>
        </div>
      </section>
    </>
  )
}
