'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, Menu, X } from 'lucide-react'
import { Logo } from './Logo'
import { NavUserButton } from './NavUserButton'

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

// Set NEXT_PUBLIC_SIGNUPS_OPEN=false (in Vercel) + redeploy to hide the
// "Join Free" sign-up button while the site is in public review. Log In stays
// available throughout. Flip back to true (or remove) + redeploy to restore it.
const SIGNUPS_OPEN = (process.env.NEXT_PUBLIC_SIGNUPS_OPEN ?? 'true') !== 'false'

type NavbarProps = {
  isSignedIn?: boolean
  isAdmin?: boolean
}

const navLinks = [
  {
    label: 'Educate',
    href: '/educate',
    dropdown: [
      { label: 'Competitions', href: '/competitions' },
      { label: 'Curriculum Campaigns', href: '/campaigns' },
      { label: 'Events', href: '/events' },
      { label: 'Scholarships', href: '/scholarship' },
      { label: 'Host An Event', href: '/host-an-event' },
    ],
  },
  {
    label: 'Community',
    href: '/community',
    dropdown: [
      { label: 'Membership', href: '/membership' },
      { label: 'For Students', href: '/students' },
      { label: 'For Educators & Schools', href: '/educators' },
      { label: 'For Volunteers & Mentors', href: '/mentors' },
    ],
  },
  {
    label: 'Academy',
    href: '/academy',
    dropdown: [
      { label: 'Training', href: '/academy#training' },
      { label: 'Mentoring', href: '/academy#mentoring' },
      { label: 'Coaching', href: '/academy#coaching' },
    ],
  },
  {
    label: 'Network',
    href: '/network',
    dropdown: [
      { label: 'Industry Partners', href: '/network#industry' },
      { label: 'University Partners', href: '/network#university' },
      { label: 'Corporate Partners', href: '/network#corporate' },
    ],
  },
  {
    label: 'About',
    href: '/about',
    dropdown: [
      { label: 'Why Stellr', href: '/why-stellr' },
      { label: 'Impact', href: '/impact' },
      { label: 'Mission', href: '/about#mission' },
      { label: 'Our Team', href: '/about#team' },
      { label: 'Contact Us', href: '/contact' },
    ],
  },
]

const getInvolvedLinks = [
  { label: 'Register For An Event', href: '/events' },
  { label: 'Download Curriculum Material', href: '/campaigns' },
  { label: 'Join Our Community', href: '/sign-up' },
  { label: 'Become A Sponsor', href: 'https://www.stellreducation.org/network#corporate' },
  { label: 'Volunteer With Us', href: 'https://www.stellreducation.org/mentors' },
  { label: 'Partner With Us', href: '/network' },
]

