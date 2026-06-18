import Image from 'next/image'
import Link from 'next/link'

// Branded empty state (Stage 4): faint star-mark glyph + one line of guidance +
// an optional primary action. Replaces cold gray lucide empties.
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: { label: string; href: string }
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-brand-border bg-white px-6 py-12 text-center">
      <Image src="/images/logo-icon.svg" alt="" width={44} height={44} className="opacity-20" />
      <p className="text-sm font-medium text-brand-muted">{title}</p>
      {hint && <p className="-mt-1 max-w-xs text-xs text-brand-muted-soft">{hint}</p>}
      {action && (
        <Link href={action.href} className="btn-energy mt-1">
          {action.label}
        </Link>
      )}
    </div>
  )
}
