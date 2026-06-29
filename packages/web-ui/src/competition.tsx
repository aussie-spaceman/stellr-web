// @stellr/web-ui — competition page composites (also reusable on Membership etc.).
import * as React from 'react'
import { cn } from './primitives'
import { tierShade, tierGlow, tierButtonColor, type BracketId, type TierId } from './tier-shades'

function Arrow({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

/* ── StepCard ─────────────────────────────────────────────────────────────── */
export function StepCard({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="bg-white border border-line rounded-ds-card p-5">
      <div className="w-9 h-9 rounded-lg bg-primary-soft text-primary font-bold flex items-center justify-center mb-3">{n}</div>
      <p className="font-bold text-sm text-ink mb-1">{title}</p>
      <p className="text-sm text-content-secondary leading-relaxed">{body}</p>
    </div>
  )
}

/* ── PathwayCard ──────────────────────────────────────────────────────────── */
export type PathwayCardProps = {
  eyebrow: string
  name: string
  tagline: string
  headerClass: string
  rows: [string, string][]
  cta: { label: string; href: string; className: string }
  linkAs?: React.ElementType
}
export function PathwayCard({ eyebrow, name, tagline, headerClass, rows, cta, linkAs }: PathwayCardProps) {
  const Link = (linkAs ?? 'a') as React.ElementType
  return (
    <div className="border border-line rounded-panel overflow-hidden bg-white shadow-card flex flex-col">
      <div className={cn(headerClass, 'text-white px-6 py-6')}>
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-white/75">{eyebrow}</p>
        <p className="text-2xl font-bold mt-1">{name}</p>
        <p className="text-sm text-white/85 mt-1">{tagline}</p>
      </div>
      <div className="px-6 pb-6 pt-2 flex flex-col flex-1">
        {rows.map(([label, value], i) => (
          <div key={label} className={cn('flex justify-between gap-4 py-3.5', i < rows.length - 1 && 'border-b border-line-light')}>
            <span className="text-sm text-content-muted">{label}</span>
            <span className="text-sm font-semibold text-ink text-right">{value}</span>
          </div>
        ))}
        <Link href={cta.href} className={cn('mt-4 inline-flex items-center gap-2 font-semibold text-sm px-4 py-3 rounded-lg transition-colors self-start', cta.className)}>
          {cta.label} <Arrow />
        </Link>
      </div>
    </div>
  )
}

/* ── ThemeCard ────────────────────────────────────────────────────────────── */
export type ThemeCardProps = {
  name: string
  Icon: React.ElementType
  iconBg: string
  accent: string
  border: string
  headerBg: string
  briefBg: string
  blurb: string
  explore: string[]
  brief: string
}
export function ThemeCard({ name, Icon, iconBg, accent, border, headerBg, briefBg, blurb, explore, brief }: ThemeCardProps) {
  return (
    <div className={cn('bg-white border rounded-panel overflow-hidden', border)}>
      <div className={cn(headerBg, 'px-7 pt-7 pb-6')}>
        <div className="flex items-center gap-3">
          <span className={cn('w-11 h-11 rounded-xl text-white flex items-center justify-center', iconBg)}>
            <Icon size={22} />
          </span>
          <p className={cn('text-2xl font-bold', accent)}>{name}</p>
        </div>
        <p className="text-content-secondary mt-4 leading-relaxed">{blurb}</p>
      </div>
      <div className="px-7 pb-7 pt-4">
        <p className={cn('text-xs font-bold uppercase tracking-[0.05em] mb-3', accent)}>What students explore</p>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2.5">
          {explore.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-content-secondary">
              <span className={cn('font-bold leading-5', accent)}>·</span>
              {item}
            </li>
          ))}
        </ul>
        <p className={cn('mt-5 rounded-xl px-4 py-3 text-sm text-content-secondary leading-relaxed', briefBg)}>
          <strong className={accent}>Example brief:</strong> {brief}
        </p>
      </div>
    </div>
  )
}

/* ── TierCard ─────────────────────────────────────────────────────────────── */
// Two modes, chosen by whether `items` is supplied:
//  • feature mode (items present) — the original comparison card (competitions).
//  • select mode (no items)       — a compact, clickable tier selector with a
//    role eyebrow + price (membership explorer).
// The Tier-Shading system (deliverable B) layers on in either mode when a
// `bracket`/`tier`/`shade` is supplied: a top shade strip, a shade-coloured
// price, and — when `selected` — a 2px shade border + shade glow. With no
// shade props it falls back to the default primary styling.
export type TierCardProps = {
  name: string
  price: string
  /** Note beside the price in select mode, e.g. "per year" / "always". */
  priceNote?: string
  /** Subtitle under the header in feature mode. */
  accessNote?: string
  /** Uppercase eyebrow above the name in select mode, e.g. "Competition participant". */
  role?: string
  inheritsFrom?: string
  badge?: string
  featured?: boolean
  /** Feature rows. Omit to render the compact selector card. */
  items?: string[]
  /* Tier-Shading by age bracket (deliverable B) */
  bracket?: BracketId
  tier?: TierId
  /** Explicit shade override (a colour / token reference) instead of `tier`. */
  shade?: string
  selected?: boolean
  onSelect?: () => void
  /** Solid CTA button (select mode). Colour defaults to the tier's contrast-safe fill. */
  cta?: { label: string; href?: string; onClick?: () => void; color?: string }
}
function SelectBody({
  role, name, price, priceNote, resolvedShade,
}: { role?: string; name: string; price: string; priceNote?: string; resolvedShade?: string }) {
  return (
    <>
      {role && (
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-content-faint leading-[1.3] min-h-[14px] mb-[7px]">{role}</p>
      )}
      <p className="font-display font-semibold text-[20px] text-ink mb-[3px]">{name}</p>
      <p className="flex items-baseline gap-[5px]">
        <span
          className={cn('font-display font-semibold text-[22px]', !resolvedShade && 'text-primary')}
          style={resolvedShade ? { color: resolvedShade } : undefined}
        >
          {price}
        </span>
        {priceNote && <span className="text-xs text-content-faint">{priceNote}</span>}
      </p>
    </>
  )
}

