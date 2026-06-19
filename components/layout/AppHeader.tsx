'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, Menu, X } from 'lucide-react'
import { Logo } from './Logo'
import { NavUserButton } from './NavUserButton'
import { AppSearch } from './AppSearch'
import { NotificationBell } from '@/components/community/NotificationBell'

type AppHeaderProps = {
  /** Adds the Admin panel entry to the Clerk user menu. */
  isAdmin?: boolean
  /** Member can coach or mentor — shows the Hosting link under Academy. */
  showHosting?: boolean
}

type NavSection = {
  label: string
  href: string
  dropdown?: { label: string; href: string }[]
}

/**
 * Header for the member web app (app.stellreducation.org). Replaces the
 * public www chrome (utility bar + marketing nav) on (member) routes:
 * logo, app nav (Competitions / Community / Academy), and on the right an
 * expanding search, the notification bell, and the Clerk account button.
 */
export function AppHeader({ isAdmin = false, showHosting = false }: AppHeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [mobileExpanded, setMobileExpanded] = useState<string | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pathname = usePathname()

  const nav: NavSection[] = [
    { label: 'Competitions', href: '/events' },
    {
      label: 'Community',
      href: '/community',
      dropdown: [
        { label: 'Spaces', href: '/community' },
        { label: 'Resources', href: '/community/resources' },
        { label: 'Directory', href: '/community/members' },
      ],
    },
    {
      label: 'Academy',
      href: '/community/training',
      dropdown: [
        { label: 'Training', href: '/community/training' },
        { label: 'Mentoring', href: '/community/mentoring' },
        { label: 'Coaching', href: '/community/coaching' },
        ...(showHosting ? [{ label: 'Hosting', href: '/community/hosting' }] : []),
      ],
    },
  ]

  /** Open a dropdown and cancel any pending close timer. */
  const openMenu = (label: string) => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpenDropdown(label)
  }

  /** Schedule closing — cancelled if cursor enters the trigger or dropdown within 150 ms. */
  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setOpenDropdown(null), 150)
  }

  const toggleMobileSection = (label: string) =>
    setMobileExpanded((prev) => (prev === label ? null : label))

  const isActive = (section: NavSection) =>
    section.dropdown
      ? section.dropdown.some((item) => pathname === item.href)
      : pathname?.startsWith(section.href)

  return (
    <header className="sticky top-0 z-50">
      <nav className="bg-white border-b border-line-light shadow-sm" aria-label="App navigation">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20 gap-4">
            <Logo />

            {/* Desktop nav */}
            <ul className="hidden lg:flex items-center gap-1 flex-1">
              {nav.map((section) => (
                <li key={section.label} className="relative">
                  {section.dropdown ? (
                    <>
                      <div
                        onMouseEnter={() => openMenu(section.label)}
                        onMouseLeave={scheduleClose}
                      >
                        <button
                          className={`flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                            isActive(section)
                              ? 'text-brand-blue'
                              : 'text-brand-grey-dark hover:text-brand-blue-dark'
                          }`}
                          aria-expanded={openDropdown === section.label}
                        >
                          {section.label}
                          <ChevronDown
                            size={14}
                            className={`transition-transform ${openDropdown === section.label ? 'rotate-180' : ''}`}
                          />
                        </button>
                      </div>

                      {openDropdown === section.label && (
                        <ul
                          className="absolute top-full left-0 mt-1 w-52 bg-white rounded-lg shadow-lg border border-line-light py-1 z-50"
                          onMouseEnter={() => openMenu(section.label)}
                          onMouseLeave={scheduleClose}
                        >
                          {section.dropdown.map((item) => (
                            <li key={item.href}>
                              <Link
                                href={item.href}
                                className="block px-4 py-2 text-sm text-brand-grey-dark hover:bg-brand-grey-light hover:text-brand-blue-dark transition-colors"
                                onClick={() => setOpenDropdown(null)}
                              >
                                {item.label}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : (
                    <Link
                      href={section.href}
                      className={`block px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                        isActive(section)
                          ? 'text-brand-blue'
                          : 'text-brand-grey-dark hover:text-brand-blue-dark'
                      }`}
                    >
                      {section.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>

            {/* Right cluster: search, notifications, account */}
            <div className="flex items-center gap-2">
              <AppSearch />
              <NotificationBell />
              <NavUserButton isAdmin={isAdmin} />

              {/* Mobile hamburger */}
              <button
                className="lg:hidden p-2 rounded-md text-brand-grey-dark hover:text-brand-blue-dark"
                onClick={() => setMobileOpen(!mobileOpen)}
                aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={mobileOpen}
              >
                {mobileOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 top-20 z-40 bg-white overflow-y-auto">
          <div className="px-4 py-4">
            {nav.map((section) =>
              section.dropdown ? (
                <div key={section.label} className="border-b border-line-light">
                  <button
                    className="w-full flex items-center justify-between px-3 py-3 text-base font-medium text-brand-blue-dark"
                    onClick={() => toggleMobileSection(section.label)}
                  >
                    {section.label}
                    <ChevronDown
                      size={16}
                      className={`transition-transform ${mobileExpanded === section.label ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {mobileExpanded === section.label && (
                    <div className="pl-4 pb-3 space-y-1">
                      {section.dropdown.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          className="block px-3 py-2 text-sm text-brand-grey-dark hover:text-brand-blue-dark"
                          onClick={() => setMobileOpen(false)}
                        >
                          {item.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <Link
                  key={section.label}
                  href={section.href}
                  className="block border-b border-line-light px-3 py-3 text-base font-medium text-brand-blue-dark"
                  onClick={() => setMobileOpen(false)}
                >
                  {section.label}
                </Link>
              )
            )}
          </div>
        </div>
      )}
    </header>
  )
}