export function Navbar({ isSignedIn = false, isAdmin = false }: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [mobileExpanded, setMobileExpanded] = useState<string | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pathname = usePathname()

  const openMenu = (label: string) => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpenDropdown(label)
  }

  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setOpenDropdown(null), 150)
  }

  const toggleMobileSection = (label: string) =>
    setMobileExpanded((prev) => (prev === label ? null : label))

  // A pillar is "active" when the current path lives anywhere in its section —
  // i.e. matches the pillar's own route OR any of its drop-down destinations
  // (hash stripped). Without this, Educate/Community/About never highlight
  // because their drop-down items live under different top-level routes
  // (/competitions, /students, /why-stellr…), whereas Academy/Network do.
  const isActive = (link: (typeof navLinks)[number]) => {
    const roots = [link.href, ...(link.dropdown?.map((d) => d.href.split('#')[0]) ?? [])].filter(
      Boolean,
    )
    return roots.some((root) => pathname === root || !!pathname?.startsWith(`${root}/`))
  }

  return (
    <header className="sticky top-0 z-50">

      {/* ── Utility bar ── */}
      <div className="bg-midnight">
        <div className="mx-auto max-w-chrome px-8 py-2 flex items-center justify-end gap-3">
          {isSignedIn ? (
            <>
              <a
                href={`${AUTH_URL}/community`}
                className="text-hero-lead text-[13px] hover:text-white transition-colors"
              >
                My Stellr
              </a>
              <NavUserButton isAdmin={isAdmin} />
            </>
          ) : (
            <>
              <a
                href={`${AUTH_URL}/sign-in`}
                className="text-hero-lead text-[13px] hover:text-white transition-colors"
              >
                Log In
              </a>
              {SIGNUPS_OPEN && (
                <a
                  href={`${AUTH_URL}/sign-up`}
                  className="text-primary text-[13px] font-medium hover:text-primary-deep transition-colors"
                >
                  Join Free →
                </a>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Main nav (white) ── */}
      <nav
        className="bg-white border-b border-line"
        style={{ boxShadow: '0 1px 4px rgba(14,19,48,.06)' }}
        aria-label="Main navigation"
      >
        <div className="mx-auto max-w-chrome px-8 flex items-center h-[68px] gap-2">

          {/* Logo */}
          <Logo sizeClassName="h-[38px]" className="mr-6 flex-none" />

          {/* Desktop nav pillars */}
          <ul className="hidden lg:flex items-center gap-1">
            {navLinks.map((link) => (
              <li key={link.href} className="relative">
                <div
                  onMouseEnter={() => openMenu(link.label)}
                  onMouseLeave={scheduleClose}
                >
                  <button
                    className={`flex items-center gap-1 px-3 py-1.5 text-[15px] rounded-md transition-colors hover:bg-[#F0F3FF] ${
                      isActive(link)
                        ? 'text-midnight font-semibold'
                        : 'text-content font-normal'
                    }`}
                    aria-expanded={openDropdown === link.label}
                  >
                    {link.label}
                    <ChevronDown
                      size={12}
                      className={`opacity-60 transition-transform ${openDropdown === link.label ? 'rotate-180' : ''}`}
                    />
                  </button>
                </div>

                {openDropdown === link.label && link.dropdown && (
                  <ul
                    className="absolute top-full left-0 mt-1 w-52 bg-white rounded-lg shadow-lg border border-line py-1 z-50"
                    onMouseEnter={() => openMenu(link.label)}
                    onMouseLeave={scheduleClose}
                  >
                    {link.dropdown.map((item) => (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className="block px-4 py-2 text-sm text-content hover:bg-surface hover:text-midnight transition-colors"
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

          {/* Spacer */}
          <div className="flex-1" />

          {/* Desktop CTAs */}
          <div className="hidden lg:flex items-center gap-2.5">
            {/* Get Involved */}
            <div className="relative">
              <div
                onMouseEnter={() => openMenu('get-involved')}
                onMouseLeave={scheduleClose}
              >
                <button
                  className="flex items-center gap-1.5 border-[1.5px] border-primary text-primary rounded-[8px] px-4 py-[9px] text-[14.5px] font-medium hover:bg-primary-soft transition-colors"
                  aria-expanded={openDropdown === 'get-involved'}
                >
                  Get Involved
                  <ChevronDown
                    size={12}
                    className={`transition-transform ${openDropdown === 'get-involved' ? 'rotate-180' : ''}`}
                  />
                </button>
              </div>

              {openDropdown === 'get-involved' && (
                <ul
                  className="absolute top-full right-0 mt-1 w-52 bg-white rounded-lg shadow-lg border border-line py-1 z-50"
                  onMouseEnter={() => openMenu('get-involved')}
                  onMouseLeave={scheduleClose}
                >
                  {getInvolvedLinks.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="block px-4 py-2 text-sm text-content hover:bg-surface hover:text-midnight transition-colors"
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
              className="px-[22px] py-[9px] text-[14.5px] font-semibold font-sans bg-donate-gold text-white rounded-[8px] hover:bg-[#C9892C] transition-colors whitespace-nowrap"
            >
              Donate
            </Link>
          </div>

          {/* Mobile hamburger */}
          <button
            className="lg:hidden p-2 rounded-md text-content hover:text-midnight"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </nav>

      {/* ── Mobile overlay ── */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 top-[105px] z-40 bg-white overflow-y-auto">
          <div className="px-4 py-4">
            {[...navLinks, { label: 'Get Involved', href: '/get-involved', dropdown: getInvolvedLinks }].map(
              (link) => (
                <div key={link.label} className="border-b border-line">
                  <button
                    className="w-full flex items-center justify-between px-3 py-3 text-base font-medium text-midnight"
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
                          className="block px-3 py-2 text-sm text-content hover:text-midnight"
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

            <div className="pt-6 flex flex-col gap-3">
              <Link
                href="/donate"
                className="block w-full text-center px-4 py-3 bg-donate-gold text-white font-semibold font-sans rounded-[8px] hover:bg-[#C9892C] transition-colors"
                onClick={() => setMobileOpen(false)}
              >
                Donate
              </Link>
              {isSignedIn ? (
                <a
                  href={`${AUTH_URL}/community`}
                  className="block w-full text-center px-4 py-3 bg-primary text-white font-medium rounded-md hover:bg-primary-deep transition-colors"
                  onClick={() => setMobileOpen(false)}
                >
                  My Stellr
                </a>
              ) : (
                <>
                  {SIGNUPS_OPEN && (
                    <a
                      href={`${AUTH_URL}/sign-up`}
                      className="block w-full text-center px-4 py-3 bg-primary text-white font-medium rounded-md hover:bg-primary-deep transition-colors"
                      onClick={() => setMobileOpen(false)}
                    >
                      Join Free
                    </a>
                  )}
                  <a
                    href={`${AUTH_URL}/sign-in`}
                    className="block w-full text-center px-4 py-3 border border-primary text-primary font-medium rounded-md hover:bg-primary-soft transition-colors"
                    onClick={() => setMobileOpen(false)}
                  >
                    Log In
                  </a>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
