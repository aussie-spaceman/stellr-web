'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  Home, Trophy, MessageSquare, FolderOpen, Users, Menu,
  GraduationCap, Heart, Star, Radio, ClipboardList, ClipboardCheck, Award,
} from 'lucide-react'
import { Dialog } from '@stellr/web-ui'

type NavItem = { label: string; href: string; icon: typeof Home }

const TOP_ITEMS: NavItem[] = [
  { label: 'Home',         href: '/home',               icon: Home    },
  { label: 'Competitions', href: '/events',             icon: Trophy  },
]

const COMMUNITY_ITEMS: NavItem[] = [
  { label: 'Spaces',    href: '/community',           icon: MessageSquare },
  { label: 'Resources', href: '/community/resources', icon: FolderOpen    },
  { label: 'Directory', href: '/community/members',   icon: Users         },
]

const ACADEMY_ITEMS: NavItem[] = [
  { label: 'Training',  href: '/community/training',  icon: GraduationCap },
  { label: 'Mentoring', href: '/community/mentoring', icon: Heart         },
  { label: 'Coaching',  href: '/community/coaching',  icon: Star          },
  { label: 'Hosting',   href: '/community/hosting',   icon: Radio         },
  // Course completions and event participation, with the LinkedIn share flow.
  { label: 'Credentials', href: '/community/credentials', icon: Award       },
  // Post-event surveys: open ones to answer, submitted ones read-only.
  { label: 'Surveys',     href: '/community/surveys',     icon: ClipboardCheck },
]

// Role-scoped sections (Spaces design). Teachers additionally see Teacher Tools.
// Admin Spaces management lives in the /admin portal (AdminSidebar → Community),
// not in this member-facing rail.
const TEACHER_ITEMS: NavItem[] = [
  { label: 'Group spaces', href: '/community/teacher/group-spaces', icon: ClipboardList },
]

// Pages under /community that are not a Space.
const NON_SPACE_PREFIXES = [
  '/community/resources', '/community/members', '/community/training',
  '/community/mentoring', '/community/workshops', '/community/coaching', '/community/hosting',
  '/community/events', '/community/sessions', '/community/search',
  '/community/teacher', '/community/credentials', '/community/surveys',
]

