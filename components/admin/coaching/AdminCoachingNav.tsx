'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Star, CalendarDays, ShieldCheck, ArrowLeft } from 'lucide-react'

const ITEMS = [
  { href: '/admin/academy/coaching', label: 'Coaching workshops', icon: Star, exact: true },
  { href: '/admin/academy/coaching/calendar', label: 'Sessions calendar', icon: CalendarDays },
  { href: '/admin/academy/coaching/access', label: 'Membership & access', icon: ShieldCheck },
]

export function AdminCoachingNav() {
  const pathname = usePathname() ?? ''
  const active = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href))

  return (
    <aside className="w-[210px] shrink-0">
      <p className="px-3 pb-2 font-subheading text-[10.5px] font-bold uppercase tracking-[0.08em] text-content-faint">
        Admin · Coaching
      </p>
      <nav className="flex flex-col gap-0.5">
        {ITEMS.map(({ href, label, icon: Icon, exact }) => {
          const on = active(href, exact)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 rounded-[8px] px-3 py-2 text-sm transition-colors ${
                on ? 'bg-space-violet-bg font-semibold text-space-violet-text' : 'text-content-secondary hover:bg-surface'
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </Link>
          )
        })}
      </nav>
      <p className="px-3 pb-2 pt-5 font-subheading text-[10.5px] font-bold uppercase tracking-[0.08em] text-content-faint">Other</p>
      <Link href="/community/coaching" className="flex items-center gap-2.5 rounded-[8px] px-3 py-2 text-sm text-content-secondary hover:bg-surface">
        <ArrowLeft className="h-4 w-4" /> Back to app
      </Link>
    </aside>
  )
}
