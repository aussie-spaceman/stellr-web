import Link from 'next/link'
import Image from 'next/image'

interface LogoProps {
  variant?: 'dark' | 'light'
  /** Use the stacked logo lockup that includes the "The Engineering Education Community" tagline. */
  withTagline?: boolean
  /** Tailwind height class controlling the rendered logo size (e.g. "h-16"). */
  sizeClassName?: string
  className?: string
}

export function Logo({
  variant = 'dark',
  withTagline = false,
  sizeClassName = 'h-14',
  className = '',
}: LogoProps) {
  const src = withTagline ? '/images/logo-tag.svg' : '/images/logo-horiz.svg'
  return (
    <Link href="/" className={`inline-flex items-center ${className}`} aria-label="Stellr Education — home">
      <Image
        src={src}
        alt="Stellr Education"
        width={200}
        height={withTagline ? 200 : 56}
        priority
        className={`${sizeClassName} w-auto ${variant === 'light' ? 'brightness-0 invert' : ''}`}
      />
    </Link>
  )
}
