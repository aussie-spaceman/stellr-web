import { Eyebrow } from '@stellr/web-ui'
import { buildFaqJsonLd } from '@/lib/structured-data'

/**
 * A guide's FAQ, rendered open (not an accordion) so every answer is in the
 * served HTML, plus the matching FAQPage JSON-LD built from the same strings —
 * schema and visible copy cannot drift apart.
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
        <dl className="mt-8 space-y-6">
          {faqs.map((f) => (
            <div key={f.q} className="rounded-panel border border-line bg-white p-6">
              <dt className="font-subheading font-semibold text-ink">{f.q}</dt>
              <dd className="text-content-secondary mt-2 leading-relaxed">{f.a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
