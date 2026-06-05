import Link from 'next/link'

interface LogoProps {
  variant?: 'dark' | 'light'
  className?: string
}

export function Logo({ variant = 'dark', className = '' }: LogoProps) {
  return (
    <Link href="/" className={`inline-flex items-center ${className}`} aria-label="Stellr Education — home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/logo-horiz.svg"
        alt="Stellr Education"
        height={40}
        className={`h-14 w-auto ${variant === 'light' ? 'brightness-0 invert' : ''}`}
      />
    </Link>
  )
}
