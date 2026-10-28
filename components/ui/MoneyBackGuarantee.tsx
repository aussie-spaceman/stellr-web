import { GuaranteeBadge } from '@stellr/web-ui'
import { GUARANTEE_DAYS, GUARANTEE_TERMS_URL } from '@/lib/guarantee'

/**
 * The money-back guarantee badge with this site's window and Terms link —
 * what every payment surface renders beside its price or pay button. No hooks,
 * so server and client components can both use it.
 */
export function MoneyBackGuarantee({
  variant = 'full',
  onDark = false,
  className,
}: {
  variant?: 'full' | 'compact'
  onDark?: boolean
  className?: string
}) {
  return (
    <GuaranteeBadge days={GUARANTEE_DAYS} href={GUARANTEE_TERMS_URL} variant={variant} onDark={onDark} className={className} />
  )
}