// Everything the Academy tab stands for on a phone.
const ACADEMY_PREFIXES = [
  '/community/training', '/community/mentoring', '/community/workshops', '/community/coaching',
  '/community/hosting', '/community/sessions', '/community/credentials', '/community/surveys',
]

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`)

export function AppSidebar({
  canHost = false,
  isTeacher = false,
}: {
  canHost?: boolean
  isTeacher?: boolean
}) {
  const pathname = usePathname() ?? ''
  const [moreOpen, setMoreOpen] = useState(false)

  // A link in the sheet navigates; close it when the page changes.
  useEffect(() => setMoreOpen(false), [pathname])

  const isSpaces = () =>
    pathname === '/community' ||
    (pathname.startsWith('/community/') && !NON_SPACE_PREFIXES.some((p) => under(pathname, p)))

  // One item is current at a time: Directory no longer lights up Spaces, and
  // Academy pages no longer light up Community.
  const isActive = (href: string) => {
    if (href === '/home') return pathname === '/home'
    // Competitions (the /events board) also owns the in-app /campaigns pages.
    if (href === '/events') return under(pathname, '/events') || under(pathname, '/campaigns')
    if (href === '/community') return isSpaces()
    return under(pathname, href)
  }

  const academyItems = canHost ? ACADEMY_ITEMS : ACADEMY_ITEMS.filter((i) => i.href !== '/community/hosting')

  // The phone tab bar: four destinations and "More" for everything else, so
  // every section is reachable below lg (it used to stop at five links).
  const tabs: { item: NavItem; active: boolean }[] = [
    { item: TOP_ITEMS[0], active: isActive('/home') },
    { item: TOP_ITEMS[1], active: isActive('/events') },
    {
      item: { label: 'Community', href: '/community', icon: MessageSquare },
      active: isSpaces() || under(pathname, '/community/resources') || under(pathname, '/community/members'),
    },
    {
      item: { label: 'Academy', href: '/community/training', icon: GraduationCap },
      active: ACADEMY_PREFIXES.some((p) => under(pathname, p)),
    },
  ]

  const groups: { label: string; items: NavItem[] }[] = [
    { label: 'Community', items: COMMUNITY_ITEMS },
    { label: 'Academy', items: academyItems },
    ...(isTeacher ? [{ label: 'Teacher Tools', items: TEACHER_ITEMS }] : []),
  ]

  return (
    <>
      {/* ── Desktop sidebar rail ── */}
      <aside className="hidden min-h-screen w-[210px] shrink-0 flex-col bg-midnight font-sans lg:flex">
        {/* Logo */}
        <Link href="/home" className="block px-4 pb-4 pt-5">
          <div className="inline-block rounded-control bg-white px-3 py-2">
            <Image
              src="/images/logo-horiz.png"
              alt="Stellr"
              width={960}
              height={318}
              sizes="85px"
              className="block h-7 w-auto"
            />
          </div>
        </Link>

        <nav aria-label="Member sections" className="flex flex-1 flex-col gap-0.5 px-2.5 py-2">
          {TOP_ITEMS.map((item) => (
            <SidebarLink key={item.href} item={item} active={isActive(item.href)} pathname={pathname} />
          ))}

          <SectionHeading label="Community" />
          {COMMUNITY_ITEMS.map((item) => (
            <SidebarLink key={item.href} item={item} active={isActive(item.href)} pathname={pathname} />
          ))}

          <SectionHeading label="Academy" />
          {academyItems.map((item) => (
            <SidebarLink key={item.href} item={item} active={isActive(item.href)} pathname={pathname} />
          ))}

          {/* Teacher Tools — clearly separated from the regular Spaces item */}
          {isTeacher && (
            <>
              <SectionHeading label="Teacher Tools" />
              {TEACHER_ITEMS.map((item) => (
                <SidebarLink key={item.href} item={item} active={isActive(item.href)} pathname={pathname} />
              ))}
            </>
          )}
        </nav>
      </aside>

      {/* ── Mobile bottom tab bar ── (data-tabbar: the cookie banner and toasts
          sit above it, styles/globals.css) */}
      <nav
        aria-label="Member sections"
        data-tabbar=""
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-line bg-white px-1 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 lg:hidden"
      >
        {tabs.map(({ item: { label, href, icon: Icon }, active }) => (
          <Link
            key={href}
            href={href}
            aria-current={active ? (pathname === href ? 'page' : 'true') : undefined}
            className="flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-1 px-0.5"
          >
            <Icon className={`h-5 w-5 ${active ? 'text-primary-deep' : 'text-content-muted'}`} aria-hidden="true" />
            <span className={`max-w-full truncate text-xs leading-none ${active ? 'font-semibold text-ink' : 'font-medium text-content-muted'}`}>
              {label}
            </span>
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className="flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-1 px-0.5"
        >
          <Menu className="h-5 w-5 text-content-muted" aria-hidden="true" />
          <span className="text-xs font-medium leading-none text-content-muted">More</span>
        </button>
      </nav>

      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="All sections" size="sm">
        <nav aria-label="All member sections" className="space-y-5">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-eyebrow text-content-muted">{group.label}</p>
              <ul>
                {group.items.map(({ label, href, icon: Icon }) => {
                  const active = isActive(href)
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        onClick={() => setMoreOpen(false)}
                        aria-current={active ? (pathname === href ? 'page' : 'true') : undefined}
                        className={`-mx-2 flex min-h-12 items-center gap-3 rounded-control px-2 text-base ${
                          active ? 'bg-primary-soft font-semibold text-ink' : 'text-content-body hover:bg-surface'
                        }`}
                      >
                        <Icon className={`h-5 w-5 ${active ? 'text-primary-deep' : 'text-content-muted'}`} aria-hidden="true" />
                        {label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
      </Dialog>
    </>
  )
}

function SectionHeading({ label }: { label: string }) {
  return (
    <div className="px-2 pb-1 pt-3.5 font-display text-xs font-bold uppercase tracking-eyebrow text-hero-dim">
      {label}
    </div>
  )
}

function SidebarLink({ item, active, pathname }: { item: NavItem; active: boolean; pathname: string }) {
  const { label, href, icon: Icon } = item
  return (
    <Link
      href={href}
      aria-current={active ? (pathname === href ? 'page' : 'true') : undefined}
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm leading-none transition-colors ${
        active ? 'bg-white/10 font-semibold text-white' : 'font-normal text-hero-lead hover:bg-white/[0.06] hover:text-white'
      }`}
    >
      <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-white' : 'text-hero-dim'}`} aria-hidden="true" />
      {label}
    </Link>
  )
}
