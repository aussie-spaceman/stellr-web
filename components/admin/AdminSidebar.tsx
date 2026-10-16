'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  Users, Trophy, MessagesSquare, GraduationCap, SlidersHorizontal, Menu, Home,
} from 'lucide-react'
import { Dialog } from '@stellr/web-ui'

// Persistent admin nav (PR A1, regrouped in the admin IA restructure). Navy rail
// (desktop ≥lg) + bottom tab bar (mobile): Members · Competitions · Community ·
// Academy, and "More" with every page — flat and colour-coded, no
// hover-to-discover.
//
// Event Managers (isAdmin=false) only see the Competitions section; middleware
// already bounces them away from other /admin routes.

type Item = { href: string; label: string }
/** `tone` is the section's icon colour, a token utility. */
type Section = { label: string; href: string; tone: string; icon: typeof Users; items: Item[] }

const SECTIONS: Section[] = [
  {
    label: 'Members', href: '/admin/members', tone: 'text-primary-deep', icon: Users,
    items: [
      { href: '/admin/members', label: 'Members' },
      { href: '/admin/members/access', label: 'Access' },
      { href: '/admin/members/volunteers', label: 'Volunteers' },
      { href: '/admin/scholarships', label: 'Scholarships' },
      { href: '/admin/schools', label: 'Schools' },
    ],
  },
  {
    label: 'Competitions', href: '/admin/competitions', tone: 'text-gold-ink', icon: Trophy,
    items: [
      { href: '/admin/competitions', label: 'Competitions' },
      { href: '/admin/surveys', label: 'Surveys' },
    ],
  },
  {
    label: 'Community', href: '/admin/community/spaces', tone: 'text-primary', icon: MessagesSquare,
    items: [
      { href: '/admin/community/spaces', label: 'Spaces' },
      { href: '/admin/community/resources', label: 'Resources' },
      { href: '/admin/community/moderation', label: 'Moderation' },
    ],
  },
  {
    label: 'Academy', href: '/admin/academy/training', tone: 'text-gold-ink', icon: GraduationCap,
    items: [
      { href: '/admin/academy/training', label: 'Training' },
      { href: '/admin/academy/mentoring', label: 'Mentoring' },
      { href: '/admin/academy/coaching', label: 'Coaching' },
    ],
  },
  {
    label: 'Operations', href: '/admin/activity-log', tone: 'text-content-faint', icon: SlidersHorizontal,
    items: [
      { href: '/admin/activity-log', label: 'Activity log' },
      { href: '/admin/staff', label: 'Staff roles' },
      { href: '/admin/docusigns', label: 'Consent forms' },
      { href: '/admin/privacy-requests', label: 'Privacy requests' },
      { href: '/admin/media', label: 'Media do-not-use' },
      { href: '/admin/compliance', label: 'Background checks' },
      { href: '/admin/email', label: 'Email' },
      { href: '/admin/store', label: 'Store' },
    ],
  },
]

// Every navigable href, longest first — used so the most specific link wins the
// active state (e.g. /admin/members/volunteers lights Volunteers, not Members).
const ALL_HREFS = SECTIONS.flatMap((s) => s.items.map((i) => i.href))

