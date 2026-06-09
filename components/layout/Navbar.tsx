'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, Menu, X } from 'lucide-react'
import { Logo } from './Logo'

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

const navLinks = [
  {
    label: 'Events',
    href: '/events',
    dropdown: [
      { label: 'Why Design Competitions', href: '/events/why-design-competitions' },
      { label: 'Live Challenges', href: '/events/live-challenges' },
      { label: 'Classroom Based Campaigns', href: '/events/classroom-campaigns' },
      { label: 'Host An Event', href: '/host-event' },
    ],
  },
  {
    label: 'Community',
    href: '/community',
    dropdown: [
      { label: 'School Students', href: '/community/students' },
      { label: 'College Students', href: '/community/college-students' },
      { label: 'Educators & Schools', href: '/community/educators' },
      { label: 'Parents & Families', href: '/community/parents' },
      { label: 'Volunteer Mentors', href: '/community/mentors' },
    ],
  },
  {
    label: 'Network',
    href: '/network',
    dropdown: [
      { label: 'Industry Partners', href: '/network/partners' },
      { label: 'University Partners', href: '/network/universities' },
      { label: 'Corporate Partners', href: '/network/corporate' },
    ],
  },
  {
    label: 'About',
    href: '/about',
    dropdown: [
      { label: 'Impact', href: '/about/impact' },
      { label: 'Our Mission', href: '/about' },
      { label: 'Our Team', href: '/about#team' },
      { label: 'Contact Us', href: '/contact' },
    ],
  },
]

const getInvolvedLinks = [
  { label: 'Register For An Event', href: '/events/live-challenges' },
  { label: 'Join Our Community', href: '/join' },
  { label: 'Become a Sponsor', href: '/network/corporate' },
  { label: 'Volunteer With Us', href: '/volunteer' },
  { label: 'Partner With Us', href: '/network/partners' },
]

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [mobileExpanded, setMobileExpanded] = useState<string | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pathname = usePathname()

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

  return (
    <header className="sticky top-0 z-50">
      {/* ── Tier 1: Utility bar ── */}
      <div className="bg-brand-blue-dark">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="hidden lg:flex items-center justify-end h-9 text-xs gap-5">
            <a
              href={`${AUTH_URL}/login`}
              className="text-gray-400 hover:text-white transition-colors"
            >
              Log In
            </a>
            <a
              href={`${AUTH_URL}/signup`}
              className="text-brand-orange font-medium hover:text-amber-300 transition-colors"
            >
              Join Free →
            </a>
          </div>
        </div>
      </div>

      {/* ── Tier 2: Main nav ── */}
      <nav className="bg-white border-b border-gray-100 shadow-sm" aria-label="Main navigation">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            <Logo />

            {/* Desktop nav pillars */}
            <ul className="hidden lg:flex items-center gap-1">
              {navLinks.map((link) => (
                <li key={link.href} className="relative">
                  {/* Trigger wrapper */}
                  <div
                    onMouseEnter={() => openMenu(link.label)}
                    onMouseLeave={scheduleClose}
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
                      <ChevronDown
                        size={14}
                        className={`transition-transform ${openDropdown === link.label ? 'rotate-180' : ''}`}
                      />
                    </button>
                  </div>

                  {/* Dropdown — shares the same open/close handlers so cursor can move freely */}
                  {openDropdown === link.label && link.dropdown && (
                    <ul
                      className="absolute top-full left-0 mt-1 w-52 bg-white rounded-lg shadow-lg border border-gray-100 py-1 z-50"
                      onMouseEnter={() => openMenu(link.label)}
                      onMouseLeave={scheduleClose}
                    >
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
                </li>
              ))}
            </ul>

            {/* Desktop CTAs */}
            <div className="hidden lg:flex items-center gap-3">
              {/* Get Involved dropdown */}
              <div className="relative">
                {/* Trigger wrapper */}
                <div
                  onMouseEnter={() => openMenu('get-involved')}
                  onMouseLeave={scheduleClose}
                >
                  <button
                    className="flex items-center gap-1 px-4 py-2 text-sm font-medium border border-brand-blue text-brand-blue rounded-md hover:bg-blue-50 transition-colors"
                    aria-expanded={openDropdown === 'get-involved'}
                  >
                    Get Involved
                    <ChevronDown
                      size={14}
                      className={`transition-transform ${openDropdown === 'get-involved' ? 'rotate-180' : ''}`}
                    />
                  </button>
                </div>

                {/* Dropdown */}
                {openDropdown === 'get-involved' && (
                  <ul
                    className="absolute top-full right-0 mt-1 w-52 bg-white rounded-lg shadow-lg border border-gray-100 py-1 z-50"
                    onMouseEnter={() => openMenu('get-involved')}
                    onMouseLeave={scheduleClose}
                  >
                    {getInvolvedLinks.map((item) => (
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

              {/* Donate */}
              <Link
                href="/donate"
                className="px-4 py-2 text-sm font-heading font-medium bg-brand-orange text-white rounded-md hover:bg-amber-500 transition-colors"
              >
                Donate
              </Link>
            </div>

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
      </nav>

      {/* ── Mobile overlay (below the main nav bar only — utility bar is hidden on mobile) ── */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 top-16 z-40 bg-white overflow-y-auto">
          <div className="px-4 py-4">
            {/* Nav sections as accordions */}
            {[...navLinks, { label: 'Get Involved', href: '/get-involved', dropdown: getInvolvedLinks }].map(
              (link) => (
                <div key={link.label} className="border-b border-gray-100">
                  <button
                    className="w-full flex items-center justify-between px-3 py-3 text-base font-medium text-brand-blue-dark"
                    onClick={() => toggleMobileSection(link.label)}
                  >
                    {link.label}
                    <ChevronDown
                      size={16}
                      className={`transition-transform ${mobileExpanded === link.label ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {mobileExpanded === link.label && link.dropdown && (
                    <div className="pl-4 pb-3 space-y-1">
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
              )
            )}

            {/* Auth + Donate CTAs */}
            <div className="pt-6 flex flex-col gap-3">
              <Link
                href="/donate"
                className="block w-full text-center px-4 py-3 bg-brand-orange text-white font-heading font-medium rounded-md hover:bg-amber-500 transition-colors"
                onClick={() => setMobileOpen(false)}
              >
                Donate
              </Link>
              <a
                href={`${AUTH_URL}/signup`}
                className="block w-full text-center px-4 py-3 bg-brand-blue text-white font-medium rounded-md hover:bg-blue-800 transition-colors"
                onClick={() => setMobileOpen(false)}
              >
                Join Free
              </a>
              <a
                href={`${AUTH_URL}/login`}
                className="block w-full text-center px-4 py-3 border border-brand-blue text-brand-blue font-medium rounded-md hover:bg-blue-50 transition-colors"
                onClick={() => setMobileOpen(false)}
              >
                Log In
              </a>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
