import { preload } from 'react-dom'
import type { SanityImageProps } from '@/lib/sanity-image-params'

// A card's image `sizes`, by the grid the card sits in. On a phone the card is
// the screen less the page's 16px gutters.
export const CARD_IMAGE_SIZES = {
  /** /events: the 1080px content column, two columns at md, three at lg. */
  eventsBoard: '(min-width: 1024px) 344px, (min-width: 768px) 50vw, calc(100vw - 32px)',
  /** /news: the 1280px container, two columns at md, three at lg. */
  newsBoard: '(min-width: 1280px) 384px, (min-width: 1024px) 33vw, (min-width: 768px) 50vw, calc(100vw - 32px)',
  /** The home page's events and an article's related posts: the 1280px container, three columns from md. */
  threeUp: '(min-width: 1280px) 400px, (min-width: 768px) 33vw, calc(100vw - 32px)',
} as const

// A Sanity image filling its positioned box, from the srcset lib/sanity-image
// built. A plain <img>, not next/image: the URLs are already sized, cropped and
// watermarked, and next/image would send each one through Vercel's image
// optimizer again, at a transformation per width.
export function CoverImage({
  image,
  alt,
  className = '',
  priority = false,
}: {
  image: SanityImageProps
  alt: string
  className?: string
  /** The page's LCP image: preload it from <head> and fetch it first, as next/image's `priority` did. */
  priority?: boolean
}) {
  if (priority) {
    preload(image.src, {
      as: 'image',
      imageSrcSet: image.srcSet,
      imageSizes: image.sizes,
      fetchPriority: 'high',
    })
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- pre-sized and watermarked; see above
    <img
      src={image.src}
      srcSet={image.srcSet}
      sizes={image.sizes}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      className={`absolute inset-0 h-full w-full object-cover ${className}`}
    />
  )
}
