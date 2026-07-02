// Media-rollout manifest — single source of truth for the media components
// (T1–T6) across the public site. Mirrors the approved Drive sources locked on
// 2026-06-30 (see design_handoff_media_rollout + the "Photo Deployment" doc).
//
// Components read assets from here. An asset whose bytes are not yet hosted is
// marked `pending: true` (or has an empty `src`); components render a labelled
// placeholder for it and `flagMissing()` logs a dev warning, so unfinished
// media never ships silently as a broken <img>/<video>. After the transcode +
// resize pass writes files into /public, flip `pending` to false.
//
// Output-path conventions (honoured by the transcode pass, README §4):
//   videos  /videos/testimonial-<person>.mp4 · .poster.jpg · .en.vtt
//   photos  /media/<subject>-<width>.<ext>   (avif/webp/jpg @ 480/768/1200/1920)
//   pdfs    /files/<name>.pdf  (+ /files/<name>-preview.pdf for gated previews)

export type MediaPage =
  | '/'
  | '/competitions'
  | '/membership'
  | '/events'
  | '/about'
  | '/students'
  | '/educators'
  | '/mentors'
  | '/why-stellr'
  | '/curriculum'
  | '/academy'

/** Voice colour-coding for the T6 pull-quote wall (token classes, not hex). */
export type Audience = 'student' | 'educator' | 'mentor' | 'parent'

interface BaseAsset {
  id: string
  /** Bytes not yet produced/hosted → component shows a placeholder + is flagged. */
  pending?: boolean
}

export interface PhotoAsset extends BaseAsset {
  /** Base path without width/ext suffix, e.g. "/media/event-floor"; the
   *  component composes srcset from `widths`. Empty while pending. */
  src: string
  alt: string
  /** Required on student work (README §9). */
  credit?: string
  widths?: number[]
}

export interface VideoAsset extends BaseAsset {
  src: string // /videos/<file>.mp4
  poster: string // /videos/<file>.poster.jpg
  captions: string // /videos/<file>.en.vtt (WebVTT, required)
  title: string
}

export interface QuoteAsset extends BaseAsset {
  text: string
  name: string
  /** Role / cohort / where-they-are-now. */
  meta: string
  audience: Audience
  /** Optional link to the source film (pairs T6 text with T5/T2 footage). */
  clipHref?: string
}

export interface CompetitionAsset extends BaseAsset {
  title: string
  /** Page count for the preview card label; null if unknown. */
  pages: number | null
  thumbnail: string
  /** Open 2–3pp preview — ALWAYS visible, never gated (README §8). */
  previewHref: string
  gated: boolean
  /** Full PDF path (open) — used directly + as the post-gate download. */
  fileHref: string
  /** Registry key in /api/asset-request ASSETS map (gated only). */
  assetKey?: string
  credit?: string
}

const PHOTO_WIDTHS = [480, 768, 1200, 1920]

/* ─────────────────────────────────────────────────────────────────────────
 * Media host base. Empty (the default) → assets are self-hosted from the
 * Next.js /public dir via relative paths (/videos, /media, /files), served by
 * Vercel. To move bytes off Vercel later (Supabase public bucket, Cloudflare
 * R2, etc.): upload /public/{videos,media,files} to the bucket *preserving
 * those paths*, then set NEXT_PUBLIC_MEDIA_BASE_URL to its root — every video,
 * poster, caption, photo, PDF, cover and preview URL then points there. No
 * component changes (raw <picture>/<video>/<a> take absolute URLs directly, so
 * no next.config image-domain config is needed either).
 *   e.g. NEXT_PUBLIC_MEDIA_BASE_URL="https://media.stellreducation.org"
 * NEXT_PUBLIC_ so it inlines into client + server bundles alike.
 * ───────────────────────────────────────────────────────────────────────── */
const MEDIA_BASE = (process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? '').replace(/\/+$/, '')

/** Prefix a /public-relative media path with the configured host (if any). */
export function mediaUrl(path: string): string {
  return MEDIA_BASE ? `${MEDIA_BASE}${path}` : path
}

/* ─────────────────────────────────────────────────────────────────────────
 * The 7 approved "WEBSITE QUOTES" (page 1 of the Written Testimonials doc).
 * Verbatim. Audience drives the T6 card colour.
 * ───────────────────────────────────────────────────────────────────────── */
