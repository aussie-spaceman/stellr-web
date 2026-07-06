// Server-safe presentational primitives for Spaces (no client hooks).
// Access badges, theme dots/icons, tier pills, role pills.
import { Globe, Lock, EyeOff } from 'lucide-react'
import { tierGroupOf, TIER_GROUP_COLOR } from '@/lib/tiers'
import type { SpaceAccessType, SpaceRole, SpaceTheme } from '@/lib/spaces'

// ─── Access type ─────────────────────────────────────────────────────────────
export const ACCESS_META: Record<
  SpaceAccessType,
  { label: string; color: string; tint: string; icon: typeof Globe; blurb: string }
> = {
  open:    { label: 'Open',    color: '#1FA97A', tint: '#EDFAF4', icon: Globe,  blurb: 'Anyone in the community can join and post.' },
  private: { label: 'Private', color: '#E0922F', tint: '#FBEFDD', icon: Lock,   blurb: 'Visible to all, but joining is gated by your membership tier.' },
  secret:  { label: 'Secret',  color: '#7C5CFC', tint: '#F6F2FF', icon: EyeOff, blurb: 'Not publicly visible — if you can see it, others may not be able to.' },
}

export function AccessBadge({ type, size = 'md' }: { type: SpaceAccessType; size?: 'sm' | 'md' }) {
  const m = ACCESS_META[type]
  const Icon = m.icon
  const pad = size === 'sm' ? 'px-2 py-0.5 text-[10.5px]' : 'px-2.5 py-1 text-[11.5px]'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-subheading font-semibold uppercase tracking-[0.05em] ${pad}`}
      style={{ color: m.color, background: m.tint }}
    >
      <Icon className="h-3 w-3" /> {m.label}
    </span>
  )
}

// ─── Theme accent (the rounded-square space icon + the small banner dot) ──────
export const THEME_COLOR: Record<SpaceTheme, string> = {
  space:    '#7C5CFC',
  enviro:   '#1FA97A',
  campaign: '#E0922F',
  college:  '#16B6C4',
}

/** Small rounded-square dot (banner / table). */
export function ThemeDot({ theme, size = 18 }: { theme: SpaceTheme; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-[6px]"
      style={{ width: size, height: size, background: THEME_COLOR[theme] }}
      aria-hidden
    />
  )
}

/** Space icon: tinted rounded square with a theme-colour inner square (card head). */
export function SpaceIcon({ theme, size = 40 }: { theme: SpaceTheme; size?: number }) {
  const color = THEME_COLOR[theme]
  const inner = Math.round(size * 0.4)
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[11px]"
      style={{ width: size, height: size, background: `${color}1F` }}
      aria-hidden
    >
      <span className="rounded-[5px]" style={{ width: inner, height: inner, background: color }} />
    </span>
  )
}

// ─── Tier pill ────────────────────────────────────────────────────────────────
export function TierPill({ name }: { name: string }) {
  const group = tierGroupOf(name)
  const c = group ? TIER_GROUP_COLOR[group] : { fg: '#5C637E', bg: '#EEF0F6' }
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-subheading font-semibold"
      style={{ color: c.fg, background: c.bg }}
    >
      {name}
    </span>
  )
}

// ─── Role pill (Admin / Moderator; plain Member is omitted by callers) ─────────
// Spaces have three permission types: Stellr Admin, Moderator, Member.
const ROLE_META: Record<SpaceRole, { label: string; fg: string; bg: string } | null> = {
  admin:     { label: 'Admin',     fg: '#2C53C6', bg: '#EAF0FE' },
  moderator: { label: 'Moderator', fg: '#6A45E0', bg: '#F1ECFF' },
  member: null,
}

export function RolePill({ role }: { role: SpaceRole }) {
  const m = ROLE_META[role]
  if (!m) return null
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-subheading font-semibold uppercase tracking-[0.05em]"
      style={{ color: m.fg, background: m.bg }}
    >
      {m.label}
    </span>
  )
}
