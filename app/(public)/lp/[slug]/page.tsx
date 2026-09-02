import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { LandingPage } from '@/components/lp/LandingPage'
import { getLandingPage, LANDING_PAGE_SLUGS } from '@/content/lp'
import { countLocations, fillCounts, getMapLocations } from '@/lib/locations'

/**
 * Audience landing pages.
 *
 * One route, one layout, one config per audience. Indexed and self-canonical
 * rather than noindex: the eight FAQ answers on each page are client-approved
 * copy worth ranking for, and Google Ad Grants judges the landing pages it
 * sends paid traffic to — a crawlable page with real answers on it is part of
 * the remediation, not a side effect of it.
 */

export function generateStaticParams() {
  return LANDING_PAGE_SLUGS.map((slug) => ({ slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const config = getLandingPage(slug)
  if (!config) return {}

  // The SEO description names how many locations we run, so it goes through the
  // same interpolation as the on-page copy. A meta description that disagrees
  // with the page it describes is the kind of drift this whole derivation exists
  // to prevent.
  const counts = countLocations(await getMapLocations())

  return {
    title: config.seo.title,
    description: fillCounts(config.seo.description, counts),
    alternates: { canonical: `/lp/${config.slug}` },
    openGraph: {
      title: config.seo.title,
      description: fillCounts(config.seo.description, counts),
      url: `/lp/${config.slug}`,
    },
  }
}

export default async function LandingPageRoute({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const config = getLandingPage(slug)
  if (!config) notFound()

  return <LandingPage config={config} />
}
