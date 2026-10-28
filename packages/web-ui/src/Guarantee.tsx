// @stellr/web-ui GuaranteeBadge — the money-back guarantee, beside every payment.
import * as React from 'react'
import { ShieldCheck } from 'lucide-react'
import { cn } from './primitives'

/**
 * The 100% money-back guarantee, shown next to wherever money is asked for.
 * Gold, the support colour. The window is in the badge itself, not only in the
 * Terms: a guarantee's conditions belong beside the claim.
 *
 *   full    — a panel: headline, terms, and a link to the full wording.
 *   compact — one line, for beside a price or a pay button.
 *
 * `onDark` for midnight surfaces. Pass the router's link as `linkAs`.
 */
export function GuaranteeBadge({
  days,
  href,
  linkAs,
  variant = 'full',
  onDark = false,
  className,
}: {
  /** The refund window, in days from payment. */
  days: number
  /** Where "How it works" goes — the Terms section. */
  href?: string
  linkAs?: React.ElementType
  variant?: 'full' | 'compact'
  onDark?: boolean
  className?: string
}) {
  const Link = (linkAs ?? 'a') as React.ElementType
  const more = href ? (
    <Link
      href={href}
      className={cn(
        'font-semibold underline underline-offset-2 hover:no-underline',
        onDark ? 'text-white' : 'text-primary-deep',
      )}
    >
      {variant === 'full' ? 'How it works' : 'Details'}
    </Link>
  ) : null

  if (variant === 'compact') {
    return (
      <p className={cn('flex items-start gap-1.5 text-sm', onDark ? 'text-hero-lead' : 'text-content-secondary', className)}>
        <ShieldCheck size={16} aria-hidden="true" className={cn('mt-0.5 shrink-0', onDark ? 'text-star-gold' : 'text-gold-ink')} />
        <span>
          <strong className={onDark ? 'text-white' : 'text-ink'}>100% money-back guarantee</strong> — a full refund
          within {days} days of payment.{more && <>{' '}{more}</>}
        </span>
      </p>
    )
  }

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-ds-card border px-4 py-3',
        onDark ? 'border-white/15 bg-white/5' : 'border-pathway-amber/30 bg-pathway-amber-bg',
        className,
      )}
    >
      <ShieldCheck size={22} aria-hidden="true" className={cn('mt-0.5 shrink-0', onDark ? 'text-star-gold' : 'text-gold-ink')} />
      <div className="text-sm leading-relaxed">
        <p className={cn('font-semibold', onDark ? 'text-white' : 'text-ink')}>100% money-back guarantee</p>
        <p className={onDark ? 'text-hero-lead' : 'text-content-secondary'}>
          Ask for a full refund within {days} days of payment. No questions asked.{more && <>{' '}{more}</>}
        </p>
      </div>
    </div>
  )
}
