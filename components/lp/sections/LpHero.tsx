import Link from 'next/link'
import { Button, Hero } from '@stellr/web-ui'
import { ResponsivePhoto } from '@/components/sections/ResponsivePhoto'
import { PHOTOS } from '@/lib/media-manifest'
import { LpCta } from '@/components/lp/LpTracking'
import type { LandingPageConfig } from '@/content/lp/types'

/**
 * The landing page hero.
 *
 * Mounts the shared `Hero` rather than rebuilding it. The handoff specified a
 * three-stop radial gradient and a scatter of star dots at fixed pixel offsets;
 * the shared Hero owns the hero treatment for eight other public pages, and a
 * landing page is not the place to fork it. Its `pill` prop already renders the
 * theme chip + eyebrow row the handoff drew by hand, so that is what it uses.
 *
 * The photo sits in a framed, captioned card on the navy — never full-bleed
 * behind the type. That is what makes candid event photography work here: it
 * reads as evidence rather than as stock texture, and needs no gradient scrim.
 */
export function LpHero({
  config, eyebrow,
}: {
  config: LandingPageConfig
  /** Already interpolated with the derived state count. */
  eyebrow: string
}) {
  const { hero, theme, audience, slug } = config
  const photo = PHOTOS[hero.photoId]

  return (
    <Hero
      pill={{ accent: theme === 'enviro' ? 'Environmental' : 'Space', rest: eyebrow }}
      title={hero.headline}
      media={
        <div className="rounded-panel border border-white/[.12] bg-white/[.05] p-3.5">
          <ResponsivePhoto
            photo={photo}
            sizes="(max-width: 1023px) 100vw, 44vw"
            priority
            rounded={false}
            className="aspect-[4/3] rounded-ds-card"
          />
          <p className="mt-3 text-ds-meta text-hero-dim">{hero.imageCaption}</p>
        </div>
      }
    >
      <div className="mt-5 grid gap-5">
        <p className="text-[22px] font-semibold leading-[1.25] tracking-heading text-hero-dim">
          {hero.kicker}
        </p>
        <p className="max-w-[34em] text-lg leading-relaxed text-hero-lead [text-wrap:pretty]">
          {hero.body}
        </p>
        <div className="flex flex-wrap gap-3.5">
          <LpCta audience={audience} pageSlug={slug} location="hero" href="#reserve">
            {hero.primaryCta}
          </LpCta>
          <Button href="#faq" as={Link} variant="outlineWhite">
            {hero.secondaryCta}
          </Button>
        </div>
      </div>
    </Hero>
  )
}
