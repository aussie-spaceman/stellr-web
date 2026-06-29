// @stellr/web-ui — Tier Shading by Age Bracket.
// A reusable colour system that codes Stellr's three audiences (age brackets)
// with one hue each, and gives each tier within a bracket its own shade
// (lightest = free/base tier, deepest = top tier).
//
// Values live in design/tokens.json → styles/tokens.css as CSS custom properties
// (--bracket-*, --tier-*). These helpers return token *references* (var(...) /
// color-mix(...)) so no raw hex appears in component code.
import * as React from 'react'
import { cn } from './primitives'

export type BracketId = 'school' | 'college' | 'adult'
export type TierId =
  | 'explorer' | 'pathfinder' | 'scholar'
  | 'alumni' | 'contributor' | 'counselor'
  | 'educator' | 'catalyst' | 'innovator' | 'trailblazer'

/** Tiers in light→deep order, grouped by bracket. */
export const TIER_IDS_BY_BRACKET: Record<BracketId, TierId[]> = {
  school: ['explorer', 'pathfinder', 'scholar'],
  college: ['alumni', 'contributor', 'counselor'],
  adult: ['educator', 'catalyst', 'innovator', 'trailblazer'],
}

export const BRACKET_LABELS: Record<BracketId, string> = {
  school: 'High-school students',
  college: 'College students',
  adult: 'Adults · educators',
}

/** The tier's identity shade, e.g. `var(--tier-catalyst)`. */
export function tierShade(id: TierId): string {
  return `var(--tier-${id})`
}

/** The selected/featured glow colour for a tier — its shade at 0.5 alpha. */
export function tierGlow(id: TierId): string {
  return `color-mix(in srgb, var(--tier-${id}) 50%, transparent)`
}

// Some tier shades are too light for legible white button text (the base/free
// shades and Catalyst's teal). For solid CTA buttons, use a contrast-safe fill:
// the tier's own shade where it's dark enough, else the deeper bracket tone of
// the same hue. The card strip/price keep the true tier shade — only the button
// darkens — so each tier still reads as its own colour.
const TIER_BUTTON_VAR: Record<TierId, string> = {
  explorer: 'var(--bracket-school-deep)',
  pathfinder: 'var(--tier-pathfinder)',
  scholar: 'var(--tier-scholar)',
  alumni: 'var(--bracket-college-deep)',
  contributor: 'var(--tier-contributor)',
  counselor: 'var(--tier-counselor)',
  educator: 'var(--bracket-adult-deep)',
  catalyst: 'var(--bracket-adult-deep)',
  innovator: 'var(--tier-innovator)',
  trailblazer: 'var(--tier-trailblazer)',
}

/** A solid button fill for a tier that keeps AA contrast with white text. */
export function tierButtonColor(id: TierId): string {
  return TIER_BUTTON_VAR[id]
}

export interface BracketPalette {
  /** Primary accent (active pill/tab, audience eyebrow, icon colour). */
  base: string
  /** Soft fill behind the accent (icon chips, panels, selected-row washes). */
  tint: string
  /** Hover / pressed state of bracket-accented controls. */
  deep: string
}

export function bracketPalette(b: BracketId): BracketPalette {
  return {
    base: `var(--bracket-${b})`,
    tint: `var(--bracket-${b}-tint)`,
    deep: `var(--bracket-${b}-deep)`,
  }
}

/* ── BracketShadeKey ──────────────────────────────────────────────────────── */
// A legend of the three ramps: per bracket, a contiguous row of tier-shade
// chips (light→deep) + the bracket label. Useful anywhere tiers are compared.
export function BracketShadeKey({
  label = 'Tier shades by age bracket',
  className,
}: {
  label?: string
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-7 gap-y-3.5', className)}>
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-content-faint">{label}</span>
      {(Object.keys(TIER_IDS_BY_BRACKET) as BracketId[]).map((b) => (
        <div key={b} className="flex items-center gap-[9px]">
          <span className="flex rounded-[5px] overflow-hidden border border-black/[0.06]">
            {TIER_IDS_BY_BRACKET[b].map((t) => (
              <span key={t} className="w-5 h-3.5" style={{ background: tierShade(t) }} aria-hidden="true" />
            ))}
          </span>
          <span className="text-[13px] text-content-secondary">{BRACKET_LABELS[b]}</span>
        </div>
      ))}
    </div>
  )
}
