'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  Users, Trophy, MessagesSquare, GraduationCap, SlidersHorizontal,
} from 'lucide-react'

// Persistent admin nav (PR A1, regrouped in the admin IA restructure). Navy rail
// (desktop ≥lg) + bottom tab bar (mobile): Members · Competitions · Community ·
// Academy · Operations — flat and colour-coded, no hover-to-discover.
//
// Event Managers (isAdmin=false) only see the Competitions section; middleware
// already bounces them away from other /admin routes.

type Item = { href: string; label: string }
type Section = { label: string; href: string; color: string; icon: typeof Users; items: Item[] }

const SECTIONS: Section[] = [
  {
    label: 'Members', href: '/admin/members', color: '#2C53C6', icon: Users,
    items: [
      { href: '/admin/members', label: 'Members' },
      { href: '/admin/members/access', label: 'Access' },
      { href: '/admin/members/volunteers', label: 'Volunteers' },
      { href: '/admin/schools', label: 'Schools' },
    ],
  },
  {
    label: 'Competitions', href: '/admin/competitions', color: '#E0922F', icon: Trophy,
    items: [{ href: '/admin/competitions', label: 'Competitions' }],
  },
  {
    label: 'Community', href: '/admin/community/spaces', color: '#3f78d6', icon: MessagesSquare,
    items: [
      { href: '/admin/community/spaces', label: 'Spaces' },
      { href: '/admin/community/resources', label: 'Resources' },
      { href: '/admin/community/moderation', label: 'Moderation' },
    ],
  },
  {
    label: 'Academy', href: '/admin/academy/training', color: '#E0A23A', icon: GraduationCap,
    items: [
      { href: '/admin/academy/training', label: 'Training' },
      { href: '/admin/academy/mentoring', label: 'Mentoring' },
      { href: '/admin/academy/coaching', label: 'Coaching' },
    ],
  },
  {
    label: 'Operations', href: '/admin/activity-log', color: '#6A708C', icon: SlidersHorizontal,
    items: [
      { href: '/admin/activity-log', label: 'Activity log' },
      { href: '/admin/delegations', label: 'Delegations' },
      { href: '/admin/staff', label: 'Staff roles' },
      { href: '/admin/docusigns', label: 'Consent forms' },
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
  // Segment-boundary prefix match, and the most specific matching link wins
  // (so /admin/members/volunteers activates Volunteers rather than Members).
  const matches = (href: string) => pathname === href || pathname.startsWith(href + '/')
  const itemActive = (href: string) =>
    matches(href) && !ALL_HREFS.some((h) => h.length > href.length && matches(h))

  const sections = isAdmin ? SECTIONS : SECTIONS.filter((s) => s.label === 'Competitions')

  return (
    <>
      {/* Desktop rail */}
      <aside className="hidden lg:flex w-[228px] shrink-0 flex-col gap-0.5 bg-brand-blue-dark px-4 py-6 text-white">
        <Link href="/admin" className="mb-5 flex items-center gap-2.5 px-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white">
            <Image src="/images/logo-icon.svg" alt="Stellr" width={20} height={20} />
          </span>
          <span className="font-heading text-lg tracking-wide">STELLR</span>
          <span className="ml-1 rounded-full bg-white/15 px-2 py-0.5 font-subheading text-[10px] font-semibold uppercase tracking-wide">
            {isAdmin ? 'Admin' : 'Events'}
          </span>
        </Link>

        {sections.map((section) =>
          section.items.length === 1 ? (
            <RailLink
              key={section.label}
              href={section.href}
              label={section.label}
              icon={section.icon}
              color={section.color}
              active={itemActive(section.href)}
            />
          ) : (
            <div key={section.label} className="mt-1.5">
              <RailHeader label={section.label} icon={section.icon} color={section.color} />
              <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-white/10 pl-2">
                {section.items.map((item) => (
                  <RailSubLink key={item.href} item={item} active={itemActive(item.href)} />
                ))}
              </div>
            </div>
          ),
        )}
      </aside>

      {/* Mobile bottom tab bar — one tab per section landing */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-brand-border bg-white px-1 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 lg:hidden">
        {sections.map(({ label, href, color, icon: Icon, items }) => {
          const active = items.some((i) => itemActive(i.href))
          return (
            <Link
              key={label}
              href={href}
              aria-label={label}
              className="flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-1"
            >
              <Icon className="h-5 w-5" style={{ color: active ? color : '#6A708C' }} />
              <span
                className="font-subheading text-[10px]"
                style={{ color: active ? '#13183A' : '#6A708C', fontWeight: active ? 600 : 500 }}
              >
                {label}
              </span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}

function RailHeader({ label, icon: Icon, color }: { label: string; icon: typeof Users; color: string }) {
  return (
    <div className="flex items-center gap-3 px-3 pb-0.5 pt-1 font-subheading text-[12px] font-semibold uppercase tracking-[0.12em] text-white/45">
      <Icon className="h-[15px] w-[15px]" style={{ color }} />
      {label}
    </div>
  )
}

function RailLink({
  href, label, icon: Icon, color, active,
}: { href: string; label: string; icon: typeof Users; color: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`mt-1.5 flex items-center gap-3 rounded-[10px] px-3 py-2 font-subheading text-[15px] font-medium transition-colors ${
        active ? 'bg-white/10 text-white' : 'text-[#aebbd6] hover:bg-white/5 hover:text-white'
      }`}
    >
      <Icon className="h-[18px] w-[18px]" style={{ color }} />
      {label}
    </Link>
  )
}

function RailSubLink({ item, active }: { item: Item; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={`rounded-[8px] px-3 py-1.5 font-subheading text-[13.5px] transition-colors ${
        active ? 'bg-white/10 font-medium text-white' : 'text-[#aebbd6] hover:bg-white/5 hover:text-white'
      }`}
    >
      {item.label}
    </Link>
  )
}
