// @stellr/web-ui primitives — token-driven, framework-light building blocks.
// All colours/space/radii come from Tailwind utilities backed by @stellr/tokens;
// no raw hex or off-scale values here.
import * as React from 'react'

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

/* ── Button ───────────────────────────────────────────────────────────────
 * Polymorphic: pass `href` (+ optional `as={Link}`) for a link, else a button.
 * Keeps the package framework-agnostic — the app injects its router's Link. */
export type ButtonVariant = 'primary' | 'secondary' | 'outlineWhite' | 'energy' | 'softBlue' | 'softAmber'

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-control font-subheading font-semibold text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2'
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'px-6 py-3 bg-primary text-white hover:bg-primary-deep focus:ring-primary',
  secondary: 'px-6 py-3 border-2 border-primary text-primary hover:bg-primary hover:text-white focus:ring-primary',
  outlineWhite: 'px-6 py-3 border-2 border-white text-white hover:bg-white hover:text-ink focus:ring-white',
  energy: 'px-6 py-3 bg-pathway-amber text-white hover:bg-[#C2722A] focus:ring-pathway-amber',
  softBlue: 'px-4 py-3 bg-primary-soft text-primary hover:bg-primary/15',
  softAmber: 'px-4 py-3 bg-pathway-amber-bg text-brand-gold-ink hover:bg-pathway-amber/15',
}

type ButtonOwnProps = {
  variant?: ButtonVariant
  href?: string
  as?: React.ElementType
  className?: string
  children?: React.ReactNode
}

export function Button({ variant = 'primary', href, as, className, ...rest }: ButtonOwnProps & Record<string, unknown>) {
  const cls = cn(BUTTON_BASE, BUTTON_VARIANTS[variant], className)
  if (href != null) {
    const Comp = (as ?? 'a') as React.ElementType
    return <Comp href={href} className={cls} {...rest} />
  }
  return <button className={cls} {...(rest as Record<string, unknown>)} />
}

/* ── Eyebrow ─────────────────────────────────────────────────────────────── */
export function Eyebrow({
  children,
  className = 'text-primary',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <p className={cn('font-subheading font-semibold uppercase tracking-[0.14em] text-xs', className)}>
      {children}
    </p>
  )
}

/* ── SectionHeading ──────────────────────────────────────────────────────────
 * Either a numbered step (`step="STEP 1"`) or a plain eyebrow above the H2. */
export function SectionHeading({
  step,
  stepClassName = 'text-primary',
  eyebrow,
  title,
  className,
}: {
  step?: string
  stepClassName?: string
  eyebrow?: string
  title: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <div className="flex flex-wrap items-baseline gap-3">
        {step && <span className={cn('font-subheading font-bold tracking-wide', stepClassName)}>{step}</span>}
        <h2 className="text-3xl font-bold text-ink">{title}</h2>
      </div>
    </div>
  )
}

/* ── Badge ─────────────────────────────────────────────────────────────────
 * Small pill label (e.g. a "Best Value" banner uses the full-width variant). */
export function Badge({
  children,
  className = 'bg-primary-soft text-primary',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span className={cn('inline-flex items-center rounded-pill px-3 py-1 text-xs font-bold uppercase tracking-[0.05em]', className)}>
      {children}
    </span>
  )
}

/* ── InfoPill ──────────────────────────────────────────────────────────────
 * The translucent pills used on the dark hero. */
export function InfoPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-sm font-medium text-hero-lead bg-white/5 border border-white/15 px-4 py-2 rounded-lg">
      {children}
    </span>
  )
}
