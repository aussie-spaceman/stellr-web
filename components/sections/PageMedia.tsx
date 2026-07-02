import type { VideoAsset, QuoteAsset, CompetitionAsset, PhotoAsset } from '@/lib/media-manifest'
import { VideoTestimonial } from './VideoTestimonial'
import { ProofStrip } from './ProofStrip'
import { PullQuoteWall } from './PullQuoteWall'
import { WorkCard } from './WorkCard'

/**
 * Composes a page's media-rollout assets into one coherent "proof" section:
 * a captioned photo strip/gallery (T3), click-to-play videos (T2/T5), an
 * attributed quote wall (T6), and gated/open competition work cards (T4).
 * Empty groups are skipped. Drop one per page with that page's manifest assets.
 */
export function PageMedia({
  eyebrow = 'See it for yourself',
  heading,
  intro,
  photos = [],
  photoHeading,
  videos = [],
  quotes = [],
  competition = [],
  background = 'surface',
  align = 'left',
  photoColumns,
  className = '',
}: {
  eyebrow?: string
  heading: string
  intro?: string
  photos?: PhotoAsset[]
  photoHeading?: string
  videos?: VideoAsset[]
  quotes?: QuoteAsset[]
  competition?: CompetitionAsset[]
  background?: 'surface' | 'white'
  /** 'center' centres the heading block on screen (e.g. photos-only sections). */
  align?: 'left' | 'center'
  /** Forwarded to ProofStrip — use 3 to centre a 3-photo strip on desktop. */
  photoColumns?: 3 | 5
  className?: string
}) {
  const hasAny = photos.length || videos.length || quotes.length || competition.length
  if (!hasAny) return null

  const bg = background === 'white' ? 'bg-white' : 'bg-surface'
  const videoCols = videos.length === 1 ? 'sm:grid-cols-1 max-w-3xl' : 'sm:grid-cols-2'
  const headAlign = align === 'center' ? 'max-w-2xl mx-auto text-center' : 'max-w-2xl'

  return (
    <section className={`section-padding ${bg} ${className}`}>
      <div className="container-max">
        <div className={headAlign}>
          <p className="text-sm font-bold uppercase tracking-widest text-primary mb-3">{eyebrow}</p>
          <h2 className="text-3xl font-bold text-ink">{heading}</h2>
          {intro && <p className="mt-3 text-content-secondary leading-relaxed">{intro}</p>}
        </div>

        {photos.length > 0 && (
          <ProofStrip photos={photos} heading={photoHeading} columns={photoColumns} className="mt-8" />
        )}

        {videos.length > 0 && (
          <div className={`mt-10 grid grid-cols-1 gap-6 ${videoCols}`}>
            {videos.map((v) => (
              <figure key={v.id}>
                <VideoTestimonial src={v.src} poster={v.poster} captionsSrc={v.captions} title={v.title} />
                <figcaption className="mt-3 text-sm font-semibold text-ink">{v.title}</figcaption>
              </figure>
            ))}
          </div>
        )}

        {quotes.length > 0 && (
          <PullQuoteWall quotes={quotes} columns={quotes.length >= 3 ? 3 : (quotes.length as 1 | 2)} className="mt-10" />
        )}

        {competition.length > 0 && (
          <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
            {competition.map((c) => (
              <WorkCard key={c.id} asset={c} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
