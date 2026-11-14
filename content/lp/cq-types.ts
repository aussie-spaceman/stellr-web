// Classroom Qualifier curriculum landing pages (Nov 2026).
//
// A sibling of LandingPageConfig rather than an extension of it. The audience
// pages sell a live event and end in a booking call; these offer free
// curriculum and end in a curriculum request. Forcing one shape onto both would
// leave half the fields meaningless on each. Same template family, same section
// components where they fit, same registry and route.
//
// Copy source: "Handover: Classroom Qualifier website overhaul" (V2, 13 Nov
// 2026). Facts in its "Fixed facts" table are used verbatim. Prices and the
// standards list are never typed here: they come from membership_tiers and
// lib/pd-standards.ts at render time.

import type { LpFaqItem, LpTestimonial } from './types'

export type CqTheme = 'space' | 'enviro' | 'not_sure'

export type CqStudentsBand = '1-25' | '26-75' | '76-150' | '150+'

export interface CqStep {
  title: string
  body: string
}

export interface CurriculumLandingPageConfig {
  kind: 'curriculum'
  slug: string
  /** Written to HubSpot `lp_source_page`; also the handover's `lead_source` value. */
  leadSource: string
  /** Written to HubSpot `cq_window`. */
  window: '2026-27' | 'spring-2027'
  /** Keep event pages out of the index (handover: "noindex is fine"). */
  noindex: boolean
  seo: { title: string; description: string }
  hero: {
    eyebrow: string
    headline: string
    tagline: string
    positioning: string
    primaryCta: string
    /** Optional offer badge under the CTA (the MnCOSE booth code). */
    badge?: string
  }
  glance: { value: string; label: string }[]
  themes: {
    heading: string
    note: string
    cards: { theme: 'space' | 'enviro'; name: string; body: string }[]
  }
  included: { heading: string; lead: string; items: string[] }
  steps: { heading: string; items: CqStep[] }
  judging: {
    heading: string
    body: string
    /** The rubric's three criteria. Empty until the rubric is in the repo. */
    criteria: string[]
    results: string
  }
  offer?: {
    heading: string
    /** `{{catalystPrice}}` is filled from membership_tiers. */
    body: string
    linkLabel: string
    href: string
  }
  grant: { heading: string; body: string; cta: string }
  proof: {
    heading: string
    stats: { value: string; label: string }[]
    testimonials: LpTestimonial[]
  }
  form: {
    eyebrow: string
    heading: string
    lead: string
    submitLabel: string
    consentLabel: string
    success: {
      heading: string
      body: string
      /** The free Educator account is where the curriculum lives today. */
      accountCta: string
      upgrade?: { label: string; href: string; note: string }
    }
  }
  /** `{{standards}}` in an answer is filled from lib/pd-standards.ts. */
  faq: { heading: string; items: LpFaqItem[] }
  crossPromo?: { text: string; linkLabel: string; href: string }
  finalCta: { heading: string; body: string }
}
