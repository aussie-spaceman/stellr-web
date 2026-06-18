import Link from 'next/link'
import Image from 'next/image'

interface LogoProps {
  /** Tailwind height class controlling the rendered logo size (e.g. "h-14"). */
  sizeClassName?: string
  className?: string
}

/**
 * Horizontal Stellr logo (mark + wordmark). Uses a viewBox-cropped copy of the
 * brand SVG so the lockup fills its box predictably at any height. The brand
 * mark is a full-colour raster, so it is always shown in colour — on dark
 * surfaces, place it on a light container rather than inverting it.
 */
export function Logo({ sizeClassName = 'h-12', className = '' }: LogoProps) {
  return (
    <Link href="/" className={`inline-flex items-center ${className}`} aria-label="Stellr Education — home">
      <Image
        src="/images/logo-horiz-tight.svg"
        alt="Stellr Education"
        width={1483}
        height={491}
        priority
        className={`${sizeClassName} w-auto`}
      />
    </Link>
  )
}
