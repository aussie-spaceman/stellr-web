// Slug → landing page config registry.
//
// This is the whole management story for adding an audience page: write
// content/lp/<slug>.ts, register it here, ship. No layout work.
//
// When marketing needs to edit copy without a deploy, add a Sanity
// `landingPage` document type and swap getLandingPage() for a fetch. Because
// LandingPageConfig's field names already mirror that shape, no section
// component has to change.

import type { LandingPageConfig } from './types'
import { firstRoboticsTeachers } from './first-robotics-teachers'
import { homeschoolStudents } from './homeschool-students'
import type { CurriculumLandingPageConfig } from './cq-types'
import { mncose26 } from './mncose26'

const PAGES: LandingPageConfig[] = [firstRoboticsTeachers, homeschoolStudents]

export const LANDING_PAGES: Record<string, LandingPageConfig> = Object.fromEntries(
  PAGES.map((p) => [p.slug, p]),
)

// Classroom Qualifier curriculum pages: same route, different template
// (components/lp/CurriculumLandingPage.tsx). Kept in their own list so
// getLandingPage() — which /api/lp-lead validates against — never returns one.
const CURRICULUM_PAGES: CurriculumLandingPageConfig[] = [mncose26]

const CURRICULUM_BY_SLUG: Record<string, CurriculumLandingPageConfig> = Object.fromEntries(
  CURRICULUM_PAGES.map((p) => [p.slug, p]),
)

export const LANDING_PAGE_SLUGS: string[] = [
  ...PAGES.map((p) => p.slug),
  ...CURRICULUM_PAGES.map((p) => p.slug),
]

/** Slugs that belong in the sitemap: every page except a noindex one. */
export const INDEXABLE_LANDING_PAGE_SLUGS: string[] = [
  ...PAGES.map((p) => p.slug),
  ...CURRICULUM_PAGES.filter((p) => !p.noindex).map((p) => p.slug),
]

export function getCurriculumLandingPage(slug: string): CurriculumLandingPageConfig | undefined {
  return CURRICULUM_BY_SLUG[slug]
}

export function getLandingPage(slug: string): LandingPageConfig | undefined {
  return LANDING_PAGES[slug]
}

export type { LandingPageConfig, CurriculumLandingPageConfig }
