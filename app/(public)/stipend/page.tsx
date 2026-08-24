import type { Metadata } from 'next'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { Document, Team } from '@stellr/icons'
import { Button, Eyebrow, InfoPill } from '@stellr/web-ui'
import TeacherStipendForm from '@/components/forms/TeacherStipendForm'
import { PullQuoteWall } from '@/components/sections/PullQuoteWall'
import { VideoTestimonial } from '@/components/sections/VideoTestimonial'
import { VIDEOS, QUOTES } from '@/lib/media-manifest'
import { getRegistrationPrefill } from '@/lib/registration-prefill'
import { buildFaqJsonLd } from '@/lib/structured-data'
import { getTierPriceMap, formatTierPrice } from '@/lib/tier-pricing'
import {
  STIPEND_AMOUNTS,
  STIPEND_PAYMENT_DATE,
  STIPEND_PD_HOURS,
  STIPEND_PLACES,
  STIPEND_PROGRAM_YEAR,
  STIPEND_THRESHOLDS,
  stipendAmount,
} from '@/lib/stipend'
import { BENEFITS, EARNINGS, FAQS, HOW_IT_WORKS } from './content'

export const metadata: Metadata = {
  alternates: { canonical: '/stipend' },
  title: 'Teacher Stipend',
  description: `Stellr pays US high school teachers to bring a team to a live Challenge or run a Campaign at their own school — up to ${stipendAmount(STIPEND_AMOUNTS.annualMaximum)} a year, plus documented PD contact hours and free Catalyst membership. ${STIPEND_PLACES} places for ${STIPEND_PROGRAM_YEAR}.`,
}

const ONE_PAGER = '/files/Stellr-Teacher-Stipend-Overview.pdf'

