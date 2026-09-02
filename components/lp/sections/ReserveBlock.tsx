import { LeadForm } from '@/components/lp/LeadForm'
import type { LandingPageConfig } from '@/content/lp/types'

/**
 * The conversion block: what you get on the left, the form on the right.
 *
 * Navy at the CTA radius, matching the `CtaBand` register that closes every
 * other public page — `CtaBand` itself takes title/body/actions and has nowhere
 * to put a form, so this composes the same tokens rather than forking it.
 *
 * The bullets use the gold brand star as their marker. Gold is the support
 * colour in this system, which is exactly what the list is about: a grant
 * programme, scholarships, and someone to talk to.
 */
export function ReserveBlock({
  config, bookingUrl,
}: {
  config: LandingPageConfig
  bookingUrl: string
}) {
  const { form } = config

  return (
    <section aria-labelledby="reserve-h" id="reserve" className="bg-surface px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-content">
        <div className="grid items-start gap-9 rounded-cta bg-midnight bg-[radial-gradient(120%_160%_at_90%_-20%,#28306B_0%,#171D46_50%,var(--color-ink)_100%)] p-8 sm:p-11 lg:grid-cols-[0.9fr_1fr] lg:gap-11">
          <div>
            <p className="font-display text-ds-eyebrow font-bold uppercase text-hero-dim">
              {form.eyebrow}
            </p>
            <h2
              id="reserve-h"
              className="mt-2.5 font-display text-3xl font-bold tracking-heading text-white"
            >
              {form.heading}
            </h2>
            <p className="mt-3 max-w-[30em] text-lg leading-relaxed text-hero-lead">{form.lead}</p>
            <ul className="mt-6 grid list-none gap-2.5 p-0">
              {form.points.map((point) => (
                <li key={point} className="grid grid-cols-[18px_1fr] gap-2.5 text-ds-body leading-relaxed text-hero-lead">
                  <span aria-hidden="true" className="font-display text-star-gold">
                    ✦
                  </span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 max-w-[34em] text-ds-meta leading-relaxed text-hero-dim">
              {form.callNote}
            </p>
          </div>

          <LeadForm config={config} bookingUrl={bookingUrl} />
        </div>
      </div>
    </section>
  )
}
