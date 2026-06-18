'use client'
// reference_components/AppSidebar.tsx
// Persistent, color-coded member nav. Desktop ≥lg: fixed 228px navy rail.
// Mobile <lg: fixed bottom tab bar. Replaces the AppHeader hover-dropdown nav
// on (member) routes (T2.1). Keep search + notifications + Clerk button in the
// rail footer / a slim top strip (pass them in or compose alongside).

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  Home, Trophy, MessagesSquare, GraduationCap, Users,
  FolderOpen, HeartHandshake, Sparkles, Radio,
} from 'lucide-react'

type Item = { label: string; href: string; icon: typeof Home; color: string }

// IMPORTANT (repo-drift correction): the live (member) app exposes more
// destinations than the original 5-item mock. The AppHeader dropdowns currently
// surface: Spaces, Resources, Directory (Community group) and Training,
// Mentoring, Coaching, Hosting (Academy group). Hosting is conditional on the
// member being able to coach/mentor (see `showHosting` in AppHeader). The flat
// sidebar MUST cover all of these — none may be dropped, or it fails the
// "every destination reachable without a hover dropdown" acceptance criterion.

// Desktop rail = grouped, color-coded. Mobile bar = 5 primary tabs only.
const PRIMARY: Item[] = [
  { label: 'Home',         href: '/home',               icon: Home,           color: '#ffffff' },
  { label: 'Competitions', href: '/events',             icon: Trophy,         color: '#da6220' },
  { label: 'Community',    href: '/community',          icon: MessagesSquare, color: '#3f78d6' },
  { label: 'Academy',      href: '/community/training', icon: GraduationCap,  color: '#dda33b' },
  { label: 'Directory',    href: '/community/members',  icon: Users,          color: '#aebbd6' },
]

// Secondary destinations shown as sub-items in the desktop rail (indented under
// their section). On mobile they are reached from the section landing page.
const COMMUNITY_SUB: Item[] = [
  { label: 'Spaces',    href: '/community',           icon: MessagesSquare, color: '#3f78d6' },
  { label: 'Resources', href: '/community/resources', icon: FolderOpen,     color: '#3f78d6' },
]
const ACADEMY_SUB: Item[] = [
  { label: 'Training',  href: '/community/training',   icon: GraduationCap, color: '#dda33b' },
  { label: 'Mentoring', href: '/community/mentoring',  icon: HeartHandshake, color: '#dda33b' },
  { label: 'Coaching',  href: '/community/coaching',   icon: Sparkles,       color: '#dda33b' },
]
// Hosting is gated — pass `canHost` from the server (same logic as AppHeader's showHosting).
const HOSTING: Item = { label: 'Hosting', href: '/community/hosting', icon: Radio, color: '#dda33b' }

export function AppSidebar({
  user,
  canHost = false,
}: {
  user: { name: string; school?: string | null; initials: string }
  canHost?: boolean
}) {
  const pathname = usePathname() ?? ''
  const isActive = (href: string) =>
    href === '/home' ? pathname === '/home' : pathname.startsWith(href)
  const academySub = canHost ? [...ACADEMY_SUB, HOSTING] : ACADEMY_SUB

  return (
    <>
      {/* Desktop rail */}
      <aside className="hidden lg:flex w-[228px] shrink-0 flex-col gap-1 bg-brand-blue-dark px-4 py-6 text-white">
        <Link href="/home" className="mb-5 flex items-center gap-2.5 px-2">
          <Image src="/images/logo-icon.svg" alt="Stellr" width={30} height={30} className="brightness-0 invert" />
          <span className="font-heading text-xl tracking-wide">STELLR</span>
        </Link>

        {/* Home + Competitions (top-level, no children) */}
        {PRIMARY.slice(0, 2).map((item) => <RailLink key={item.href} item={item} active={isActive(item.href)} />)}

        {/* Community group */}
        <RailLink item={PRIMARY[2]} active={pathname === '/community'} />
        <div className="mb-1 ml-3 flex flex-col gap-0.5 border-l border-white/10 pl-2">
          {COMMUNITY_SUB.filter((s) => s.href !== '/community').concat(
            { label: 'Directory', href: '/community/members', icon: Users, color: '#aebbd6' },
          ).map((item) => <RailSubLink key={item.href} item={item} active={isActive(item.href)} />)}
        </div>

        {/* Academy group (Hosting appended when canHost) */}
        <RailLink item={PRIMARY[3]} active={pathname.startsWith('/community/training')} />
        <div className="mb-1 ml-3 flex flex-col gap-0.5 border-l border-white/10 pl-2">
          {academySub.filter((s) => s.href !== '/community/training').map((item) => (
            <RailSubLink key={item.href} item={item} active={isActive(item.href)} />
          ))}
        </div>

        <div className="mt-auto flex items-center gap-2.5 rounded-[10px] bg-white/[0.06] px-3 py-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-orange text-[13px] font-bold text-brand-blue-dark">
            {user.initials}
          </span>
          <span className="leading-tight">
            <span className="block text-[13.5px] font-semibold">{user.name}</span>
            {user.school && <span className="block text-[11.5px] text-[#aebbd6]">{user.school}</span>}
          </span>
        </div>
      </aside>

      {/* Mobile bottom tab bar — 5 PRIMARY tabs only; secondary destinations
          (Resources / Mentoring / Coaching / Hosting) are reached from each
          section's landing page. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-brand-border bg-white px-2 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 lg:hidden">
        {PRIMARY.map(({ label, href, icon: Icon, color }) => {
          const active = isActive(href)
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              className="flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-1"
            >
              <Icon className="h-5 w-5" style={{ color: active ? color : '#8a8472' }} />
              <span
                className="font-subheading text-[10px]"
                style={{ color: active ? '#051535' : '#8a8472', fontWeight: active ? 600 : 500 }}
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

function RailLink({ item, active }: { item: Item; active: boolean }) {
  const { label, href, icon: Icon, color } = item
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-[10px] px-3 py-2.5 font-subheading text-[15px] font-medium transition-colors ${
        active ? 'bg-white/10 text-white' : 'text-[#aebbd6] hover:text-white hover:bg-white/5'
      }`}
    >
      <Icon className="h-[18px] w-[18px]" style={{ color }} />
      {label}
    </Link>
  )
}

function RailSubLink({ item, active }: { item: Item; active: boolean }) {
  const { label, href, icon: Icon, color } = item
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-[8px] px-3 py-2 font-subheading text-[13.5px] transition-colors ${
        active ? 'bg-white/10 text-white' : 'text-[#aebbd6] hover:text-white hover:bg-white/5'
      }`}
    >
      <Icon className="h-4 w-4" style={{ color }} />
      {label}
    </Link>
  )
}
