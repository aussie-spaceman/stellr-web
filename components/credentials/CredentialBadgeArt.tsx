import { Certificate } from '@stellr/icons'
import type { CredentialTheme } from '@/lib/credentials-core'

// The badge as it appears on the credential page: a ring in the theme colour
// around the brand Certificate glyph, wordmark below. The feed-post PNG
// (app/(public)/credentials/[number]/badge/route.tsx) redraws the same shape
// for the edge renderer, which cannot import this component.
//
// One glyph for every credential, on purpose: the badge says "Stellr verified",
// the title on the page says what for. Per-course artwork can override it later
// through `badge_path`.

const THEME_TEXT: Record<CredentialTheme | 'none', string> = {
  space:         'text-space-violet',
  environmental: 'text-enviro-green',
  campaign:      'text-pathway-amber',
  none:          'text-primary',
}

export function CredentialBadgeArt({
  theme,
  title,
  size = 200,
}: {
  theme: CredentialTheme | null
  title: string
  size?: number
}) {
  const accent = THEME_TEXT[theme ?? 'none']
  return (
    <div
      role="img"
      aria-label={`${title} — Stellr verified credential badge`}
      className={`relative flex items-center justify-center rounded-full bg-white/5 border border-white/15 ${accent}`}
      style={{ width: size, height: size }}
    >
      <div className="absolute inset-[6%] rounded-full border-[6px] border-current opacity-90" />
      <div className="absolute inset-[16%] rounded-full bg-white/5" />
      <div className="relative flex flex-col items-center gap-2 text-white">
        <Certificate size={Math.round(size * 0.3)} className={accent} aria-hidden="true" />
        <span className="font-display font-bold tracking-[0.18em] uppercase" style={{ fontSize: Math.max(10, size * 0.06) }}>
          Stellr
        </span>
        <span className="font-subheading tracking-[0.14em] uppercase text-hero-dim" style={{ fontSize: Math.max(8, size * 0.045) }}>
          Verified
        </span>
      </div>
    </div>
  )
}