export default async function StipendPage() {
  // Tier prices are resolved live from Stripe — a marketing surface must never
  // hard-code one (see lib/tier-pricing.ts). If Catalyst can't be resolved we
  // drop the figure rather than print an invented number.
  // A signed-in teacher shouldn't retype what Stellr already holds. Null for a
  // signed-out visitor, and never allowed to fail the page.
  const [tierPrices, prefill] = await Promise.all([
    getTierPriceMap(),
    getRegistrationPrefill().catch(() => null),
  ])
  const catalyst = tierPrices['Catalyst']
  const catalystValue = catalyst && !catalyst.isFree ? ` — a ${formatTierPrice(catalyst)} value` : ''

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(buildFaqJsonLd(FAQS.map((f) => ({ q: f.q, text: f.text })))),
        }}
      />

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-midnight text-white pt-16 pb-[70px] px-4 sm:px-6 lg:px-8 bg-[radial-gradient(120%_130%_at_85%_-10%,#28306B_0%,#141A3D_45%,#0E1330_100%)]">
        <div className="container-max">
          <Eyebrow className="text-hero-dim">Educate · Teacher Stipend</Eyebrow>
          <h1 className="mt-4 text-4xl sm:text-5xl font-bold tracking-display leading-[1.05] max-w-[760px]">
            We support the teachers who want to offer Stellr activities to their students
          </h1>
          <p className="mt-5 text-lg text-hero-lead leading-relaxed max-w-[640px]">
            Taking a team to a live Challenge or running a Campaign at your school takes real
            time — recruiting students, coordinating logistics, and following through afterward.
            The Teacher Stipend
            recognizes that work. You can earn as you participate, supporting both your students
            and yourself.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <InfoPill>
              Up to {stipendAmount(STIPEND_AMOUNTS.annualMaximum)} a year
            </InfoPill>
            <InfoPill>{STIPEND_PLACES} places for {STIPEND_PROGRAM_YEAR}</InfoPill>
            <InfoPill>US high school teachers</InfoPill>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button href="#apply">Apply for the stipend</Button>
            <Button href={ONE_PAGER} variant="outlineWhite" target="_blank" rel="noopener">
              <Document size={18} /> Download the one-pager
            </Button>
          </div>
        </div>
      </section>

      {/* ── What you can earn ─────────────────────────────────────────── */}
      <section className="bg-surface section-padding">
        <div className="container-max max-w-content">
          <Eyebrow>What you can earn</Eyebrow>
          <h2 className="mt-3 text-3xl font-bold text-ink leading-tight">
            Paid for what you actually do
          </h2>

          <div className="mt-6 overflow-x-auto rounded-panel border border-line bg-white shadow-card-lift">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Teacher Stipend earnings by activity for {STIPEND_PROGRAM_YEAR}
              </caption>
              <thead>
                <tr className="border-b border-line text-left">
                  <th scope="col" className="p-4 font-display font-semibold text-ink">
                    What you do
                  </th>
                  <th scope="col" className="p-4 font-display font-semibold text-ink w-36">
                    What you earn
                  </th>
                </tr>
              </thead>
              <tbody className="text-content-secondary">
                {EARNINGS.map((row) => (
                  <tr key={row.what} className="border-b border-line-light">
                    <td className="p-4">
                      <span className="font-semibold text-ink">{row.what}</span> — {row.detail}
                    </td>
                    <td className="p-4 font-semibold text-ink whitespace-nowrap">
                      {stipendAmount(row.amount)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-primary-soft">
                  <td className="p-4 font-bold text-ink">Maximum per year</td>
                  <td className="p-4 font-bold text-ink whitespace-nowrap">
                    {stipendAmount(STIPEND_AMOUNTS.annualMaximum)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-sm text-content-muted">
            You can do one Challenge and one Campaign each year. Payment comes as a single check,
            posted {STIPEND_PAYMENT_DATE}.
          </p>
        </div>
      </section>

      {/* ── What else you get · Who it's for ──────────────────────────── */}
      <section className="bg-white section-padding">
        <div className="container-max max-w-content grid gap-12 lg:grid-cols-2 items-start">
          <div>
            <Eyebrow>What else you get</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold text-ink leading-tight">
              More than the money
            </h2>
            {/* One card, six rows — six copies of the same icon would be
                decoration, not information (CLAUDE.md: earn every element). */}
            <ul className="mt-6 bg-white border border-line rounded-ds-card divide-y divide-line-light">
              {BENEFITS.map(({ title, body }, i) => (
                <li key={title} className="flex gap-3 px-[22px] py-4">
                  <Check size={17} className="shrink-0 text-primary mt-0.5" aria-hidden="true" />
                  <p className="text-sm text-content-secondary leading-relaxed">
                    <span className="font-semibold text-ink">{title}</span>{' '}
                    {i === 1 ? `${body.replace(/\.$/, '')}${catalystValue}.` : body}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <Eyebrow>Who it&rsquo;s for</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold text-ink leading-tight">
              Built to fit around teaching
            </h2>
            <div className="mt-6 flex gap-4 bg-white border border-line rounded-ds-card px-[22px] py-5">
              <span className="shrink-0 w-10 h-10 rounded-[10px] flex items-center justify-center bg-enviro-green-bg text-enviro-green">
                <Team size={22} />
              </span>
              <div className="text-sm text-content-secondary leading-relaxed">
                <p>
                  You&rsquo;re a <span className="font-semibold text-ink">high school teacher</span>,
                  and during the school year you can bring students to a live Challenge, supervise a
                  Campaign at your school, or both. Open to U.S. high school teachers only.
                </p>
                <p className="mt-3">
                  {`Expect to spend somewhere between ${STIPEND_PD_HOURS} hours across the year.`}{' '}
                  It&rsquo;s built to fit around teaching, not to sit on top of it.
                </p>
              </div>
            </div>

            <h3 className="mt-9 font-display text-lg font-semibold text-ink">How it works</h3>
            <ol className="mt-4 flex flex-col gap-4">
              {HOW_IT_WORKS.map((step, i) => (
                <li key={step.title} className="flex gap-4">
                  <span className="shrink-0 w-7 h-7 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <p className="text-sm text-content-secondary leading-relaxed">
                    <span className="font-semibold text-ink">{step.title}</span> {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ── Educators who have run it ─────────────────────────────────── */}
      <section className="bg-surface section-padding">
        <div className="container-max max-w-content">
          <Eyebrow>From the classroom</Eyebrow>
          <h2 className="mt-3 text-3xl font-bold text-ink leading-tight">
            Teachers who have already run it
          </h2>

          <figure className="mt-8 max-w-2xl">
            <VideoTestimonial
              src={VIDEOS['testimonial-jeremiah-dibley'].src}
              poster={VIDEOS['testimonial-jeremiah-dibley'].poster}
              captionsSrc={VIDEOS['testimonial-jeremiah-dibley'].captions}
              title={VIDEOS['testimonial-jeremiah-dibley'].title}
            />
            <figcaption className="mt-3 text-sm font-semibold text-ink">
              {VIDEOS['testimonial-jeremiah-dibley'].title}
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ── Common questions ──────────────────────────────────────────── */}
      <section className="bg-white section-padding">
        <div className="container-max max-w-content">
          <Eyebrow>Common questions</Eyebrow>
          <h2 className="mt-3 text-3xl font-bold text-ink leading-tight">Before you apply</h2>

          <div className="mt-6 grid gap-8 lg:grid-cols-[1.35fr_0.85fr] items-start">
            <div className="divide-y divide-line-light rounded-panel border border-line">
              {FAQS.map((faq) => (
                <details key={faq.q} className="group p-5">
                  <summary className="cursor-pointer font-display font-semibold text-ink text-sm">
                    {faq.q}
                  </summary>
                  <div className="mt-3 text-sm text-content-secondary leading-relaxed">
                    {faq.node ?? faq.text}
                  </div>
                </details>
              ))}
            </div>

            <PullQuoteWall quotes={[QUOTES['nahuel-de-bittencourt']]} columns={1} />
          </div>
        </div>
      </section>

      {/* ── Apply ─────────────────────────────────────────────────────── */}
      <section id="apply" className="bg-surface section-padding scroll-mt-24">
        <div className="container-max max-w-content grid gap-12 lg:grid-cols-[0.82fr_1.18fr] items-start">
          <div>
            <Eyebrow>Ready to take part?</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold text-ink leading-tight">
              Apply for {STIPEND_PROGRAM_YEAR}
            </h2>
            <p className="mt-4 text-[15.5px] text-content-secondary leading-relaxed">
              Applications for calendar {STIPEND_PROGRAM_YEAR} are open now, for {STIPEND_PLACES}{' '}
              places. We read every application and reply to all of them, whether or not you get a
              place.
            </p>

            <div className="mt-6 flex flex-col gap-3.5">
              <div className="flex gap-4 bg-white border border-line rounded-ds-card px-[22px] py-5">
                <span className="shrink-0 w-10 h-10 rounded-[10px] flex items-center justify-center bg-primary-soft text-primary">
                  <Document size={22} />
                </span>
                <div>
                  <h3 className="font-display text-base font-semibold text-ink">
                    Want it on paper first?
                  </h3>
                  <p className="mt-1 text-sm text-content-secondary leading-relaxed">
                    <a
                      href={ONE_PAGER}
                      target="_blank"
                      rel="noopener"
                      className="text-primary-deep font-medium hover:underline"
                    >
                      Download the one-page overview
                    </a>{' '}
                    to share with your department head or principal.
                  </p>
                </div>
              </div>

              <div className="flex gap-4 bg-white border border-line rounded-ds-card px-[22px] py-5">
                <span className="shrink-0 w-10 h-10 rounded-[10px] flex items-center justify-center bg-enviro-green-bg text-enviro-green">
                  <Team size={22} />
                </span>
                <div>
                  <h3 className="font-display text-base font-semibold text-ink">
                    Applying registers you as an Educator
                  </h3>
                  <p className="mt-1 text-sm text-content-secondary leading-relaxed">
                    There&rsquo;s no separate signup. Submitting the form creates your free Stellr
                    Educator membership, or updates the account you already have — we match on your
                    email address. Questions first?{' '}
                    <Link href="/contact" className="text-primary-deep font-medium hover:underline">
                      Ask us
                    </Link>
                    .
                  </p>
                </div>
              </div>

              <div className="flex gap-3 bg-pathway-amber-bg border border-pathway-amber/30 rounded-ds-card px-[22px] py-[18px]">
                <span className="shrink-0 font-display font-bold text-pathway-amber-deep text-lg leading-none mt-0.5">
                  !
                </span>
                <p className="text-[13.5px] text-content-body leading-relaxed">
                  {`A live Challenge needs at least ${STIPEND_THRESHOLDS.challengeStudents} students plus you to attend; a Campaign needs at least ${STIPEND_THRESHOLDS.campaignStudents} students registered. Closing out needs two-thirds of them to submit their responses.`}{' '}
                  Apply anyway if you&rsquo;re close — we&rsquo;d rather talk it through.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-line rounded-panel shadow-card-lift p-7 sm:p-9">
            <TeacherStipendForm programYear={STIPEND_PROGRAM_YEAR} prefill={prefill} />
          </div>
        </div>
      </section>
    </>
  )
}
