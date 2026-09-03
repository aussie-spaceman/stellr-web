// Audience landing page content model.
//
// Deliberately a typed local config rather than a Sanity document type in the
// first instance: it is versioned, type-checked, reviewable in a PR, and ships
// today. The field names are chosen to map 1:1 onto a future Sanity
// `landingPage` type, so swapping the loader in ./index.ts is the whole
// migration and no section component has to change.
//
// Copy provenance rules (see docs/PLAN-landing-pages-2026-09-02.md §2):
//   • hero.headline / hero.kicker / why.reasons are verbatim from the client's
//     print flyers, Title Case included, so the page matches the ad creative.
//     Do not "correct" them to the design system's sentence case.
//   • Testimonials are verbatim from stellreducation.org.
//   • FAQ answers, form leads, why notes and gallery captions are
//     client-approved as written, phrasing quirks and all.

/** Who the visitor says they are. Drives the HubSpot `stellr_role` property. */
export type LpRole = 'teacher' | 'parent' | 'student'

/** Competition theme. Colour codes meaning, so this drives the accent. */
export type LpTheme = 'space' | 'enviro'

/** Analytics/HubSpot dimension. One value per audience page. */
export type LpAudience = 'first_robotics_teacher' | 'homeschool'

export interface LpReason {
  title: string
  body: string
}

export interface LpFaqItem {
  q: string
  a: string
}

/** A gallery card. `photoId` keys into lib/media-manifest PHOTOS. */
export interface LpGalleryShot {
  photoId: string
  caption: string
}

export interface LpTestimonial {
  quote: string
  who: string
}

export interface LpGlanceFact {
  value: string
  /** Gloss beneath the value. A newline renders as a line break. */
  label: string
}

export interface LandingPageConfig {
  slug: string
  audience: LpAudience
  /**
   * Which `LeadFormSource` the conversion fires as. Two exist because
   * lib/analytics.ts keys b2b/b2c off the source, and a teacher page and a
   * family page are not the same ad audience — LinkedIn should not fire on a
   * homeschool parent. Both map onto the single HubSpot `landing_page` source.
   */
  analyticsSource: 'landing_page_teacher' | 'landing_page_family'
  theme: LpTheme
  seo: { title: string; description: string }
  hero: {
    eyebrow: string
    headline: string
    kicker: string
    body: string
    /** Keys into lib/media-manifest PHOTOS. Never a gallery photo. */
    photoId: string
    imageCaption: string
    primaryCta: string
    secondaryCta: string
  }
  why: {
    eyebrow: string
    heading: string
    lead: string
    /** Per-audience by design: Teacher Grant Program vs scholarships. */
    note: string
    reasons: LpReason[]
  }
  gallery?: {
    heading: string
    lead: string
    shots: LpGalleryShot[]
  }
  testimonials?: LpTestimonial[]
  form: {
    eyebrow: string
    heading: string
    lead: string
    points: string[]
    submitLabel: string
    defaultRole: LpRole
    /** Prefilled group size. 6 for a teacher bringing a group, 1 for a family. */
    defaultStudents: number
    reassurance: string
    callNote: string
    consentLabel: string
    redirect: {
      heading: string
      body: string
      manual: string
    }
    confirm: {
      eyebrow: string
      heading: string
      body: string
      cta: string
      fallback: string
    }
  }
  faq: {
    eyebrow: string
    heading: string
    items: LpFaqItem[]
  }
}
