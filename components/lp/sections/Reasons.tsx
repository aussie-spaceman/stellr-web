import { Eyebrow, StepCard } from '@stellr/web-ui'
import type { LandingPageConfig } from '@/content/lp/types'

/**
 * The "Why?" reasons, plus the per-audience note beneath them.
 *
 * The grid must not assume a count: the robotics page has three reasons and the
 * homeschool page two, straight from their respective flyers, and a future
 * audience page could have four. Numbering comes from the array index and is
 * never authored — the flyers number their reasons, so the order is the content.
 *
 * `why.note` differs by audience on purpose (Teacher Grant Program for
 * teachers, scholarships for families) and must not be consolidated.
 */
export function Reasons({ config }: { config: LandingPageConfig }) {
  const { why, theme } = config
  const accent = theme === 'enviro' ? 'enviro' : 'space'

  return (
    <section aria-labelledby="why-h" id="why" className="bg-white px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-content">
        <Eyebrow>{why.eyebrow}</Eyebrow>
        <h2 id="why-h" className="mt-2.5 font-display text-3xl font-bold tracking-heading text-ink">
          {why.heading}
        </h2>
        <p className="mt-3 max-w-[44em] text-lg leading-relaxed text-content-secondary">
          {why.lead}
        </p>

        <div
          className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(240px,1fr))]"
        >
          {why.reasons.map((reason, i) => (
            <StepCard key={reason.title} n={i + 1} title={reason.title} body={reason.body} />
          ))}
        </div>

        <VoiceQuote accent={accent}>{why.note}</VoiceQuote>
      </div>
    </section>
  )
}

/**
 * The design system's voice quote block: a tinted panel with a themed left rule
 * and the brand star. Used for the why note and the testimonials, which is why
 * it lives here rather than being inlined twice.
 */
export function VoiceQuote({
  accent, children, className = '',
}: {
  accent: 'space' | 'enviro'
  children: React.ReactNode
  className?: string
}) {
  const tint =
    accent === 'enviro'
      ? 'bg-enviro-green-bg border-enviro-green text-enviro-green-text'
      : 'bg-space-violet-bg border-space-violet text-space-violet-text'
  return (
    <div className={`mt-7 rounded-r-ds-card border-l-[3px] px-5 py-4 ${tint} ${className}`}>
      {/* A div, not a <p>: the testimonial variant puts a <figcaption> inside
          this slot, and a figcaption nested in a paragraph is invalid markup
          that browsers silently reflow into something else. */}
      <div className="flex gap-2.5 text-ds-body leading-relaxed">
        <span aria-hidden="true" className="font-display leading-relaxed">
          ✦
        </span>
        <div>{children}</div>
      </div>
    </div>
  )
}
