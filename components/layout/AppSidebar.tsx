'use client'
// Persistent, colour-coded member nav (T2.1). Desktop ≥lg: fixed 228px navy
// rail with grouped sections + user chip footer. Mobile <lg: fixed bottom tab
// bar (5 primary tabs). Replaces the AppHeader hover-dropdown nav on (member)
// routes; search / notifications / Clerk button live in the shell top strip.
//
// Covers ALL live destinations the old dropdowns reached: Spaces, Resources,
// Directory (Community) and Training, Mentoring, Coaching, and conditional
// Hosting (Academy). Hosting is gated via the `canHost` prop (server-computed,
// same logic as AppHeader's showHosting).

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  Home, Trophy, MessagesSquare, GraduationCap, Users,
  FolderOpen, HeartHandshake, Sparkles, Radio,
} from 'lucide-react'

type Item = { label: string; href: string; icon: typeof Home; color: string }

const PRIMARY: Item[] = [
  { label: 'Home',         href: '/home',               icon: Home,           color: '#ffffff' },
  { label: 'Competitions', href: '/events',             icon: Trophy,         color: '#da6220' },
  { label: 'Community',    href: '/community',          icon: MessagesSquare, color: '#3f78d6' },
  { label: 'Academy',      href: '/community/training', icon: GraduationCap,  color: '#dda33b' },
  { label: 'Directory',    href: '/community/members',  icon: Users,          color: '#aebbd6' },
]

const COMMUNITY_SUB: Item[] = [
  { label: 'Spaces',    href: '/community',           icon: MessagesSquare, color: '#3f78d6' },
  { label: 'Resources', href: '/community/resources', icon: FolderOpen,     color: '#3f78d6' },
  { label: 'Directory', href: '/community/members',   icon: Users,          color: '#aebbd6' },
]
const ACADEMY_SUB: Item[] = [
  { label: 'Training',  href: '/community/training',  icon: GraduationCap,  color: '#dda33b' },
  { label: 'Mentoring', href: '/community/mentoring', icon: HeartHandshake, color: '#dda33b' },
  { label: 'Coaching',  href: '/community/coaching',  icon: Sparkles,       color: '#dda33b' },
]
const HOSTING: Item = { label: 'Hosting', href: '/community/hosting', icon: Radio, color: '#dda33b' }

export function AppSidebar({ canHost = false }: { canHost?: boolean }) {
  const pathname = usePathname() ?? ''
  const isActive = (href: string) =>
    href === '/home' ? pathname === '/home' : pathname.startsWith(href)

  // Sub-routes that are NOT "Spaces" — so the Spaces item (href /community) only
  // highlights on the spaces landing or a space-detail page, not on deeper routes.
  const NON_SPACE = [
    '/community/resources', '/community/members', '/community/training',
    '/community/mentoring', '/community/coaching', '/community/hosting',
    '/community/events', '/community/sessions', '/community/search',
  ]
  const subActive = (href: string) => {
    if (href === '/community') {
      return pathname === '/community' || (pathname.startsWith('/community/') && !NON_SPACE.some((k) => pathname.startsWith(k)))
    }
    return pathname.startsWith(href)
  }
  const academySub = canHost ? [...ACADEMY_SUB, HOSTING] : ACADEMY_SUB

  return (
    <>
      {/* Desktop rail */}
      <aside className="hidden lg:flex w-[228px] shrink-0 flex-col gap-1 bg-brand-blue-dark px-4 py-6 text-white">
        <Link href="/home" className="mb-5 flex items-center gap-2.5 px-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white">
            <Image src="/images/logo-icon.svg" alt="Stellr" width={22} height={22} />
          </span>
          <span className="font-heading text-xl tracking-wide">STELLR</span>
        </Link>

        {/* Home + Competitions (top-level) */}
        {PRIMARY.slice(0, 2).map((item) => (
          <RailLink key={item.href} item={item} active={isActive(item.href)} />
        ))}

        {/* Community group — header + nested destinations (Spaces, Resources, Directory) */}
        <RailHeader label="Community" icon={MessagesSquare} color="#3f78d6" />
        <div className="mb-1 ml-3 flex flex-col gap-0.5 border-l border-white/10 pl-2">
          {COMMUNITY_SUB.map((item) => (
            <RailSubLink key={item.href} item={item} active={subActive(item.href)} />
          ))}
        </div>

        {/* Academy group — header + nested destinations (Training, Mentoring, Coaching, Hosting) */}
        <RailHeader label="Academy" icon={GraduationCap} color="#dda33b" />
        <div className="mb-1 ml-3 flex flex-col gap-0.5 border-l border-white/10 pl-2">
          {academySub.map((item) => (
            <RailSubLink key={item.href} item={item} active={subActive(item.href)} />
          ))}
        </div>
      </aside>

      {/* Mobile bottom tab bar — 5 primary tabs; secondary destinations reached
          from each section's landing page. */}
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

// A non-clickable section label (Community / Academy). Its destinations live as
// nested RailSubLinks beneath it.
function RailHeader({ label, icon: Icon, color }: { label: string; icon: typeof Home; color: string }) {
  return (
    <div className="mt-2 flex items-center gap-3 px-3 pb-0.5 pt-1 font-subheading text-[12px] font-semibold uppercase tracking-[0.12em] text-white/45">
      <Icon className="h-[15px] w-[15px]" style={{ color }} />
      {label}
    </div>
  )
}

function RailLink({ item, active }: { item: Item; active: boolean }) {
  const { label, href, icon: Icon, color } = item
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-[10px] px-3 py-2.5 font-subheading text-[15px] font-medium transition-colors ${
        active ? 'bg-white/10 text-white' : 'text-[#aebbd6] hover:bg-white/5 hover:text-white'
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
        active ? 'bg-white/10 text-white' : 'text-[#aebbd6] hover:bg-white/5 hover:text-white'
      }`}
    >
      <Icon className="h-4 w-4" style={{ color }} />
      {label}
    </Link>
  )
}
