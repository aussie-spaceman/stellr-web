import { ChevronDown } from 'lucide-react'
import { Eyebrow } from '@stellr/web-ui'
import { buildFaqJsonLd } from '@/lib/structured-data'

/**
 * A guide's FAQ, plus the matching FAQPage JSON-LD built from the same strings
 * — schema and visible copy cannot drift apart.
 *
 * Each answer is a native <details>: the text is in the served HTML (crawlers
 * and answer engines read it; no script is involved), but a phone reader sees
 * a list of questions instead of several screens of answers (/curriculum and
 * /competitions ran to about 20 screens).
 */
export function GuideFaq({ faqs, title = 'Common questions' }: { faqs: readonly { q: string; a: string }[]; title?: string }) {
  const schema = buildFaqJsonLd(faqs.map((f) => ({ q: f.q, text: f.a })))
  return (
    <section className="section-padding bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, '\\u003c') }}
      />
      <div className="container-max max-w-content">
        <Eyebrow>FAQ</Eyebrow>
        <h2 className="text-3xl font-bold text-ink mt-3">{title}</h2>
        <div className="mt-8 space-y-3">
          {faqs.map((f) => (
            <details key={f.q} className="group rounded-panel border border-line bg-white">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-subheading font-semibold text-ink [&::-webkit-details-marker]:hidden">
                <h3 className="text-base">{f.q}</h3>
                <ChevronDown className="h-5 w-5 shrink-0 text-content-muted transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <p className="px-5 pb-5 leading-relaxed text-content-secondary">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