export function TierCard({
  name, price, priceNote, accessNote, role, inheritsFrom, badge, featured, items,
  tier, shade, selected, onSelect, cta,
}: TierCardProps) {
  const resolvedShade = shade ?? (tier ? tierShade(tier) : undefined)
  const glow = shade
    ? `color-mix(in srgb, ${shade} 50%, transparent)`
    : tier
      ? tierGlow(tier)
      : undefined
  const isSelect = items === undefined
  // In select mode the card root is a div (so a CTA button can live inside
  // without nesting buttons); the info area becomes its own select button.
  const Wrapper = (!isSelect && onSelect != null ? 'button' : 'div') as React.ElementType
  const rootClickable = !isSelect && onSelect != null
  const ctaColor = cta?.color ?? (tier ? tierButtonColor(tier) : resolvedShade)
  const CtaTag = (cta?.href ? 'a' : 'button') as React.ElementType

  return (
    <Wrapper
      type={rootClickable ? 'button' : undefined}
      onClick={rootClickable ? onSelect : undefined}
      aria-pressed={rootClickable ? selected : undefined}
      className={cn(
        'relative w-full text-left rounded-ds-card bg-white overflow-hidden flex flex-col',
        rootClickable && 'cursor-pointer',
        !resolvedShade && featured ? 'border-2 border-primary shadow-featured' : 'border border-line',
      )}
    >
      {resolvedShade && (
        <span aria-hidden="true" className="absolute top-0 left-0 right-0 h-[5px]" style={{ background: resolvedShade }} />
      )}
      {resolvedShade && selected && (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-ds-card pointer-events-none"
          style={{ border: `2px solid ${resolvedShade}`, boxShadow: `0 18px 40px -28px ${glow}` }}
        />
      )}

      {badge && !isSelect && (
        <div className="bg-primary text-white text-center text-[10.5px] font-bold uppercase tracking-[0.06em] py-1.5">{badge}</div>
      )}

      {isSelect ? (
        <div className="flex flex-col flex-1">
          {onSelect != null ? (
            <button
              type="button"
              onClick={onSelect}
              aria-pressed={selected}
              className="text-left cursor-pointer px-[18px] pt-[21px] pb-[15px]"
            >
              <SelectBody role={role} name={name} price={price} priceNote={priceNote} resolvedShade={resolvedShade} />
            </button>
          ) : (
            <div className="px-[18px] pt-[21px] pb-[15px]">
              <SelectBody role={role} name={name} price={price} priceNote={priceNote} resolvedShade={resolvedShade} />
            </div>
          )}
          {cta && (
            <div className="px-[18px] pb-[18px] pt-0 mt-auto">
              <CtaTag
                href={cta.href}
                onClick={cta.onClick}
                type={cta.href ? undefined : 'button'}
                className="block w-full text-center cursor-pointer rounded-[9px] px-4 py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: ctaColor }}
              >
                {cta.label}
              </CtaTag>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="px-5 pt-4 pb-3.5 border-b border-line-light">
            <div className="flex justify-between items-baseline gap-2">
              <p className="font-bold text-ink">{name}</p>
              <p
                className={cn('font-bold text-sm', !resolvedShade && (price === 'Free' ? 'text-enviro-green' : 'text-ink'))}
                style={resolvedShade ? { color: resolvedShade } : undefined}
              >
                {price}
              </p>
            </div>
            {accessNote && <p className="text-xs text-content-muted mt-1">{accessNote}</p>}
          </div>
          <div className="px-5 pt-3.5 pb-5 flex flex-col gap-2.5">
            {inheritsFrom && (
              <p className="text-[11.5px] font-bold uppercase tracking-wide text-content-faint">Everything in {inheritsFrom}, plus</p>
            )}
            {(items ?? []).map((item) => (
              <p key={item} className="text-sm text-content-secondary leading-snug">{item}</p>
            ))}
          </div>
        </>
      )}
    </Wrapper>
  )
}

/* ── ProgressionGraphic ───────────────────────────────────────────────────── */
export type ProgressionNode = { label: string; labelClass: string; title: string; titleClass?: string; cardClass?: string; star?: boolean }
export function ProgressionGraphic({ heading, note, nodes }: { heading: string; note?: string; nodes: ProgressionNode[] }) {
  return (
    <div className="mt-7 border border-line rounded-panel p-6 bg-surface/40">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <p className="font-bold text-ink">{heading}</p>
        {note && (
          <span className="text-xs font-bold uppercase tracking-[0.05em] text-brand-gold-ink bg-pathway-amber-bg rounded-full px-3 py-1">{note}</span>
        )}
      </div>
      <div className="flex flex-wrap items-stretch gap-3">
        {nodes.map((node, i) => (
          <React.Fragment key={node.title}>
            <div className={cn('flex-1 min-w-[160px] rounded-ds-card p-4', node.cardClass ?? 'bg-white border border-line')}>
              <p className={cn('text-xs font-bold uppercase tracking-wide mb-1 flex items-center gap-1.5', node.labelClass)}>
                {node.star && <Star />} {node.label}
              </p>
              <p className={cn('text-sm font-bold', node.titleClass ?? 'text-ink')}>{node.title}</p>
            </div>
            {i < nodes.length - 1 && (
              <div className="flex items-center text-content-faint">
                <Arrow size={22} />
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

function Star({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7z" />
    </svg>
  )
}
