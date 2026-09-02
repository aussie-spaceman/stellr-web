import { ImageResponse } from 'next/og'
import { getLandingPage, LANDING_PAGE_SLUGS } from '@/content/lp'
import { tokens } from '@/lib/tokens'

/**
 * Per-audience social share card, drawn in code.
 *
 * The handoff listed "per-audience OG images (1200x630)" as an asset still to
 * be supplied. Generating them instead means the next six audience pages get
 * one for free the moment their config lands, and the card can never drift from
 * the headline it is advertising — it *is* the headline.
 *
 * Deliberately typographic: no photograph. A 1200x630 crop of a candid event
 * photo with text over it is unreadable at the size a share preview actually
 * renders, and the design system rules out full-bleed photography with type on
 * top anyway.
 */

export const alt = 'Stellr Education — Space Design Competitions'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export function generateStaticParams() {
  return LANDING_PAGE_SLUGS.map((slug) => ({ slug }))
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const config = getLandingPage(slug)

  const headline = config?.hero.headline ?? 'Space Design Competitions'
  const kicker = config?.hero.kicker ?? 'Real-world STEM for grades 9–12'
  const accent =
    config?.theme === 'enviro' ? tokens.color.enviroGreen : tokens.color.spaceViolet

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          // The site's own midnight gradient, so a shared card is recognisably
          // the same brand as the page it opens.
          background: `linear-gradient(180deg, ${tokens.color.midnight}, ${tokens.color.midnightDeep})`,
          color: '#FFFFFF',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 14, height: 14, borderRadius: 999, background: accent }} />
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: 3,
              textTransform: 'uppercase',
              color: tokens.color.heroDim,
            }}
          >
            Stellr Education
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div
            style={{
              fontSize: headline.length > 44 ? 60 : 72,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -1.5,
            }}
          >
            {headline}
          </div>
          <div style={{ fontSize: 32, fontWeight: 600, color: accent, lineHeight: 1.25 }}>
            {kicker}
          </div>
        </div>

        <div style={{ fontSize: 24, color: tokens.color.heroLead }}>
          stellreducation.org · Grades 9–12 · Scholarships available
        </div>
      </div>
    ),
    size,
  )
}