export const QUOTES: Record<string, QuoteAsset> = {
  'hunter-dobson': {
    id: 'hunter-dobson',
    text: 'To my surprise I even ended up winning the award for the best overall teammate and competitor. I thought it was such an incredible experience… to improve my network and familiarity with the work environment!',
    name: 'Hunter Dobson',
    meta: '2026 Nevada Participant',
    audience: 'student',
  },
  '2023-student': {
    id: '2023-student',
    text: "I do this competition just because it's like a great way to experience other schools and other people's intelligence and hear ideas from other people.",
    name: 'Competition Participant',
    meta: '2023 Student Participant',
    audience: 'student',
  },
  '2021-parent': {
    id: '2021-parent',
    text: "He's gotten the opportunity to have leadership roles and he's interacted with people from all over the world.",
    name: 'Competition Parent',
    meta: '2021 Parent',
    audience: 'parent',
  },
  'alvina-gakhokidze': {
    id: 'alvina-gakhokidze',
    text: 'The reason I joined the competition in the first place was because it was on the topic of space, which is something I never really learned about in high school.',
    name: 'Alvina Gakhokidze',
    meta: 'Former Participant & Current Mentor',
    audience: 'mentor',
  },
  'mitra-sainsbury': {
    id: 'mitra-sainsbury',
    text: 'What I find so exciting about space design competitions is how you are coming up with solutions for problems that do not have definitive answers yet, or haven’t even been conceptualized as problems.',
    name: 'Mitra Sainsbury',
    meta: '2022 Participant',
    audience: 'student',
  },
  'nahuel-de-bittencourt': {
    id: 'nahuel-de-bittencourt',
    text: 'I already had a very big interest in space at that time, but I soon found out that this competition was the best way to actually convert that interest into something useful.',
    name: 'Nahuel de Bittencourt',
    meta: 'Teacher, Multiple Events',
    audience: 'educator',
  },
  'jason-zibart': {
    id: 'jason-zibart',
    text: 'My son described it as the most intense, crazy and unbelievable group project he has ever been a part of… It wasn’t just the work that he loved, it was the complexity around managing all the tasks and people while working toward one goal. He is really looking forward to next year!',
    name: 'Jason Zibart',
    meta: '2025 South West Space Design Competition Parent',
    audience: 'parent',
  },
}

/* ─────────────────────────────────────────────────────────────────────────
 * Videos (the 16 approved clips; only the deployed subset is mapped). Bytes
 * pending until the transcode pass runs.
 * ───────────────────────────────────────────────────────────────────────── */
function video(id: string, title: string): VideoAsset {
  return {
    id,
    title,
    src: mediaUrl(`/videos/${id}.mp4`),
    poster: mediaUrl(`/videos/${id}.poster.jpg`),
    captions: mediaUrl(`/videos/${id}.en.vtt`),

  }
}

export const VIDEOS: Record<string, VideoAsset> = {
  'testimonial-mia-cox': video('testimonial-mia-cox', 'Mia Cox — participant testimonial'),
  'testimonial-noah-swingle': video('testimonial-noah-swingle', 'Noah Swingle — participant testimonial'),
  'testimonial-meleah-caron': video('testimonial-meleah-caron', 'Meleah Caron — participant testimonial'),
  'testimonial-david-shaw': video('testimonial-david-shaw', 'David Shaw — mission'),
  'testimonial-allyson-rose': video('testimonial-allyson-rose', 'Allyson Rose — participant testimonial'),
  'testimonial-alvina-gakhokidze': video('testimonial-alvina-gakhokidze', 'Alvina Gakhokidze — participant & mentor'),
  'testimonial-jeremiah-dibley': video('testimonial-jeremiah-dibley', 'Jeremiah Dibley — teacher (MVI_9290)'),
  'testimonial-willcox-teachers': video('testimonial-willcox-teachers', 'Maureen Lancaster & Praveen Payyadakathu — Willcox Unified School District'),
  'testimonial-apoorva-somani': video('testimonial-apoorva-somani', 'Apoorva Somani — red-team mentor (MVI_9316)'),
  'testimonial-sepp': video('testimonial-sepp', 'Joseph “Sepp” Sprietsma — College Career Pathways'),
  'testimonial-teacher': video('testimonial-teacher', 'Teacher — English & life skills in 24 hours'),
  'testimonial-tom-wilson': video('testimonial-tom-wilson', 'Tom Wilson — educator testimonial'),
}

/* ─────────────────────────────────────────────────────────────────────────
 * Competition PDFs. Free files render an open T4; gated files sit behind the
 * /api/asset-request modal (assetKey must be registered in that route's ASSETS).
 * ───────────────────────────────────────────────────────────────────────── */
