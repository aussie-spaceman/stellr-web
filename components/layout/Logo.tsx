import Link from 'next/link'
import Image from 'next/image'

/** The horizontal lockup (mark + wordmark): a 960×318 PNG rendered from the brand SVG. */
export const LOGO_SRC = '/images/logo-horiz.png'
export const LOGO_WIDTH = 960
export const LOGO_HEIGHT = 318

interface LogoProps {
  /** Tailwind height class controlling the rendered logo size (e.g. "h-14"). */
  sizeClassName?: string
  /** The rendered width in CSS px at the largest size used, for `sizes`. */
  displayWidth?: number
  className?: string
}

/**
 * Horizontal Stellr logo (mark + wordmark). The brand mark is a full-colour
 * raster, so it is always shown in colour — on dark surfaces, place it on a
 * light container rather than inverting it.
 *
 * Served as a PNG through next/image with `sizes` set to its displayed width,
 * so a phone downloads a few KB. (The SVG it replaced wrapped a 34 KB PNG and,
 * with no `sizes`, was preloaded at up to 3840px wide on every page.)
 */
export function Logo({ sizeClassName = 'h-12', displayWidth = 145, className = '' }: LogoProps) {
  return (
    <Link href="/" className={`inline-flex items-center ${className}`} aria-label="Stellr Education — home">
      <Image
        src={LOGO_SRC}
        alt="Stellr Education"
        width={LOGO_WIDTH}
        height={LOGO_HEIGHT}
        sizes={`${displayWidth}px`}
        priority
        className={`${sizeClassName} w-auto`}
      />
    </Link>
  )
}
