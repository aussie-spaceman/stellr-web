'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, Menu, X } from 'lucide-react'
import { Logo } from './Logo'

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

const navLinks = [
  { label: 'Events', href: '/events' },
  {
    label: 'Why Stellr',
    href: '/why-stellr',
    dropdown: [
      { label: 'Students', href: '/why-stellr#student' },
      { label: 'Teachers', href: '/why-stellr#teacher' },
      { label: 'Parents', href: '/why-stellr#parent' },
      { label: 'Mentors', href: '/why-stellr#mentor' },
      { label: 'Donors', href: '/why-stellr#donor' },
    ],
  },
  { label: 'Membership', href: '/membership' },
  {
    label: 'About',
    href: '/about',
    dropdown: [
      { label: 'Who We Are', href: '/about' },
      { label: 'Our Team', href: '/about#team' },
      { label: 'News', href: '/news' },
    ],
  },
  { label: 'Donate', href: '/donate' },
]

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-gray-100 shadow-sm">
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8" aria-label="Main navigation">
        <div className="flex items-center justify-between h-16">
          <Logo />

          {/* Desktop nav */}
          <ul className="hidden lg:flex items-center gap-1">
            {navLinks.map((link) => (
              <li key={link.href} className="relative">
                {link.dropdown ? (
                  <div
                    className="relative"
                    onMouseEnter={() => setOpenDropdown(link.label)}
                    onMouseLeave={() => setOpenDropdown(null)}
                  >
                    <button
                      className={`flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                        pathname?.startsWith(link.href)
                          ? 'text-brand-blue'
                          : 'text-brand-grey-dark hover:text-brand-blue-dark'
                      }`}
                      aria-expanded={openDropdown === link.label}
                    >
                      {link.label}
                      <ChevronDown size={14} className={`transition-transform ${openDropdown === link.label ? 'rotate-180' : ''}`} />
                    </button>
                    {openDropdown === link.label && (
                      <ul className="absolute top-full left-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-100 py-1 z-50">
                        {link.dropdown.map((item) => (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              className="block px-4 py-2 text-sm text-brand-grey-dark hover:bg-brand-grey-light hover:text-brand-blue-dark transition-colors"
                            >
                              {item.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <Link
                    href={link.href}
                    className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                      pathname === link.href
                        ? 'text-brand-blue'
                        : 'text-brand-grey-dark hover:text-brand-blue-dark'
                    }`}
                  >
                    {link.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>

          {/* Desktop CTA */}
          <div className="hidden lg:flex items-center gap-3">
            <a
              href={`${AUTH_URL}/login`}
              className="text-sm font-medium text-brand-grey-dark hover:text-brand-blue-dark transition-colors"
            >
              Log In
            </a>
            <a
              href={`${AUTH_URL}/signup`}
              className="btn-primary text-sm"
            >
              Join Free
            </a>
          </div>

          {/* Mobile menu toggle */}
          <button
            className="lg:hidden p-2 rounded-md text-brand-grey-dark hover:text-brand-blue-dark"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </nav>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 top-16 z-40 bg-white overflow-y-auto">
          <div className="px-4 py-6 space-y-1">
            {navLinks.map((link) => (
              <div key={link.href}>
                <Link
                  href={link.href}
                  className="block px-3 py-3 text-base font-medium text-brand-blue-dark border-b border-gray-100"
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </Link>
                {link.dropdown && (
                  <div className="pl-4 space-y-1 py-2">
                    {link.dropdown.map((item) => (
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
            ))}
            <div className="pt-6 flex flex-col gap-3">
              <a
                href={`${AUTH_URL}/login`}
                className="btn-secondary w-full text-center"
                onClick={() => setMobileOpen(false)}
              >
                Log In
              </a>
              <a
                href={`${AUTH_URL}/signup`}
                className="btn-primary w-full text-center"
                onClick={() => setMobileOpen(false)}
              >
                Join Free
              </a>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
