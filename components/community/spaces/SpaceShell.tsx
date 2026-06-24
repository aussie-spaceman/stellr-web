import Link from 'next/link'
import type { ReactNode } from 'react'
import { ChevronLeft, Hash, Megaphone, FolderOpen, GraduationCap, Users } from 'lucide-react'
import { AccessBadge } from './badges'
import type { SpaceDetail } from '@/lib/spaces'

const SECTIONS = [
  { key: 'announcements', label: 'Announcements', icon: Megaphone },
  { key: 'resources', label: 'Resources', icon: FolderOpen },
  { key: 'training', label: 'Training', icon: GraduationCap },
  { key: 'members', label: 'Members', icon: Users },
] as const

interface Props {
  space: SpaceDetail
  /** The active channel slug, or a section key. */
  activeKey: string
  children: ReactNode
}

// In-space layout (screen 02): 252px channel rail on desktop, a horizontal
// scrolling chip bar on mobile, and a fluid main column. Each page renders its
// own header inside `children`.
export function SpaceShell({ space, activeKey, children }: Props) {
  const base = `/community/${space.slug}`

  return (
    <div className="lg:flex lg:gap-0">
      {/* ── Desktop channel rail ── */}
      <aside className="hidden w-[252px] shrink-0 border-r border-brand-border lg:block">
        <div className="px-4 py-5">
          <Link
            href="/community"
            className="mb-4 inline-flex items-center gap-1 text-xs text-brand-muted-soft hover:text-brand-muted"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> All spaces
          </Link>
          <h2 className="font-heading text-[17px] leading-tight text-brand-blue-dark">{space.name}</h2>
          <div className="mt-2 flex items-center gap-2">
            <AccessBadge type={space.access_type} size="sm" />
            <span className="text-xs text-brand-muted-soft">{space.memberCount} members</span>
          </div>

          <RailGroup label="Channels">
            {space.channels.map((c) => (
              <RailLink
                key={c.id}
                href={`${base}/c/${c.slug}`}
                active={activeKey === c.slug}
                icon={<Hash className="h-4 w-4" />}
                label={c.name}
              />
            ))}
          </RailGroup>

          <RailGroup label="Space">
            {SECTIONS.map((s) => (
              <RailLink
                key={s.key}
                href={`${base}/${s.key}`}
                active={activeKey === s.key}
                icon={<s.icon className="h-4 w-4" />}
                label={s.label}
              />
            ))}
          </RailGroup>
        </div>
      </aside>

      {/* ── Mobile compact header + chip bar ── */}
      <div className="lg:hidden">
        <div className="flex items-center gap-2 px-1 pb-2">
          <Link href="/community" className="text-brand-muted-soft" aria-label="All spaces">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h2 className="font-heading text-[16px] text-brand-blue-dark">{space.name}</h2>
          <AccessBadge type={space.access_type} size="sm" />
        </div>
        <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
          {space.channels.map((c) => (
            <Chip key={c.id} href={`${base}/c/${c.slug}`} active={activeKey === c.slug} label={`# ${c.name}`} />
          ))}
          {SECTIONS.map((s) => (
            <Chip key={s.key} href={`${base}/${s.key}`} active={activeKey === s.key} label={s.label} />
          ))}
        </div>
      </div>

      {/* ── Main column ── */}
      <main className="min-w-0 flex-1 lg:px-8 lg:py-6">{children}</main>
    </div>
  )
}

function RailGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-5">
      <p className="mb-1 px-1 text-[10.5px] font-subheading font-semibold uppercase tracking-[0.08em] text-brand-muted-soft">
        {label}
      </p>
      <nav className="flex flex-col gap-0.5">{children}</nav>
    </div>
  )
}

function RailLink({
  href,
  active,
  icon,
  label,
}: {
  href: string
  active: boolean
  icon: ReactNode
  label: string
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-sm transition-colors ${
        active
          ? 'bg-[#EAF0FE] font-semibold text-[#2C53C6]'
          : 'text-brand-muted hover:bg-brand-canvas'
      }`}
    >
      <span className={active ? 'text-[#2C53C6]' : 'text-brand-muted-soft'}>{icon}</span>
      <span className="truncate">{label}</span>
    </Link>
  )
}

function Chip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`flex min-h-[36px] shrink-0 items-center whitespace-nowrap rounded-full px-3 text-sm transition-colors ${
        active ? 'bg-[#2C53C6] font-semibold text-white' : 'bg-brand-canvas text-brand-muted'
      }`}
    >
      {label}
    </Link>
  )
}
