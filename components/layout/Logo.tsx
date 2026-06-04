import Link from 'next/link'

interface LogoProps {
  variant?: 'dark' | 'light'
  className?: string
}

export function Logo({ variant = 'dark', className = '' }: LogoProps) {
  const textColor = variant === 'light' ? 'text-white' : 'text-brand-blue-dark'
  const dotColor = variant === 'light' ? 'text-blue-400' : 'text-brand-blue'

  return (
    <Link href="/" className={`flex items-center gap-1 ${className}`} aria-label="Stellr Education — home">
      {/* Placeholder logo — replace SVG when brand assets arrive */}
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill={variant === 'light' ? '#2563EB' : '#0A0F1E'} />
        <path d="M8 20L14 10L20 18L23 14L26 20H8Z" fill={variant === 'light' ? '#FFFFFF' : '#2563EB'} />
        <circle cx="23" cy="11" r="2.5" fill={variant === 'light' ? '#60A5FA' : '#2563EB'} />
      </svg>
      <span className={`text-xl font-bold tracking-tight ${textColor}`}>
        STELLR<span className={dotColor}>.</span>
      </span>
    </Link>
  )
}
