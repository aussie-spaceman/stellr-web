import { Button, CtaBand, Eyebrow, Hero, StepCard } from '@stellr/web-ui'
import { Environment, Orbit } from '@stellr/icons'
import { Check } from 'lucide-react'
import Link from '@/components/ui/SiteLink'
import { MissionFundingNote } from '@/components/ui/MissionFundingNote'
import { TrackEvent } from '@/components/analytics/TrackEvent'
import { FaqList } from '@/components/lp/FaqList'
import { CurriculumLeadForm } from '@/components/lp/CurriculumLeadForm'
import { VoiceQuote } from '@/components/lp/sections/Reasons'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildFaqJsonLd } from '@/lib/structured-data'
import { PD_STANDARDS } from '@/lib/pd-standards'
import { formatTierPrice, getTierPriceMap } from '@/lib/tier-pricing'
import type { CurriculumLandingPageConfig } from '@/content/lp/cq-types'

/**
 * The Classroom Qualifier curriculum landing page. Same family as
 * LandingPage.tsx (dark hero, light body, shared Hero/StepCard/CtaBand/FAQ),
 * one offer and one form: everything that asks for action points at
 * #get-curriculum.
 *
 * Two values are resolved here, never typed in the config:
 *   • the Catalyst price, from membership_tiers (marketing never hard-codes
 *     prices — lib/tier-pricing.ts);
 *   • the standards, from lib/pd-standards.ts, which mirrors the back of the
 *     Educator certificate code for code (handover: "use exactly the standards
 *     wording on the existing Educator certificate").
 */

const FORM_ANCHOR = '#get-curriculum'

/** "Mathematical Practice, High School Mathematics and ELA/Literacy: …". */
export function standardsSentence(): string {
  const groups = [...new Set(PD_STANDARDS.map((s) => s.group))]
  const list =
    groups.length > 1 ? `${groups.slice(0, -1).join(', ')} and ${groups.at(-1)}` : groups[0] ?? ''
  return `the Common Core standards printed on the Stellr Educator certificate: ${list}`
}

