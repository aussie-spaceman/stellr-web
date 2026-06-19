'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  Home, Trophy, MessageSquare, FolderOpen, Users,
  GraduationCap, Heart, Star, Radio,
} from 'lucide-react'

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
]

const MOBILE_PRIMARY: NavItem[] = [
  { label: 'Home',         href: '/home',               icon: Home          },
  { label: 'Competitions', href: '/events',             icon: Trophy        },
  { label: 'Community',    href: '/community',          icon: MessageSquare },
  { label: 'Academy',      href: '/community/training', icon: GraduationCap },
  { label: 'Directory',    href: '/community/members',  icon: Users         },
]

const NON_SPACE_PREFIXES = [
  '/community/resources', '/community/members', '/community/training',
  '/community/mentoring', '/community/coaching', '/community/hosting',
  '/community/events', '/community/sessions', '/community/search',
]

export function AppSidebar({ canHost = false }: { canHost?: boolean }) {
  const pathname = usePathname() ?? ''

  const isActive = (href: string) =>
    href === '/home' ? pathname === '/home' : pathname.startsWith(href)

  const spaceActive = (href: string) => {
    if (href === '/community') {
      return (
        pathname === '/community' ||
        (pathname.startsWith('/community/') && !NON_SPACE_PREFIXES.some((k) => pathname.startsWith(k)))
      )
    }
    return pathname.startsWith(href)
  }

  const academyItems = canHost ? ACADEMY_ITEMS : ACADEMY_ITEMS.filter((i) => i.href !== '/community/hosting')

  return (
    <>
      {/* ── Desktop sidebar rail ── */}
      <aside
        className="hidden lg:flex w-[210px] shrink-0 flex-col bg-midnight min-h-screen font-sans"
        style={{ flexShrink: 0 }}
      >
        {/* Logo */}
        <Link href="/home" className="block p-[20px_16px_16px]">
          <div className="inline-block bg-white rounded-[10px] px-3 py-2">
            <Image
              src="/images/logo-horiz-tight.svg"
              alt="Stellr"
              width={100}
              height={33}
              className="h-7 w-auto block"
            />
          </div>
        </Link>

        {/* Nav */}
        <nav className="flex-1 px-[10px] py-[8px] flex flex-col gap-0.5">
          {/* Top-level items */}
          {TOP_ITEMS.map((item) => (
            <SidebarLink key={item.href} item={item} active={isActive(item.href)} />
          ))}

          {/* Community section */}
          <SectionHeading label="Community" />
          {COMMUNITY_ITEMS.map((item) => (
            <SidebarLink key={item.href} item={item} active={spaceActive(item.href)} />
          ))}

          {/* Academy section */}
          <SectionHeading label="Academy" />
          {academyItems.map((item) => (
            <SidebarLink key={item.href} item={item} active={isActive(item.href)} />
          ))}
        </nav>
      </aside>

      {/* ── Mobile bottom tab bar ── */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-line bg-white px-2 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 lg:hidden">
        {MOBILE_PRIMARY.map(({ label, href, icon: Icon }) => {
          const active = isActive(href)
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              className="flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-1"
            >
              <Icon
                className="h-5 w-5"
                style={{ color: active ? '#3C6DF6' : '#6A708C' }}
              />
              <span
                className="text-[10px] font-sans"
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

function SectionHeading({ label }: { label: string }) {
  return (
    <div
      className="font-display font-bold uppercase tracking-[0.08em] text-[#4A567A]"
      style={{ fontSize: 10.5, padding: '14px 8px 4px' }}
    >
      {label}
    </div>
  )
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  const { label, href, icon: Icon } = item
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-[8px] px-[10px] py-[9px] text-[14px] leading-none transition-colors ${
        active
          ? 'bg-white/10 text-white font-semibold'
          : 'text-[#8B98C8] font-normal hover:bg-white/[0.06] hover:text-[#C3CBF0]'
      }`}
    >
      <Icon
        className="h-[18px] w-[18px] shrink-0"
        style={{ color: active ? '#ffffff' : '#6C77A6' }}
      />
      {label}
    </Link>
  )
}
