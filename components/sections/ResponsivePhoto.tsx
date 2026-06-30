import { type PhotoAsset, isPending, photoSrcSet, flagMissing } from '@/lib/media-manifest'

/**
 * Shared responsive image used by T1 (hero band) and T3 (proof strip/gallery).
 * Emits a <picture> with an AVIF source + JPEG fallback, each a width-based
 * srcset (480/768/1200/1920), honouring the §4b budgets. Below-the-fold images
 * lazy-load. A pending/missing asset renders a labelled placeholder (and is
 * dev-flagged) so unfinished media never ships as a broken image.
 *
 * WebP is intentionally omitted — the build host has no WebP encoder, and
 * AVIF (primary) + JPEG (universal fallback) already covers every browser.
 */
export function ResponsivePhoto({
  photo,
  sizes,
  className = '',
  imgClassName = '',
  priority = false,
  rounded = true,
}: {
  photo: PhotoAsset
  /** Responsive `sizes` hint, e.g. "(max-width:1024px) 100vw, 50vw". */
  sizes: string
  className?: string
  imgClassName?: string
  /** Above-the-fold (hero): eager-load. Everything else lazy-loads. */
  priority?: boolean
  rounded?: boolean
}) {
  const radius = rounded ? 'rounded-2xl' : ''

  if (isPending(photo) || !photo.src) {
    flagMissing('photo', photo.id)
    return (
      <div
        className={`flex aspect-[4/3] w-full items-center justify-center border border-dashed border-line bg-surface ${radius} ${className}`}
        role="img"
        aria-label={photo.alt}
      >
        <span className="px-4 text-center text-xs font-semibold uppercase tracking-wide text-content-faint">
          {photo.alt}
          <br />
          <span className="font-normal normal-case">photo pending</span>
        </span>
      </div>
    )
  }

  return (
    <picture className={`block overflow-hidden ${radius} ${className}`}>
      <source type="image/avif" srcSet={photoSrcSet(photo, 'avif')} sizes={sizes} />
      <source type="image/jpeg" srcSet={photoSrcSet(photo, 'jpg')} sizes={sizes} />
      {/* eslint-disable-next-line @next/next/no-img-element -- responsive <picture> with explicit srcset/sizes is intentional here */}
      <img
        src={`${photo.src}-1200.jpg`}
        alt={photo.alt}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        // @ts-expect-error fetchpriority is a valid HTML attr not yet in React's types
        fetchpriority={priority ? 'high' : undefined}
        className={`h-full w-full object-cover ${imgClassName}`}
      />
      {photo.credit && (
        <span className="sr-only">Credit: {photo.credit}</span>
      )}
    </picture>
  )
}
