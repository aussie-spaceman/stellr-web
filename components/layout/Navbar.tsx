'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, Menu, X } from 'lucide-react'
import { hasSessionHint } from '@/lib/session-hint'
import { Logo } from './Logo'

// The account menu needs Clerk. It loads only for a visitor whose browser says
// they're signed in, so anonymous visitors (most of www) download no Clerk at all.
const NavAccountMenu = dynamic(() => import('./NavAccountMenu'), {
  ssr: false,
  loading: () => <span className="inline-block h-7 w-7 rounded-full bg-white/10" aria-hidden />,
})

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

// Set NEXT_PUBLIC_SIGNUPS_OPEN=false (in Vercel) + redeploy to hide the
// "Join Free" sign-up button while the site is in public review. Log In stays
// available throughout. Flip back to true (or remove) + redeploy to restore it.
const SIGNUPS_OPEN = (process.env.NEXT_PUBLIC_SIGNUPS_OPEN ?? 'true') !== 'false'

type NavLink = {
  label: string
  /** The section's own landing page on www, when it has one. */
  href?: string
  dropdown: { label: string; href: string; prefetch?: false }[]
}

const navLinks: NavLink[] = [
  {
    label: 'Educate',
    href: '/educate',
    dropdown: [
      { label: 'Competitions', href: '/competitions' },
      { label: 'Curriculum', href: '/curriculum' },
      { label: 'Teacher Grant', href: '/grant', prefetch: false }, // dynamic: a prefetch renders it on the server
      { label: 'Events & Campaigns', href: '/events' },
      { label: 'Scholarships', href: '/scholarship' },
      { label: 'Host An Event', href: '/host-an-event' },
    ],
  },
  {
    label: 'Community',
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
      { label: 'A Note On AI', href: '/impact#AI' },
      { label: 'Mission', href: '/about#mission' },
      { label: 'Team and Board', href: '/about#team' },
      { label: 'Contact Us', href: '/contact' },
    ],
  },
]

const getInvolvedLinks: NavLink['dropdown'] = [
  { label: 'Register For An Event', href: '/events' },
  { label: 'Download Curriculum Material', href: '/curriculum' },
  { label: 'Join Our Community', href: `${AUTH_URL}/sign-up` },
  { label: 'Become A Sponsor', href: '/network#corporate' },
  { label: 'Volunteer With Us', href: '/mentors' },
  { label: 'Partner With Us', href: '/network' },
]

/**
 * The public site's header.
 *
 * Phones and small tablets: one 56px bar (logo + menu button). The Log In /
 * Join Free row only shows from lg; on smaller screens those links are in the
 * menu. On a phone held sideways (`short:`) the header scrolls away instead of
 * staying stuck, because 56px of a 375px-tall screen is a lot to lose.
 *
 * The menu behaves like a dialog: it locks the page behind it, keeps focus
 * inside, closes on Escape, on a link, and on navigation, and returns focus to
 * the button.
 *
 * Desktop dropdowns open on mouse hover or on click/Enter. Touch doesn't count
 * as hover, so a tap on a touch laptop or a large tablet opens the menu once
 * instead of opening and immediately closing it.
 *
 * Signed-in state comes from a cookie hint after hydration (see
 * lib/session-hint), not from the server, so this header — and the pages
 * under it — can be served from the CDN.
 */
