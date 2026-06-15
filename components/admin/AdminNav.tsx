'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown } from 'lucide-react'

// Admin navigation regrouped into the access schema's shape (decision D9) so the
// 13 flat links read as the model: who/what they can access, then each surface.
// Hover or keyboard-focus opens each section (CSS-only, no client state).
type Item = { href: string; label: string }
type Section = { label: string; items: Item[] }

const SECTIONS: Section[] = [
  {
    label: 'Members & membership',
    items: [
      { href: '/admin', label: 'Members' },
      { href: '/admin/membership', label: 'Membership' },
      { href: '/admin/community/entitlements', label: 'Access map' },
    ],
  },
  {
    label: 'Competitions',
    items: [{ href: '/admin/events', label: 'Events' }],
  },
  {
    label: 'Community',
    items: [
      { href: '/admin/community/resources', label: 'Resources' },
      { href: '/admin/community/announcements', label: 'Announcements' },
      { href: '/admin/community/moderation', label: 'Moderation' },
      { href: '/admin/email', label: 'Email' },
    ],
  },
  {
    label: 'Academy',
    items: [
      { href: '/admin/community/training', label: 'Training' },
      { href: '/admin/community/sessions', label: 'Sessions' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/admin/delegations', label: 'Delegations' },
      { href: '/admin/schools', label: 'Schools' },
      { href: '/admin/docusigns', label: 'Consent forms' },
      { href: '/admin/activity-log', label: 'Activity log' },
    ],
  },
]

export function AdminNav() {
  const pathname = usePathname()
  // '/admin' is the Members page but also the prefix of every route, so match it exactly.
  const itemActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href)

  return (
    <nav className="flex items-center gap-1 text-sm">
      {SECTIONS.map((section) => {
        const sectionActive = section.items.some((i) => itemActive(i.href))
        return (
          <div
            key={section.label}
            className="relative [&:focus-within>div]:block [&:hover>div]:block"
          >
            <button
              className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 ${
                sectionActive ? 'text-gray-900 font-medium' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {section.label}
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </button>
            <div className="absolute left-0 top-full z-20 hidden min-w-[190px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block px-3 py-1.5 text-sm ${
                    itemActive(item.href)
                      ? 'text-indigo-700 font-medium bg-indigo-50/60'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        )
      })}
    </nav>
  )
}