export function AdminSidebar({ isAdmin = true }: { isAdmin?: boolean }) {
  const pathname = usePathname() ?? ''
  const [moreOpen, setMoreOpen] = useState(false)
  useEffect(() => setMoreOpen(false), [pathname])

  // Segment-boundary prefix match, and the most specific matching link wins
  // (so /admin/members/volunteers activates Volunteers rather than Members).
  const matches = (href: string) => pathname === href || pathname.startsWith(href + '/')
  const itemActive = (href: string) =>
    matches(href) && !ALL_HREFS.some((h) => h.length > href.length && matches(h))
  const current = (href: string) => (itemActive(href) ? (pathname === href ? 'page' : 'true') : undefined)

  const sections = isAdmin ? SECTIONS : SECTIONS.filter((s) => s.label === 'Competitions')
  // On a phone the section landings are tabs; Operations, and every page
  // under each section, is in "More" (the landings don't link to all of them).
  const tabs = sections.filter((s) => s.label !== 'Operations')

  return (
    <>
      {/* Desktop rail */}
      <aside className="hidden w-[228px] shrink-0 flex-col gap-0.5 bg-ink px-4 py-6 text-white lg:flex">
        <Link href="/admin" className="mb-5 flex items-center gap-2.5 px-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white">
            <Image src="/images/logo-icon.svg" alt="Stellr" width={20} height={20} />
          </span>
          <span className="font-heading text-lg tracking-wide">STELLR</span>
          <span className="ml-1 rounded-full bg-white/15 px-2 py-0.5 font-subheading text-xs font-semibold uppercase tracking-wide">
            {isAdmin ? 'Admin' : 'Events'}
          </span>
        </Link>

        <nav aria-label="Admin sections" className="flex flex-col gap-0.5">
          {sections.map((section) =>
            section.items.length === 1 ? (
              <RailLink
                key={section.label}
                href={section.href}
                label={section.label}
                icon={section.icon}
                tone={section.tone}
                active={itemActive(section.href)}
                current={current(section.href)}
              />
            ) : (
              <div key={section.label} className="mt-1.5">
                <RailHeader label={section.label} icon={section.icon} tone={section.tone} />
                <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-white/10 pl-2">
                  {section.items.map((item) => (
                    <RailSubLink key={item.href} item={item} active={itemActive(item.href)} current={current(item.href)} />
                  ))}
                </div>
              </div>
            ),
          )}
        </nav>

        <Link
          href="/home"
          className="mt-auto flex items-center gap-3 rounded-[10px] px-3 py-2 pt-6 font-subheading text-sm text-hero-lead hover:text-white"
        >
          <Home className="h-[18px] w-[18px]" aria-hidden="true" />
          My Stellr
        </Link>
      </aside>

      {/* Mobile bottom tab bar (data-tabbar: the cookie banner and toasts sit above it) */}
      <nav
        aria-label="Admin sections"
        data-tabbar=""
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-line bg-white px-1 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 lg:hidden"
      >
        {tabs.map(({ label, href, tone, icon: Icon, items }) => {
          const active = items.some((i) => itemActive(i.href))
          return (
            <Link
              key={label}
              href={href}
              aria-current={active ? (pathname === href ? 'page' : 'true') : undefined}
              className="flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-1 px-0.5"
            >
              <Icon className={`h-5 w-5 ${active ? tone : 'text-content-muted'}`} aria-hidden="true" />
              <span className={`max-w-full truncate font-subheading text-xs leading-none ${active ? 'font-semibold text-ink' : 'font-medium text-content-muted'}`}>
                {label}
              </span>
            </Link>
          )
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className="flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-1 px-0.5"
        >
          <Menu className="h-5 w-5 text-content-muted" aria-hidden="true" />
          <span className="font-subheading text-xs font-medium leading-none text-content-muted">More</span>
        </button>
      </nav>

      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="All admin pages" size="sm">
        <nav aria-label="All admin pages" className="space-y-5">
          {sections.map(({ label, icon: Icon, tone, items }) => (
            <div key={label}>
              <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-eyebrow text-content-muted">
                <Icon className={`h-4 w-4 ${tone}`} aria-hidden="true" />
                {label}
              </p>
              <ul>
                {items.map((item) => {
                  const active = itemActive(item.href)
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setMoreOpen(false)}
                        aria-current={current(item.href)}
                        className={`-mx-2 flex min-h-12 items-center rounded-control px-2 text-base ${
                          active ? 'bg-primary-soft font-semibold text-ink' : 'text-content-body hover:bg-surface'
                        }`}
                      >
                        {item.label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
          <Link
            href="/home"
            className="-mx-2 flex min-h-12 items-center gap-3 rounded-control border-t border-line px-2 pt-2 text-base font-semibold text-primary-deep"
          >
            <Home className="h-5 w-5" aria-hidden="true" />
            Back to My Stellr
          </Link>
        </nav>
      </Dialog>
    </>
  )
}

function RailHeader({ label, icon: Icon, tone }: { label: string; icon: typeof Users; tone: string }) {
  return (
    <div className="flex items-center gap-3 px-3 pb-0.5 pt-1 font-subheading text-xs font-semibold uppercase tracking-[0.12em] text-white/60">
      <Icon className={`h-[15px] w-[15px] ${tone}`} aria-hidden="true" />
      {label}
    </div>
  )
}

function RailLink({
  href, label, icon: Icon, tone, active, current,
}: { href: string; label: string; icon: typeof Users; tone: string; active: boolean; current?: 'page' | 'true' }) {
  return (
    <Link
      href={href}
      aria-current={current}
      className={`mt-1.5 flex items-center gap-3 rounded-[10px] px-3 py-2 font-subheading text-[15px] font-medium transition-colors ${
        active ? 'bg-white/10 text-white' : 'text-hero-lead hover:bg-white/5 hover:text-white'
      }`}
    >
      <Icon className={`h-[18px] w-[18px] ${tone}`} aria-hidden="true" />
      {label}
    </Link>
  )
}

function RailSubLink({ item, active, current }: { item: Item; active: boolean; current?: 'page' | 'true' }) {
  return (
    <Link
      href={item.href}
      aria-current={current}
      className={`rounded-lg px-3 py-1.5 font-subheading text-[13.5px] transition-colors ${
        active ? 'bg-white/10 font-medium text-white' : 'text-hero-lead hover:bg-white/5 hover:text-white'
      }`}
    >
      {item.label}
    </Link>
  )
}
