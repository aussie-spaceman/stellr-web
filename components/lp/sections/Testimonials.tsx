import { VoiceQuote } from './Reasons'
import type { LandingPageConfig } from '@/content/lp/types'

/**
 * Two voice quote blocks, verbatim from stellreducation.org.
 *
 * The pairing is per audience and deliberate: a judge plus an alum for
 * teachers, a parent plus an alum for families. The alum quote is shared,
 * because it is the one that answers the question both audiences actually have.
 */
export function Testimonials({ config }: { config: LandingPageConfig }) {
  const quotes = config.testimonials
  if (!quotes || quotes.length === 0) return null
  const accent = config.theme === 'enviro' ? 'enviro' : 'space'

  return (
    <section aria-labelledby="voices-h" className="bg-white px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-content">
        <h2 id="voices-h" className="sr-only">
          What participants and judges say
        </h2>
        <div className="grid gap-5 md:grid-cols-2">
          {quotes.map((q) => (
            <figure key={q.who} className="m-0">
              <VoiceQuote accent={accent} className="mt-0 h-full px-6 py-6">
                <span className="block font-display text-[19px] font-medium leading-snug">
                  “{q.quote}”
                </span>
                <figcaption className="mt-3 text-ds-meta font-semibold">{q.who}</figcaption>
              </VoiceQuote>
            </figure>
          ))}
        </div>
      </div>
    </section>
  )
}
