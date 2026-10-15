// @stellr/web-ui Hero — the dark navy hero used across the public site.
// Midnight gradient + optional radial accent glow; all token-driven.
import * as React from 'react'
import { cn, InfoPill } from './primitives'

export function Hero({
  breadcrumb,
  pill,
  title,
  lead,
  pills,
  glow = true,
  media,
  children,
  className,
}: {
  breadcrumb?: string
  pill?: { accent: string; rest: string }
  title: React.ReactNode
  lead?: React.ReactNode
  pills?: string[]
  glow?: boolean
  /** T1 — optional media band beside the headline (photo, or poster-first
   *  video). The app supplies the element so this package stays framework-light.
   *  When present the hero becomes a two-column layout (not full-bleed). */
  media?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        // short: a phone held sideways is ~375px tall; keep the title and first
        // call to action on the first screen.
        'relative overflow-hidden bg-midnight text-white py-20 px-4 sm:px-6 lg:px-8 short:py-8',
        'bg-[linear-gradient(180deg,var(--color-midnight),var(--color-midnight-deep))]',
        className,
      )}
    >
      {/* A radial gradient, not a blurred circle: a 520px blur filter is costly
          to paint on low-end Android and looks the same. */}
      {glow && (
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 -right-36 w-[720px] h-[720px] bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--color-space-violet)_22%,transparent),transparent)]"
        />
      )}
      <div className="relative max-w-7xl mx-auto">
        <div className={cn(media ? 'grid gap-10 lg:grid-cols-2 lg:items-center' : undefined)}>
          <div>
            {breadcrumb && (
              <p className="text-hero-dim font-semibold uppercase tracking-widest text-sm mb-4 short:mb-2 short:text-xs">{breadcrumb}</p>
            )}
            {pill && (
              <div className="inline-flex items-center gap-3 mb-6 px-4 py-2 short:mb-3 short:py-1 rounded-full bg-white/5 border border-white/15 text-sm font-medium text-hero-lead">
                <span className="text-hero-dim">{pill.accent}</span>
                <span className="w-1 h-1 rounded-full bg-white/40" />
                <span>{pill.rest}</span>
              </div>
            )}
            <h1 className="text-4xl sm:text-5xl lg:text-ds-h1 font-bold tracking-display mb-6 max-w-3xl short:text-3xl short:mb-3">{title}</h1>
            {lead && <p className="text-lg text-hero-lead max-w-2xl leading-relaxed short:text-base short:leading-snug short:line-clamp-2">{lead}</p>}
            {pills && pills.length > 0 && (
              <div className="flex flex-wrap gap-3 mt-8 short:mt-4">
                {pills.map((p) => (
                  <InfoPill key={p}>{p}</InfoPill>
                ))}
              </div>
            )}
            {/* Pages pass their actions here with their own top margin; on a
                sideways phone pull them up so the first CTA is on screen. */}
            {children && <div className="short:[&>*]:mt-4">{children}</div>}
          </div>
          {media && <div className="w-full lg:justify-self-end">{media}</div>}
        </div>
      </div>
    </section>
  )
}
