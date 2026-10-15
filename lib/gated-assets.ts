// Gated downloads — the full files behind the email gate.
//
// SERVER-ONLY. A gated file is never linked from a page: the visitor asks for
// it by email, and the email carries a signed link (it does not expire) to
// /api/asset-request/download, which checks the signature and sends the file
// from private storage. The storage paths below therefore never reach a
// browser, an RSC payload or client JS.
import 'server-only'

/** Private Supabase Storage bucket the full files live in — the same private
 *  bucket as community resources (lib/community.ts RESOURCES_BUCKET), under
 *  its own `gated-downloads/` prefix. */
export const GATED_BUCKET = 'community-resources'

export interface GatedAsset {
  /** Shown in the email and in HubSpot. */
  title: string
  /** Object path inside GATED_BUCKET. */
  storagePath: string
  /** Saved filename on download. */
  filename: string
  subject: string
  /** HubSpot activity note. */
  note: string
  /** Page the request comes from, for HubSpot. */
  pagePath: string
}

export const GATED_ASSETS = {
  'space-rfp-2026': {
    title: '2026 Space RFP',
    storagePath: 'gated-downloads/2026-10/space-rfp-2026-full.pdf',
    filename: 'Stellr-2026-Space-RFP.pdf',
    subject: 'Your example student RFP',
    note: 'Requested example student RFP (Curriculum page)',
    pagePath: '/curriculum',
  },
  'sponsorship-prospectus': {
    title: 'Sponsorship Prospectus',
    storagePath: 'gated-downloads/2026-10/sponsorship-prospectus.pdf',
    filename: 'Stellr-Sponsorship-Prospectus.pdf',
    subject: 'Your Stellr Sponsorship Prospectus',
    note: 'Requested Sponsorship Prospectus (Network / Why Stellr page)',
    pagePath: '/network',
  },
  'mission-handbook-2026': {
    title: '2026 Space Design Challenge — Mission Handbook',
    storagePath: 'gated-downloads/2026-10/mission-handbook-2026-excerpt-wm.pdf',
    filename: 'Stellr-2026-Mission-Handbook-Excerpt.pdf',
    subject: 'Your copy of the 2026 Mission Handbook',
    note: 'Requested 2026 Mission Handbook (Educators page)',
    pagePath: '/educators',
  },
  'student-presentation-2026': {
    title: '2026 Student Presentation (excerpt)',
    storagePath: 'gated-downloads/2026-10/student-presentation-2026-wm.pdf',
    filename: 'Stellr-2026-Student-Presentation-Excerpt.pdf',
    subject: 'Your copy of the 2026 Student Presentation',
    note: 'Requested 2026 Student Presentation (Educators page)',
    pagePath: '/educators',
  },
  'student-work-examples': {
    title: 'Examples of previous student work, from multiple Stellr events',
    storagePath: 'gated-downloads/2026-10/student-work-examples-wm.pdf',
    filename: 'Stellr-Student-Work-Examples.pdf',
    subject: 'Your examples of previous student work',
    note: 'Requested examples of previous student work (Network page)',
    pagePath: '/network',
  },
  'white-paper': {
    title: 'From “Soft Skills” to STEM Power Skills',
    storagePath: 'gated-downloads/2026-10/stem-power-skills-white-paper.pdf',
    filename: 'Stellr-STEM-Power-Skills-White-Paper.pdf',
    subject: 'Your white paper: From “Soft Skills” to STEM Power Skills',
    note: 'Requested white paper: From “Soft Skills” to STEM Power Skills (impact page)',
    pagePath: '/impact',
  },
} as const satisfies Record<string, GatedAsset>

export type GatedAssetKey = keyof typeof GATED_ASSETS

export function isGatedAssetKey(key: unknown): key is GatedAssetKey {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(GATED_ASSETS, key)
}