export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [mobileExpanded, setMobileExpanded] = useState<string | null>(null)
  const [signedIn, setSignedIn] = useState(false)
  const [menuTop, setMenuTop] = useState(0)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const headerRef = useRef<HTMLElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const menuPanelRef = useRef<HTMLDivElement>(null)
  const pathname = usePathname()
  const ids = useId()

  useEffect(() => setSignedIn(hasSessionHint()), [])

  // Close everything on navigation.
  useEffect(() => {
    setMobileOpen(false)
    setOpenDropdown(null)
  }, [pathname])

  // ── Desktop dropdowns ──────────────────────────────────────────────────────
  const openOnHover = (label: string) => (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpenDropdown(label)
  }
  const closeOnLeave = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    closeTimer.current = setTimeout(() => setOpenDropdown(null), 150)
  }
  // deep review PUB-10 (WCAG 2.1.1): click or Enter/Space toggles, Escape closes.
  const toggleMenu = (label: string) => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpenDropdown((prev) => (prev === label ? null : label))
  }
  const closeOnEscape = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOpenDropdown(null)
  }

  // A tap or click outside an open dropdown closes it.
  useEffect(() => {
    if (!openDropdown) return
    const onDown = (e: PointerEvent) => {
      if (!headerRef.current?.contains(e.target as Node)) setOpenDropdown(null)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [openDropdown])

  // ── Mobile menu ────────────────────────────────────────────────────────────
  const closeMobile = useCallback((returnFocus = true) => {
    setMobileOpen(false)
    if (returnFocus) menuButtonRef.current?.focus()
  }, [])

  const openMobile = () => {
    // The panel starts where the header ends, wherever the header is.
    setMenuTop(Math.max(0, headerRef.current?.getBoundingClientRect().bottom ?? 0))
    setMobileOpen(true)
  }

  useEffect(() => {
    if (!mobileOpen) return
    // Lock the page behind the menu and take it out of the tab order and the
    // accessibility tree.
    const background = Array.from(document.querySelectorAll<HTMLElement>('body main, body footer'))
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    background.forEach((el) => el.setAttribute('inert', ''))
    menuPanelRef.current?.querySelector<HTMLElement>('a, button')?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeMobile()
        return
      }
      if (e.key !== 'Tab') return
      // Keep focus between the menu button and the panel.
      const focusables = [
        menuButtonRef.current,
        ...Array.from(menuPanelRef.current?.querySelectorAll<HTMLElement>('a[href], button') ?? []),
      ].filter((el): el is HTMLElement => !!el)
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      background.forEach((el) => el.removeAttribute('inert'))
      document.removeEventListener('keydown', onKey)
    }
  }, [mobileOpen, closeMobile])

  const toggleMobileSection = (label: string) => setMobileExpanded((prev) => (prev === label ? null : label))

  // A pillar is "active" when the current path lives anywhere in its section —
  // its own route OR any of its drop-down destinations (hash stripped).
  const isActive = (link: NavLink) => {
    const roots = [link.href, ...link.dropdown.map((d) => d.href.split('#')[0])].filter(Boolean) as string[]
    return roots.some((root) => pathname === root || !!pathname?.startsWith(`${root}/`))
  }

  const mobileSections: NavLink[] = [...navLinks, { label: 'Get Involved', dropdown: getInvolvedLinks }]

  return (
    <header ref={headerRef} className="sticky top-0 z-50 short:static">
      {/* ── Utility bar (lg and up; the menu carries these links on phones) ── */}
      <div className="hidden bg-midnight lg:block">
        <div className="mx-auto flex max-w-chrome items-center justify-end gap-4 px-8 py-1.5">
          {signedIn ? (
            <NavAccountMenu />
          ) : (
            <>
              <a href={`${AUTH_URL}/sign-in`} className="inline-flex min-h-6 items-center text-sm text-hero-lead transition-colors hover:text-white">
                Log In
              </a>
              {SIGNUPS_OPEN && (
                <a
                  href={`${AUTH_URL}/sign-up`}
                  className="inline-flex min-h-6 items-center text-sm font-medium text-hero-dim transition-colors hover:text-white"
                >
                  Join Free →
                </a>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Main nav (white) ── */}
      <nav className="border-b border-line bg-white shadow-card" aria-label="Main navigation">
        <div className="mx-auto flex h-14 max-w-chrome items-center gap-2 px-4 sm:px-6 lg:h-[68px] lg:px-8">
          <Logo sizeClassName="h-8 lg:h-[38px]" displayWidth={115} className="mr-6 flex-none" />

          {/* Desktop nav pillars */}
          <ul className="hidden items-center gap-1 lg:flex">
            {navLinks.map((link) => {
              const panelId = `${ids}-${link.label}`
              return (
                <li key={link.label} className="relative" onKeyDown={closeOnEscape}>
                  <div onPointerEnter={openOnHover(link.label)} onPointerLeave={closeOnLeave}>
                    <button
                      type="button"
                      className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-[15px] transition-colors hover:bg-primary-soft ${
                        isActive(link) ? 'font-semibold text-midnight' : 'font-normal text-content'
                      }`}
                      onClick={() => toggleMenu(link.label)}
                      aria-expanded={openDropdown === link.label}
                      aria-controls={panelId}
                    >
                      {link.label}
                      <ChevronDown
                        size={12}
                        aria-hidden
                        className={`opacity-60 transition-transform ${openDropdown === link.label ? 'rotate-180' : ''}`}
                      />
                    </button>
                  </div>

                  {openDropdown === link.label && (
                    <ul
                      id={panelId}
                      className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-line bg-white py-1 shadow-lg"
                      onPointerEnter={openOnHover(link.label)}
                      onPointerLeave={closeOnLeave}
                    >
                      {link.dropdown.map((item) => (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            prefetch={item.prefetch}
                            aria-current={pathname === item.href ? 'page' : undefined}
                            className="block px-4 py-2.5 text-sm text-content transition-colors hover:bg-surface hover:text-midnight"
                          >
                            {item.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>

          <div className="flex-1" />

          {/* Desktop CTAs */}
          <div className="hidden items-center gap-2.5 lg:flex">
            <div className="relative" onKeyDown={closeOnEscape}>
              <div onPointerEnter={openOnHover('get-involved')} onPointerLeave={closeOnLeave}>
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-control border-[1.5px] border-primary-deep px-4 py-[9px] text-[14.5px] font-medium text-primary-deep transition-colors hover:bg-primary-soft"
                  onClick={() => toggleMenu('get-involved')}
                  aria-expanded={openDropdown === 'get-involved'}
                  aria-controls={`${ids}-get-involved`}
                >
                  Get Involved
                  <ChevronDown
                    size={12}
                    aria-hidden
                    className={`transition-transform ${openDropdown === 'get-involved' ? 'rotate-180' : ''}`}
                  />
                </button>
              </div>

              {openDropdown === 'get-involved' && (
                <ul
                  id={`${ids}-get-involved`}
                  className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-line bg-white py-1 shadow-lg"
                  onPointerEnter={openOnHover('get-involved')}
                  onPointerLeave={closeOnLeave}
                >
                  {getInvolvedLinks.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        prefetch={item.prefetch}
                        aria-current={pathname === item.href ? 'page' : undefined}
                        className="block px-4 py-2.5 text-sm text-content transition-colors hover:bg-surface hover:text-midnight"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Ink on gold: white on this gold was 2.2:1. */}
            <Link
              href="/donate"
              className="whitespace-nowrap rounded-control bg-donate-gold px-[22px] py-[9px] font-sans text-[14.5px] font-semibold text-ink transition-colors hover:bg-pathway-amber"
            >
              Donate
            </Link>
          </div>

          {/* Mobile menu button */}
          <button
            ref={menuButtonRef}
            type="button"
            className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-md text-content hover:text-midnight lg:hidden"
            onClick={() => (mobileOpen ? closeMobile(false) : openMobile())}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            aria-controls={`${ids}-mobile-menu`}
          >
            {mobileOpen ? <X size={24} aria-hidden /> : <Menu size={24} aria-hidden />}
          </button>
        </div>
      </nav>

      {/* ── Mobile menu ── */}
      {mobileOpen && (
        <div
          ref={menuPanelRef}
          id={`${ids}-mobile-menu`}
          role="dialog"
          aria-modal="true"
          aria-label="Site menu"
          className="fixed inset-x-0 bottom-0 z-40 overflow-y-auto overscroll-contain bg-white lg:hidden"
          style={{ top: menuTop }}
        >
          <div className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
            {mobileSections.map((link) => {
              const sectionId = `${ids}-section-${link.label}`
              const expanded = mobileExpanded === link.label
              return (
                <div key={link.label} className="border-b border-line">
                  <button
                    type="button"
                    className="flex min-h-12 w-full items-center justify-between px-3 text-left text-base font-medium text-midnight"
                    onClick={() => toggleMobileSection(link.label)}
                    aria-expanded={expanded}
                    aria-controls={sectionId}
                  >
                    {link.label}
                    <ChevronDown size={16} aria-hidden className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
                  </button>
                  {expanded && (
                    <ul id={sectionId} className="pb-2 pl-4">
                      {link.href && (
                        <li>
                          <Link
                            href={link.href}
                            aria-current={pathname === link.href ? 'page' : undefined}
                            className="flex min-h-11 items-center px-3 text-sm font-semibold text-primary-deep"
                            onClick={() => closeMobile(false)}
                          >
                            All of {link.label} →
                          </Link>
                        </li>
                      )}
                      {link.dropdown.map((item) => (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            prefetch={item.prefetch}
                            aria-current={pathname === item.href ? 'page' : undefined}
                            className="flex min-h-11 items-center px-3 text-sm text-content hover:text-midnight"
                            onClick={() => closeMobile(false)}
                          >
                            {item.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}

            <div className="flex flex-col gap-3 pt-6">
              <Link
                href="/donate"
                className="block w-full rounded-control bg-donate-gold px-4 py-3 text-center font-sans font-semibold text-ink transition-colors hover:bg-pathway-amber"
                onClick={() => closeMobile(false)}
              >
                Donate
              </Link>
              {signedIn ? (
                <a
                  href={`${AUTH_URL}/community`}
                  className="block w-full rounded-md bg-primary-deep px-4 py-3 text-center font-medium text-white transition-colors hover:bg-ink"
                >
                  My Stellr
                </a>
              ) : (
                <>
                  {SIGNUPS_OPEN && (
                    <a
                      href={`${AUTH_URL}/sign-up`}
                      className="block w-full rounded-md bg-primary-deep px-4 py-3 text-center font-medium text-white transition-colors hover:bg-ink"
                    >
                      Join Free
                    </a>
                  )}
                  <a
                    href={`${AUTH_URL}/sign-in`}
                    className="block w-full rounded-md border border-primary-deep px-4 py-3 text-center font-medium text-primary-deep transition-colors hover:bg-primary-soft"
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