export async function CurriculumLandingPage({ config }: { config: CurriculumLandingPageConfig }) {
  const prices = await getTierPriceMap().catch(() => ({}) as Awaited<ReturnType<typeof getTierPriceMap>>)
  const catalyst = prices['Catalyst']
  const catalystPrice = catalyst && !catalyst.isFree ? formatTierPrice(catalyst) : null
  // Without a live price, drop the "($… value)" aside rather than guess one.
  const offerBody = config.offer
    ? catalystPrice
      ? config.offer.body.replace('{{catalystPrice}}', catalystPrice)
      : config.offer.body.replace(' ({{catalystPrice}} value)', '')
    : null
  const standards = standardsSentence()
  const faqItems = config.faq.items.map((i) => ({ ...i, a: i.a.replace('{{standards}}', standards) }))

  const { hero } = config

  return (
    <>
      <TrackEvent
        event={{ event: 'lp_view', lp_audience: 'classroom_qualifier_teacher', page_slug: config.slug }}
      />

      <Hero pill={{ accent: 'Free curriculum', rest: hero.eyebrow }} title={hero.headline}>
        <div className="mt-5 grid gap-5">
          <p className="text-xl font-semibold leading-[1.25] tracking-heading text-hero-dim">
            {hero.tagline}
          </p>
          <p className="max-w-[34em] text-lg leading-relaxed text-hero-lead text-pretty">
            {hero.positioning}
          </p>
          <div className="flex flex-wrap items-center gap-3.5">
            <Button href={FORM_ANCHOR}>{hero.primaryCta}</Button>
          </div>
          {hero.badge && (
            // Not <Badge>: its uppercase styling would make the code harder to read.
            <p className="w-fit rounded-pill bg-pathway-amber-bg px-3 py-1 text-sm font-semibold text-brand-gold-ink">
              {hero.badge}
            </p>
          )}
        </div>
      </Hero>

      {/* At a glance */}
      <section aria-labelledby="glance-h" className="bg-surface px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-content">
          <h2 id="glance-h" className="sr-only">At a glance</h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {config.glance.map((g) => (
              <li key={g.value} className="rounded-ds-card border border-line bg-white p-4">
                <p className="font-display text-lg font-bold text-ink">{g.value}</p>
                <p className="mt-1 text-ds-meta text-content-secondary">{g.label}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Pick your theme */}
      <section aria-labelledby="themes-h" className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-content">
          <h2 id="themes-h" className="font-display text-3xl font-bold tracking-heading text-ink">
            {config.themes.heading}
          </h2>
          <p className="mt-2 text-ds-body text-content-secondary">{config.themes.note}</p>
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {config.themes.cards.map((card) => {
              const space = card.theme === 'space'
              const Icon = space ? Orbit : Environment
              return (
                <div
                  key={card.name}
                  className={`rounded-panel border-2 bg-white p-6 ${space ? 'border-space-violet' : 'border-enviro-green'}`}
                >
                  <span
                    className={`inline-flex h-11 w-11 items-center justify-center rounded-ds-card text-white ${space ? 'bg-space-violet' : 'bg-enviro-green'}`}
                  >
                    <Icon aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 font-display text-xl font-bold text-ink">{card.name}</h3>
                  <p className="mt-2 text-ds-body leading-relaxed text-content-secondary">{card.body}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* What's included + steps */}
      <section aria-labelledby="included-h" className="bg-surface px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-content gap-10 lg:grid-cols-2">
          <div>
            <h2 id="included-h" className="font-display text-3xl font-bold tracking-heading text-ink">
              {config.included.heading}
            </h2>
            <p className="mt-2 text-ds-body text-content-secondary">{config.included.lead}</p>
            <ul className="mt-6 grid gap-3">
              {config.included.items.map((item) => (
                <li key={item} className="flex items-start gap-3 text-ds-body text-ink">
                  <Check aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="font-display text-3xl font-bold tracking-heading text-ink">{config.steps.heading}</h2>
            <ol className="mt-6 grid gap-4 sm:grid-cols-2">
              {config.steps.items.map((step, i) => (
                <li key={step.title}>
                  <StepCard n={i + 1} title={step.title} body={step.body} />
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* How it's judged */}
      <section aria-labelledby="judging-h" className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-content">
          <h2 id="judging-h" className="font-display text-3xl font-bold tracking-heading text-ink">
            {config.judging.heading}
          </h2>
          <p className="mt-3 max-w-[46em] text-ds-body leading-relaxed text-content-secondary">
            {config.judging.body}
          </p>
          {config.judging.criteria.length > 0 && (
            <ol className="mt-5 grid gap-3 sm:grid-cols-3">
              {config.judging.criteria.map((c) => (
                <li key={c} className="rounded-ds-card border border-line bg-surface p-4 font-semibold text-ink">
                  {c}
                </li>
              ))}
            </ol>
          )}
          <p className="mt-4 font-semibold text-ink">{config.judging.results}</p>
        </div>
      </section>

      {/* Booth offer + Teacher Grant */}
      <section aria-label="Offers" className="bg-white px-4 pb-16 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-content gap-5 md:grid-cols-2">
          {config.offer && offerBody && (
            <div className="rounded-panel border border-pathway-amber bg-pathway-amber-bg p-6">
              <h2 className="font-display text-xl font-bold text-ink">{config.offer.heading}</h2>
              <p className="mt-2 text-ds-body leading-relaxed text-ink">{offerBody}</p>
              <Link href={config.offer.href} className="mt-3 inline-block font-semibold text-primary underline">
                {config.offer.linkLabel}
              </Link>
            </div>
          )}
          <div className="rounded-panel border border-line bg-surface p-6">
            <h2 className="font-display text-xl font-bold text-ink">{config.grant.heading}</h2>
            <p className="mt-2 text-ds-body leading-relaxed text-ink">{config.grant.body}</p>
            <a href={FORM_ANCHOR} className="mt-3 inline-block font-semibold text-primary underline">
              {config.grant.cta}
            </a>
          </div>
        </div>
      </section>

      {/* Proof */}
      <section aria-labelledby="proof-h" className="bg-surface px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-content">
          <h2 id="proof-h" className="font-display text-3xl font-bold tracking-heading text-ink">
            {config.proof.heading}
          </h2>
          <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {config.proof.stats.map((s) => (
              <div key={s.label} className="rounded-ds-card border border-line bg-white p-4">
                <dt className="sr-only">{s.label}</dt>
                <dd className="font-display text-2xl font-bold text-primary">{s.value}</dd>
                <dd className="mt-1 text-ds-meta text-content-secondary">{s.label}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {config.proof.testimonials.map((q) => (
              <figure key={q.who} className="m-0">
                <VoiceQuote accent="space" className="mt-0 h-full px-6 py-6">
                  <span className="block font-display text-lg font-medium leading-snug">“{q.quote}”</span>
                  <figcaption className="mt-3 text-ds-meta font-semibold">{q.who}</figcaption>
                </VoiceQuote>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* The one form */}
      <section
        id="get-curriculum"
        aria-labelledby="form-h"
        className="scroll-mt-20 bg-midnight px-4 py-16 sm:px-6 lg:px-8"
      >
        <div className="mx-auto grid max-w-content gap-8 lg:grid-cols-2">
          <div className="text-white">
            <Eyebrow className="text-hero-dim">{config.form.eyebrow}</Eyebrow>
            <h2 id="form-h" className="mt-2.5 font-display text-3xl font-bold tracking-heading">
              {config.form.heading}
            </h2>
            <p className="mt-3 text-hero-lead">{hero.positioning}</p>
          </div>
          <CurriculumLeadForm config={config} />
        </div>
      </section>

      {/* FAQ */}
      <section aria-labelledby="faq-h" id="faq" className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <JsonLd data={buildFaqJsonLd(faqItems.map((item) => ({ q: item.q, text: item.a })))} />
        <div className="mx-auto grid max-w-content gap-8 lg:grid-cols-3 lg:gap-12">
          <h2 id="faq-h" className="font-display text-3xl font-bold tracking-heading text-ink">
            {config.faq.heading}
          </h2>
          <div className="lg:col-span-2">
            <FaqList items={faqItems} />
          </div>
        </div>
      </section>

      {config.crossPromo && (
        <section aria-label="Also in Mankato" className="bg-white px-4 pb-12 sm:px-6 lg:px-8">
          <p className="mx-auto max-w-content rounded-ds-card border border-enviro-green bg-enviro-green-chip p-4 text-ds-body text-ink">
            {config.crossPromo.text}{' '}
            <Link href={config.crossPromo.href} className="font-semibold text-primary underline">
              {config.crossPromo.linkLabel}
            </Link>
          </p>
        </section>
      )}

      <CtaBand
        title={config.finalCta.heading}
        body={config.finalCta.body}
        actions={<Button href={FORM_ANCHOR}>{hero.primaryCta}</Button>}
      />

      <section aria-label="How Stellr is funded" className="bg-white px-4 pb-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-content">
          <MissionFundingNote variant="general" />
        </div>
      </section>
    </>
  )
}
