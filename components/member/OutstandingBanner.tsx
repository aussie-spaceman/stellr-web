import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import type { OutstandingItem } from '@/lib/member-outstanding'

// Across the top of every member page: what is still owed for upcoming events
// (payment, paperwork, clearance, and for an organiser their group's paperwork).
// The same banner for a teacher and their students, built from
// lib/member-outstanding. Informational — it never blocks anything.

const MAX_SHOWN = 4

export function OutstandingBanner({ items }: { items: OutstandingItem[] }) {
  if (items.length === 0) return null
  const shown = items.slice(0, MAX_SHOWN)
  const more = items.length - shown.length
  return (
    <div role="status" className="border-b border-pathway-amber bg-pathway-amber-bg px-4 py-2.5 print:hidden">
      <div className="mx-auto max-w-5xl space-y-1.5">
        {shown.map((item) => (
          <p key={`${item.kind}:${item.eventSlug}`} className="flex items-start gap-2 text-sm text-gold-ink">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0">
              {item.text}{' '}
              <Link href={item.href} className="whitespace-nowrap font-semibold underline underline-offset-2 hover:no-underline">
                {item.cta}
              </Link>
            </span>
          </p>
        ))}
        {more > 0 && (
          <p className="pl-6 text-xs text-gold-ink">
            And {more} more — see <Link href="/account?tab=profile" className="font-semibold underline underline-offset-2">your account</Link>.
          </p>
        )}
      </div>
    </div>
  )
}
