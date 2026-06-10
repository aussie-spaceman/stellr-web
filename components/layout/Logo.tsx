import Link from 'next/link'
import Image from 'next/image'

interface LogoProps {
  variant?: 'dark' | 'light'
  className?: string
}

export function Logo({ variant = 'dark', className = '' }: LogoProps) {
  return (
    <Link href="/" className={`inline-flex items-center ${className}`} aria-label="Stellr Education — home">
      <Image
        src="/images/logo-horiz.svg"
        alt="Stellr Education"
        width={200}
        height={56}
        className={`h-14 w-auto ${variant === 'light' ? 'brightness-0 invert' : ''}`}
      />
    </Link>
  )
}
