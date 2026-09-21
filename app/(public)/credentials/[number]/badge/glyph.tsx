import { tokens } from '@/lib/tokens'
import type { CredentialTheme } from '@/lib/credentials-core'

// The badge shape for the edge renderer (satori): a ring in the theme colour
// around the brand Certificate glyph, wordmark below. Mirrors
// components/credentials/CredentialBadgeArt.tsx, which the edge runtime cannot
// import (Tailwind classes, @stellr/icons' React tree). Satori rules apply:
// every div with children is display:flex, and the icon is inline SVG.

export function badgeAccent(theme: CredentialTheme | null): string {
  switch (theme) {
    case 'space':         return tokens.color.spaceViolet
    case 'environmental': return tokens.color.enviroGreen
    case 'campaign':      return tokens.color.pathwayAmber
    default:              return tokens.color.primary
  }
}

export function BadgeGlyph({ size, accent }: { size: number; accent: string }) {
  const ring = Math.round(size * 0.035)
  const icon = Math.round(size * 0.3)
  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 9999,
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.15)',
        position: 'relative',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          // satori has no `inset` shorthand; spell the four sides out.
          top: size * 0.06, right: size * 0.06, bottom: size * 0.06, left: size * 0.06,
          borderRadius: 9999,
          border: `${ring}px solid ${accent}`,
          opacity: 0.9,
          display: 'flex',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: size * 0.16, right: size * 0.16, bottom: size * 0.16, left: size * 0.16,
          borderRadius: 9999,
          background: 'rgba(255,255,255,0.05)',
          display: 'flex',
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: size * 0.02, color: tokens.color.white }}>
        {/* @stellr/icons Certificate, inlined: 24px line, 1.8px stroke, currentColor */}
        <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="4" width="16" height="11" rx="2" />
          <path d="M8 9h8M8 12h5" />
          <circle cx="12" cy="18" r="2" />
          <path d="M10.6 19.4 10 22l2-1 2 1-.6-2.6" />
        </svg>
        <div style={{ display: 'flex', fontSize: Math.max(12, size * 0.075), fontWeight: 700, letterSpacing: size * 0.012, textTransform: 'uppercase' }}>
          Stellr
        </div>
        <div style={{ display: 'flex', fontSize: Math.max(10, size * 0.05), letterSpacing: size * 0.009, textTransform: 'uppercase', color: tokens.color.heroDim }}>
          Verified
        </div>
      </div>
    </div>
  )
}
