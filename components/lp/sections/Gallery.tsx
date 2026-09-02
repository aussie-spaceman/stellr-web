import { ResponsivePhoto } from '@/components/sections/ResponsivePhoto'
import { DEFAULT_PHOTO_CREDIT, PHOTOS } from '@/lib/media-manifest'
import type { LandingPageConfig } from '@/content/lp/types'

/**
 * Four framed photos with their own captions.
 *
 * Each photo is a card — white, hairline border, the image clipped to a 4/3 box
 * inside it — rather than a bleed tile. Framed and captioned imagery is what
 * the design system asks for, and it means a centre crop is always safe.
 *
 * The credit prints once for the section rather than under all four captions:
 * `ResponsivePhoto showCredit` would repeat "© Stellr Education" four times
 * directly beneath four content captions, which reads as a rendering fault.
 * The per-photo credit still reaches assistive tech from inside `<picture>`.
 *
 * Below `md` this becomes a scroll-snap row: four 4/3 cards stacked vertically
 * is most of a phone screen spent on photographs the visitor did not come for.
 */
export function Gallery({ config }: { config: LandingPageConfig }) {
  const gallery = config.gallery
  if (!gallery) return null

  return (
    <section aria-labelledby="gallery-h" className="bg-surface px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-content">
        <h2
          id="gallery-h"
          className="font-display text-3xl font-bold tracking-heading text-ink"
        >
          {gallery.heading}
        </h2>
        <p className="mt-3 text-lg leading-relaxed text-content-secondary">{gallery.lead}</p>

        <ul
          className="mt-7 grid list-none grid-flow-col auto-cols-[78%] gap-4 overflow-x-auto p-0 [scroll-snap-type:x_mandatory] sm:auto-cols-[46%] md:grid-flow-row md:auto-cols-auto md:grid-cols-2 md:overflow-visible lg:grid-cols-4"
        >
          {gallery.shots.map((shot) => {
            const photo = PHOTOS[shot.photoId]
            return (
              <li
                key={shot.photoId}
                className="rounded-ds-card border border-line bg-white p-2.5 [scroll-snap-align:start]"
              >
                <ResponsivePhoto
                  photo={photo}
                  sizes="(max-width: 767px) 78vw, (max-width: 1023px) 46vw, 250px"
                  rounded={false}
                  className="aspect-[4/3] rounded-[9px]"
                />
                <p className="mt-2.5 text-ds-meta leading-relaxed text-content-muted">
                  {shot.caption}
                </p>
              </li>
            )
          })}
        </ul>

        <p className="mt-4 text-[11.5px] leading-snug text-content-faint">{DEFAULT_PHOTO_CREDIT}</p>
      </div>
    </section>
  )
}
