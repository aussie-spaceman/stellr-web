'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Sub-nav for the Membership Studio. "Access" links out to the existing
// entitlement matrix (the tier→content map) so there's one place for everything.
const TABS = [
  { href: '/admin/membership', label: 'Tiers', exact: true },
  { href: '/admin/membership/rules', label: 'Grant rules', exact: false },
  { href: '/admin/community/entitlements', label: 'Access', exact: false },
  { href: '/admin/membership/members', label: 'Members', exact: false },
]

export function MembershipNav() {
  const pathname = usePathname()
  return (
    <div className="flex gap-1 border-b border-brand-border mb-6 text-sm">
      {TABS.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href)
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              'px-4 py-2 -mb-px border-b-2 ' +
              (active
                ? 'border-brand-blue text-brand-blue-dark font-medium'
                : 'border-transparent text-brand-muted-soft hover:text-brand-blue-dark')
            }
          >
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}
