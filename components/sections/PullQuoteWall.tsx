import type { Audience, QuoteAsset } from '@/lib/media-manifest'

/**
 * T6 — Pull-quote wall. Attributed text quotes as cards, colour-coded by voice
 * (README §6/§10). Zero media weight: pure text, no images or video. Render
 * inside a page-styled <section> for the surrounding heading.
 *
 * Voice → colour (Stellr §10 tokens): student = primary blue #3C6DF6,
 * educator = enviro green #1FA97A, mentor = space violet #7C5CFC,
 * parent = star gold #E0A23A. Applied via inline accent so the mapping is exact.
 */
const VOICE: Record<Audience, { color: string; tint: string; label: string }> = {
  student: { color: '#3C6DF6', tint: 'rgba(60,109,246,.07)', label: 'Student' },
  educator: { color: '#1FA97A', tint: 'rgba(31,169,122,.07)', label: 'Educator' },
  mentor: { color: '#7C5CFC', tint: 'rgba(124,92,252,.08)', label: 'Mentor' },
  parent: { color: '#E0A23A', tint: 'rgba(224,162,58,.09)', label: 'Parent' },
}

function QuoteCard({ quote }: { quote: QuoteAsset }) {
  const voice = VOICE[quote.audience]
  return (
    <figure
      className="flex flex-col rounded-ds-card border border-line bg-white p-6 shadow-card"
      style={{ borderLeft: `4px solid ${voice.color}`, background: `linear-gradient(180deg, ${voice.tint}, #fff 64%)` }}
    >
      <span
        className="mb-3 inline-flex w-fit items-center rounded-pill px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.06em]"
        style={{ color: voice.color, background: voice.tint }}
      >
        {voice.label}
      </span>
      <blockquote className="flex-1 text-[15px] leading-relaxed text-content-secondary">
        “{quote.text}”
      </blockquote>
      <figcaption className="mt-4 border-t border-line-light pt-3">
        <p className="font-display text-sm font-bold text-ink">{quote.name}</p>
        <p className="text-[13px] text-content-faint">{quote.meta}</p>
        {quote.clipHref && (
          <a
            href={quote.clipHref}
            className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-semibold"
            style={{ color: voice.color }}
          >
            Watch the clip →
          </a>
        )}
      </figcaption>
    </figure>
  )
}

export function PullQuoteWall({
  quotes,
  columns = 3,
  className = '',
}: {
  quotes: QuoteAsset[]
  /** Max columns on desktop (1–3). */
  columns?: 1 | 2 | 3
  className?: string
}) {
  if (quotes.length === 0) return null
  const cols = columns === 1 ? 'sm:grid-cols-1' : columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'
  return (
    <div className={`grid grid-cols-1 gap-5 ${cols} ${className}`}>
      {quotes.map((q) => (
        <QuoteCard key={q.id} quote={q} />
      ))}
    </div>
  )
}
