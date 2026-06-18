'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Sub-nav for the Store admin section (mirrors MembershipNav).
const TABS = [
  { href: '/admin/store', label: 'Products', exact: true },
  { href: '/admin/store/discounts', label: 'Discounts', exact: false },
]

export function StoreNav() {
  const pathname = usePathname()
  return (
    <nav className="mb-5 flex gap-1 border-b border-gray-200">
      {TABS.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href)
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              'px-3 py-2 text-sm -mb-px border-b-2 ' +
              (active
                ? 'border-indigo-600 text-indigo-700 font-medium'
                : 'border-transparent text-gray-600 hover:text-gray-900')
            }
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