export const COMPETITION: Record<string, CompetitionAsset> = {
  'previous-participant-work': {
    id: 'previous-participant-work',
    title: 'Previous Design Dossier',
    pages: null,
    thumbnail: '/files/previous-participant-work.cover.jpg',
    previewHref: '/files/previous-participant-work.pdf',
    gated: false,
    fileHref: '/files/previous-participant-work.pdf',
    credit: '100% high school student developed material',
  },
  'legacy-rfp-south-dakota-2025': {
    id: 'legacy-rfp-south-dakota-2025',
    title: 'Legacy RFP — South Dakota 2025',
    pages: null,
    thumbnail: '/files/legacy-rfp-south-dakota-2025.cover.jpg',
    previewHref: '/files/legacy-rfp-south-dakota-2025.pdf',
    gated: false,
    fileHref: '/files/legacy-rfp-south-dakota-2025.pdf',
    credit: 'Stellr',
  },
  'jsc-2025-program-book': {
    id: 'jsc-2025-program-book',
    title: '2025 JSC Event — Program Book',
    pages: null,
    thumbnail: '/files/jsc-2025-program-book.cover.jpg',
    previewHref: '/files/jsc-2025-program-book-preview.pdf',
    gated: true,
    fileHref: '/files/jsc-2025-program-book.pdf',
    assetKey: 'jsc-2025-program-book',
    credit: 'Stellr',
  },
  'jsc-2025-student-presentation': {
    id: 'jsc-2025-student-presentation',
    title: '2025 JSC Event — Student Presentation',
    pages: null,
    thumbnail: '/files/jsc-2025-student-presentation.cover.jpg',
    previewHref: '/files/jsc-2025-student-presentation-preview.pdf',
    gated: true,
    fileHref: '/files/jsc-2025-student-presentation.pdf',
    assetKey: 'jsc-2025-student-presentation',
    credit: 'Student team',
  },
  'south-west-2022-student-presentation': {
    id: 'south-west-2022-student-presentation',
    title: '2022 South West — Student Presentation',
    pages: null,
    thumbnail: '/files/south-west-2022-student-presentation.cover.jpg',
    previewHref: '/files/south-west-2022-student-presentation-preview.pdf',
    gated: true,
    fileHref: '/files/south-west-2022-student-presentation.pdf',
    assetKey: 'south-west-2022-student-presentation',
    credit: 'Student team',
  },
  'south-west-2025-rfp': {
    id: 'south-west-2025-rfp',
    title: '2025 South West — RFP',
    pages: null,
    thumbnail: '/files/south-west-2025-rfp.cover.jpg',
    previewHref: '/files/south-west-2025-rfp-preview.pdf',
    gated: true,
    fileHref: '/files/south-west-2025-rfp.pdf',
    assetKey: 'south-west-2025-rfp',
    credit: 'InSimEd',
  },
}

// Apply the media host base to competition file URLs (kept relative above for
// readability). thumbnail/previewHref/fileHref are all /public-relative paths.
for (const c of Object.values(COMPETITION)) {
  c.thumbnail = mediaUrl(c.thumbnail)
  c.previewHref = mediaUrl(c.previewHref)
  c.fileHref = mediaUrl(c.fileHref)
}

/* ─────────────────────────────────────────────────────────────────────────
 * Photos — my chosen deployment (the doc leaves photo placement to me). Base
 * paths only; the component composes srcset from PHOTO_WIDTHS. Bytes pending.
 * ───────────────────────────────────────────────────────────────────────── */
function photo(id: string, source: string, alt: string, credit?: string): PhotoAsset {
  // `source` records the approved Drive original this derives from (for the
  // transcode pass); not used at runtime.
  void source
  return { id, src: mediaUrl(`/media/${id}`), alt, credit, widths: PHOTO_WIDTHS }
}

