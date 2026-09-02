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

const PAGES: LandingPageConfig[] = [firstRoboticsTeachers, homeschoolStudents]

export const LANDING_PAGES: Record<string, LandingPageConfig> = Object.fromEntries(
  PAGES.map((p) => [p.slug, p]),
)

export const LANDING_PAGE_SLUGS: string[] = PAGES.map((p) => p.slug)

export function getLandingPage(slug: string): LandingPageConfig | undefined {
  return LANDING_PAGES[slug]
}

export type { LandingPageConfig }
