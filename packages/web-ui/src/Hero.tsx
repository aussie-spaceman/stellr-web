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
  children,
  className,
}: {
  breadcrumb?: string
  pill?: { accent: string; rest: string }
  title: React.ReactNode
  lead?: React.ReactNode
  pills?: string[]
  glow?: boolean
  children?: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'relative overflow-hidden bg-midnight text-white py-20 px-4 sm:px-6 lg:px-8',
        'bg-[linear-gradient(180deg,var(--color-midnight),var(--color-midnight-deep))]',
        className,
      )}
    >
      {glow && (
        <div
          aria-hidden
          className="pointer-events-none absolute -top-28 -right-20 w-[520px] h-[520px] rounded-full bg-space-violet/20 blur-3xl"
        />
      )}
      <div className="relative max-w-7xl mx-auto">
        {breadcrumb && (
          <p className="text-hero-dim font-semibold uppercase tracking-widest text-sm mb-4">{breadcrumb}</p>
        )}
        {pill && (
          <div className="inline-flex items-center gap-3 mb-6 px-4 py-2 rounded-full bg-white/5 border border-white/15 text-sm font-medium text-hero-lead">
            <span className="text-hero-dim">{pill.accent}</span>
            <span className="w-1 h-1 rounded-full bg-white/40" />
            <span>{pill.rest}</span>
          </div>
        )}
        <h1 className="text-4xl sm:text-5xl lg:text-ds-h1 font-bold tracking-display mb-6 max-w-3xl">{title}</h1>
        {lead && <p className="text-lg text-hero-lead max-w-2xl leading-relaxed">{lead}</p>}
        {pills && pills.length > 0 && (
          <div className="flex flex-wrap gap-3 mt-8">
            {pills.map((p) => (
              <InfoPill key={p}>{p}</InfoPill>
            ))}
          </div>
        )}
        {children}
      </div>
    </section>
  )
}