export const PHOTOS: Record<string, PhotoAsset> = {
  // Home
  'home-hero': photo('home-hero', 'DSC_5544', 'Competition floor — student teams at work'),
  'home-strip-1': photo('home-strip-1', 'DSC_5526', 'A full room of participants and mentors'),
  'home-strip-2': photo('home-strip-2', 'IMG_9183', 'Students collaborating during a design session'),
  'home-strip-3': photo('home-strip-3', 'IMG_2741', 'Teams presenting their work'),
  // Home proof strip — 2026-07 feedback-doc replacements
  'home-biosphere2': photo('home-biosphere2', 'Drive 1NUyS7_k', 'Touring Biosphere2 in Arizona'),
  'home-florida-prep': {
    // Source is 1440px wide — no 1920 derivative exists.
    ...photo('home-florida-prep', 'Drive 1LnJt-bR', 'Preparing for an event in Florida'),
    widths: [480, 768, 1200],
  },
  'home-teamwork': photo('home-teamwork', 'Drive 1wmO0jBV', 'Teamwork makes successful STEM professionals'),
  'home-group-dynamics': photo('home-group-dynamics', 'Drive 1_D_0qIV', 'Group dynamics at play'),
  // Competitions
  'competitions-1': photo('competitions-1', 'IMG_9052', 'Collaboration - both in person and digital', 'Student team'),
  'competitions-2': photo('competitions-2', 'IMG_9215', 'Student learn 3D modelling as a core skill', 'Student team'),
  'competitions-3': photo('competitions-3', 'DSC_5501', 'Teams at the competition'),
  'competitions-ksc': photo('competitions-ksc', 'Drive 1dkLNSN9', 'Exploring Kennedy Space Center before an event'),
  // Membership
  'membership-hero': photo('membership-hero', 'DSC_5526', 'The room, full — the Stellr community'),
  // Events (gallery)
  'events-1': photo('events-1', 'DSC_5501', 'Future engineers learning the joys of early mornings'),
  'events-2': photo('events-2', 'DSC_5521', 'Collaboration = listening'),
  'events-3': photo('events-3', 'DSC_5752', 'Teamwork makes the dream work'),
  'events-4': photo('events-4', 'IMG_9201', 'Space constraints at an overnight event in Florida'),
  'events-5': photo('events-5', 'IMG_9197', 'Designers hard at work'),
  // About
  'about-award-1': photo('about-award-1', 'IMG_4014', 'Award-winner banner'),
  'about-award-2': photo('about-award-2', 'IMG_4015', 'Washington Achievement banner'),
  'about-team-1': photo('about-team-1', 'DSC_5529', 'The team and participants'),
  'about-team-2': photo('about-team-2', 'IMG_7685', 'Mentors with students'),
  // Students
  'students-hero': photo('students-hero', 'DSC_5740', 'Students at laptops during a design session'),
  'students-strip-1': photo('students-strip-1', 'IMG_9046', 'Student presenting work', 'Student team'),
  'students-strip-2': photo('students-strip-2', 'IMG_9060', 'Students reviewing their design', 'Student team'),
  // Educators
  'educators-1': photo('educators-1', 'DSC_5776', 'Adults and students collaborating'),
  'educators-2': photo('educators-2', 'IMG_7702', 'Structural-board design session'),
  // Mentors
  'mentors-1': photo('mentors-1', 'IMG_7700', 'Team delegation at the whiteboard'),
  'mentors-2': photo('mentors-2', 'IMG_2213', 'Mentors judging student presentations'),
  'mentors-3': photo('mentors-3', 'IMG_2260', 'Mentor reviewing a team submission'),
  // Why-Stellr
  'why-1': photo('why-1', 'DSC_5544', 'The scale of the competition floor'),
  'why-2': photo('why-2', 'DSC_5529', 'Participants and mentors together'),
  'why-3': photo('why-3', 'IMG_4014', 'Award-winner banner'),
  'why-4': photo('why-4', 'IMG_4015', 'Washington Achievement banner'),
  // Curriculum
  'curriculum-1': photo('curriculum-1', 'IMG_9215', '3D modelling on laptops', 'Student team'),
  'curriculum-2': photo('curriculum-2', 'IMG_9052', 'Preparing to pitch', 'Student team'),
  'curriculum-3': photo('curriculum-3', 'IMG_2283', 'Requirements analysis'),
  'curriculum-group-work': {
    // Source is 1440px wide — no 1920 derivative exists.
    ...photo('curriculum-group-work', 'Drive 1PPNwa3A', 'students work in large groups, learning group dynamics and communication'),
    widths: [480, 768, 1200],
  },
  'curriculum-ty-white': photo('curriculum-ty-white', 'Drive 1plUOEjF', 'Mr Ty White with students at a competition'),
  // Academy · Training
  'academy-mentoring-cohort': photo('academy-mentoring-cohort', 'Drive 1MN0KUFE', 'A Stellr mentoring cohort collaborating'),
  'academy-1': photo('academy-1', 'IMG_7700', 'Team delegation at the whiteboard'),
  'academy-2': photo('academy-2', 'IMG_7702', 'Structural-board design session'),
  'academy-3': photo('academy-3', 'DSC_5776', 'Adults and students collaborating'),
}

/* ─────────────────────────────────────────────────────────────────────────
 * Helpers
 * ───────────────────────────────────────────────────────────────────────── */

/** True when an asset's bytes aren't ready yet → render a placeholder. */
export function isPending(asset: BaseAsset | undefined | null): boolean {
  return !asset || asset.pending === true
}

/** Dev-only warning so a pending/missing asset is never shipped unnoticed. */
export function flagMissing(kind: string, id: string): void {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[media-manifest] ${kind} "${id}" is pending — rendering placeholder. Fill its bytes + flip pending:false.`)
  }
}

/** srcset/sizes helper for responsive photos. The JPEG *fallback* is capped at
 *  1200w so every fallback file stays within the §4b budget (the 1920 JPEG runs
 *  300–600KB); AVIF — what virtually every browser receives — still serves all
 *  widths at ~180KB, so large screens lose no quality. */
export function photoSrcSet(p: PhotoAsset, ext: 'avif' | 'webp' | 'jpg' = 'webp'): string {
  const widths = (p.widths ?? PHOTO_WIDTHS).filter((w) => ext !== 'jpg' || w <= 1200)
  return widths.map((w) => `${p.src}-${w}.${ext} ${w}w`).join(', ')
}
