import { Eyebrow } from '@stellr/web-ui'
import { buildFaqJsonLd } from '@/lib/structured-data'
import { FaqList } from '@/components/lp/FaqList'
import type { LandingPageConfig } from '@/content/lp/types'

/**
 * Eight questions per page, as native `<details>`.
 *
 * Native, not a bespoke accordion: keyboard and screen-reader behaviour come
 * for free and correct, and the answers are in the HTML whether or not a row is
 * open — which is the point, since these are indexed pages and the answers are
 * client-approved copy worth ranking for.
 *
 * They render **open** and collapse on narrow screens (see FaqList). A media
 * query cannot toggle `open`, so this is the one place a small client effect
 * earns its place: eight expanded answers is a long scroll on a phone, and it
 * pushes the form — the only thing this page is for — a long way down.
 */
export function Faq({ config }: { config: LandingPageConfig }) {
  const { faq } = config

  return (
    <section aria-labelledby="faq-h" id="faq" className="bg-white px-4 py-16 sm:px-6 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            buildFaqJsonLd(faq.items.map((item) => ({ q: item.q, text: item.a }))),
          ),
        }}
      />
      <div className="mx-auto grid max-w-content gap-8 lg:grid-cols-[0.42fr_1fr] lg:gap-12">
        <div>
          <Eyebrow>{faq.eyebrow}</Eyebrow>
          <h2 id="faq-h" className="mt-2.5 font-display text-3xl font-bold tracking-heading text-ink">
            {faq.heading}
          </h2>
        </div>
        <FaqList items={faq.items} />
      </div>
    </section>
  )
}
