// Media-rollout manifest — single source of truth for the media components
// (T1–T6) across the public site.
//
// SERVER-ONLY. Pages read assets here and pass each client component only the
// fields it renders, as props. A client component that imported this module
// would ship every entry below in its browser chunk, linked or not, so the
// types and pure helpers live in lib/media-helpers.ts (client-safe) and are
// re-exported here for server callers. Gated full files are not in this module
// at all: their storage locations are in lib/gated-assets.ts.
//
// An asset whose bytes are not yet hosted is marked `pending: true` (or has an
// empty `src`); components render a labelled placeholder for it and
// `flagMissing()` logs a dev warning, so unfinished media never ships silently.
//
// Output-path conventions (new files go to new, dated paths; an existing blob
// path is never overwritten):
//   videos  /videos/<yyyy-mm>/<name>.mp4 · .poster.jpg · .en.vtt
//   audio   /audio/<yyyy-mm>/<name>.m4a
//   photos  /media/<subject>-<width>.<ext>   (avif/jpg @ 480/768/1200/1920)
//   pdfs    /files/<yyyy-mm>/<name>.pdf · .cover.jpg (+ -preview.pdf for gated)
import 'server-only'
import {
  DEFAULT_PHOTO_CREDIT,
  PHOTO_WIDTHS,
  mediaDownloadUrl,
  mediaUrl,
  type AudioAsset,
  type CompetitionAsset,
  type PhotoAsset,
  type QuoteAsset,
  type VideoAsset,
} from './media-helpers'

export * from './media-helpers'

/* ─────────────────────────────────────────────────────────────────────────
 * Approved written quotes. Verbatim. Audience drives the T6 card colour.
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
    meta: 'Former Participant',
    audience: 'student',
  },
  'participant-2022': {
    id: 'participant-2022',
    text: 'What I find so exciting about space design competitions is how you are coming up with solutions for problems that do not have definitive answers yet, or haven’t even been conceptualized as problems.',
    name: 'Anonymous female participant',
    meta: '2022',
    audience: 'student',
  },
  'teacher-multiple-events': {
    id: 'teacher-multiple-events',
    text: 'I already had a very big interest in space at that time, but I soon found out that this competition was the best way to actually convert that interest into something useful.',
    name: 'Anonymous science teacher',
    meta: 'Commenting on experience across multiple events',
    audience: 'educator',
  },
  'jason-zibart': {
    id: 'jason-zibart',
    text: 'My son described it as the most intense, crazy and unbelievable group project he has ever been a part of… It wasn’t just the work that he loved, it was the complexity around managing all the tasks and people while working toward one goal. He is really looking forward to next year!',
    name: 'Jason Zibart',
    meta: '2025 Participant Parent',
    audience: 'parent',
  },
}

/* ─────────────────────────────────────────────────────────────────────────
 * Videos. Each lives under /videos/2026-10/ with its poster and WebVTT
 * captions (generated from the file itself and reviewed).
 * ───────────────────────────────────────────────────────────────────────── */
function video(id: string, title: string): VideoAsset {
  return {
    id,
    title,
    src: mediaUrl(`/videos/2026-10/${id}.mp4`),
    poster: mediaUrl(`/videos/2026-10/${id}.poster.jpg`),
    captions: mediaUrl(`/videos/2026-10/${id}.en.vtt`),
  }
}

export const VIDEOS: Record<string, VideoAsset> = {
  'testimonial-mia-cox': video('testimonial-mia-cox', 'Mia Cox — participant testimonial'),
  'testimonial-noah-swingle': video('testimonial-noah-swingle', 'Noah Swingle — participant testimonial'),
  'testimonial-mel-carson': video('testimonial-mel-carson', 'Mel Carson — previous participant'),
  'testimonial-allyson-rose': video('testimonial-allyson-rose', 'Allyson Rose — participant testimonial'),
  'testimonial-alvina-gakhokidze': video('testimonial-alvina-gakhokidze', 'Alvina Gakhokidze — former participant'),
  'testimonial-maureen-lancaster': video('testimonial-maureen-lancaster', 'Maureen Lancaster — Willcox Unified School District'),
  'testimonial-sepp-sprietsma': video('testimonial-sepp-sprietsma', 'Joseph “Sepp” Sprietsma — College Career Pathways'),
  'testimonial-erin-henderson': video('testimonial-erin-henderson', 'Erin Henderson — Teacher, 2022'),
  'testimonial-tom-wilson': video('testimonial-tom-wilson', 'Tom Wilson — educator testimonial'),
}

/* ─────────────────────────────────────────────────────────────────────────
 * Audio-only clips. The transcript is a separate PDF download.
 * ───────────────────────────────────────────────────────────────────────── */
export const AUDIO: Record<string, AudioAsset> = {
  'testimonial-jeremiah-dibley': {
    id: 'testimonial-jeremiah-dibley',
    title: 'Jeremiah Dibley — teacher',
    src: mediaUrl('/audio/2026-10/testimonial-jeremiah-dibley.m4a'),
    transcriptHref: mediaDownloadUrl('/files/2026-10/testimonial-jeremiah-dibley-transcript.pdf'),
  },
}

/* ─────────────────────────────────────────────────────────────────────────
 * Competition PDFs. Open files render a WorkCard with a preview and a direct
 * download. Gated files carry only an `assetKey` and no preview: the file sits
 * in private storage (lib/gated-assets.ts) and goes out only by email, as a
 * signed link.
 * ───────────────────────────────────────────────────────────────────────── */
export const COMPETITION: Record<string, CompetitionAsset> = {
  'student-work-dossier-2026': {
    id: 'student-work-dossier-2026',
    title: 'Previous Design Dossier',
    pages: 3,
    thumbnail: '/files/2026-10/student-work-dossier-2026.cover.jpg',
    previewHref: '/files/2026-10/student-work-dossier-2026.pdf',
    gated: false,
    fileHref: '/files/2026-10/student-work-dossier-2026.pdf',
    credit: '100% high school student developed material',
  },
  'space-rfp-2026-excerpt': {
    id: 'space-rfp-2026-excerpt',
    title: '2026 Space RFP (Excerpt)',
    pages: 2,
    thumbnail: '/files/2026-10/space-rfp-2026-excerpt.cover.jpg',
    previewHref: '/files/2026-10/space-rfp-2026-excerpt.pdf',
    gated: false,
    fileHref: '/files/2026-10/space-rfp-2026-excerpt.pdf',
    credit: 'Stellr',
  },
  'mission-handbook-2026': {
    id: 'mission-handbook-2026',
    title: '2026 Space Design Challenge — Mission Handbook',
    pages: 5,
    thumbnail: '/files/2026-10/mission-handbook-2026-excerpt-wm.cover.jpg',
    gated: true,
    assetKey: 'mission-handbook-2026',
    credit: 'Stellr',
  },
  'student-presentation-2026': {
    id: 'student-presentation-2026',
    title: '2026 Student Presentation (excerpt)',
    pages: 5,
    thumbnail: '/files/2026-10/student-presentation-2026-wm.cover.jpg',
    gated: true,
    assetKey: 'student-presentation-2026',
    credit: 'Participant team',
  },
  'student-work-examples': {
    id: 'student-work-examples',
    title: 'Examples of previous student work, from multiple Stellr events',
    pages: 3,
    thumbnail: '/files/2026-10/student-work-examples-v2-wm.cover.jpg',
    gated: true,
    assetKey: 'student-work-examples',
    credit: 'Previous participants',
  },
}

// Apply the media host base to competition file URLs (kept relative above for
// readability). Open files download; previews and covers open.
for (const c of Object.values(COMPETITION)) {
  c.thumbnail = mediaUrl(c.thumbnail)
  if (c.previewHref) c.previewHref = mediaUrl(c.previewHref)
  if (c.fileHref) c.fileHref = mediaDownloadUrl(c.fileHref)
}

/** The 2026 RFP excerpt as a plain link, for the RFP gate's open preview. */
export const RFP_2026_PREVIEW_HREF = COMPETITION['space-rfp-2026-excerpt'].previewHref as string

/* ─────────────────────────────────────────────────────────────────────────
 * Student work shown in the rotating showcase on /competitions and
 * /curriculum: 2026 work only, each with its own description.
 * ───────────────────────────────────────────────────────────────────────── */
export interface StudentWorkImage {
  src: string
  alt: string
}

export const STUDENT_WORK: StudentWorkImage[] = [
  {
    src: mediaUrl('/media/2026-10/student-work-2026-1.png'),
    alt: 'Student proposal slide, Location Justification: a lunar south-pole temperature map with the chosen crater circled, beside notes on resources and sunlight',
  },
  {
    src: mediaUrl('/media/2026-10/student-work-2026-2.png'),
    alt: 'Student proposal slide, Food Supply: two-floor plan of hydroponic growing towers with notes on crops, algae and water use',
  },
  {
    src: mediaUrl('/media/2026-10/student-work-2026-3.png'),
    alt: 'Student proposal slide, Main Base Layout: a site plan and 3D floor model of a lunar base with an emergency bunker below the first floor',
  },
]

/* ─────────────────────────────────────────────────────────────────────────
 * Photos. Base paths only; the component composes srcset from PHOTO_WIDTHS.
 * `alt` describes the image; `caption` is the visible caption where a strip
 * shows one (falls back to `alt`).
 * ───────────────────────────────────────────────────────────────────────── */
function photo(
  id: string,
  source: string,
  alt: string,
  opts: { caption?: string; credit?: string; widths?: number[] } = {},
): PhotoAsset {
  // `source` records the approved original this derives from (for the
  // transcode pass); not used at runtime.
  void source
  return {
    id,
    src: mediaUrl(`/media/${id}`),
    alt,
    caption: opts.caption,
    // The copyright notice rides along as a caption rather than being baked
    // into the pixels, so it defaults here rather than at each call site.
    credit: opts.credit ?? DEFAULT_PHOTO_CREDIT,
    widths: opts.widths ?? PHOTO_WIDTHS,
  }
}

export const PHOTOS: Record<string, PhotoAsset> = {
  // Home
  'home-strip-3': photo('home-strip-3', 'IMG_2741', 'A presenter at a whiteboard addressing a classroom of seated students', {
    caption: 'Teams presenting their work',
  }),
  'about-team-1': photo('about-team-1', 'DSC_5529', 'A mentor talking with a small group of students seated around him', {
    caption: 'Mentors and participants at work',
  }),
  // Curriculum
  'about-team-2': photo('about-team-2', 'IMG_7685', 'Students seated in a lecture hall listening to a presenter'),
  'curriculum-3': photo('curriculum-3', 'IMG_2283', 'Two students standing in front of a whiteboard covered in design notes', {
    caption: 'Requirements analysis',
  }),
  // Competitions
  'competitions-3': photo('competitions-3', 'DSC_5501', 'Students working on laptops around a table at a competition', {
    caption: 'Teams at the competition',
  }),
  // Membership
  'membership-mentor-review': photo('membership-mentor-review', 'DSC_5479', 'A mentor reviewing work with a participant'),
  'membership-room-full': photo('membership-room-full', 'IMG_7758', 'A full room of participants and mentors at a Stellr competition', {
    caption: 'The room, full — a Stellr competition',
  }),
  // Events (gallery)
  'events-1': photo('events-1', 'DSC_5501', 'Students working on laptops around a table at a competition', {
    caption: 'Future engineers learning the joys of early mornings',
  }),
  'events-2': photo('events-2', 'DSC_5521', 'A participant with a laptop listening during a team discussion', {
    caption: 'Collaboration = listening',
  }),
  'events-3': photo('events-3', 'DSC_5752', 'Three participants smiling together at an event', {
    caption: 'Teamwork makes the dream work',
  }),
  'events-4': photo('events-4', 'IMG_9201', 'Working late into the night at one of our residential events'),
  'events-5': photo('events-5', 'IMG_9197', 'Students sitting on the floor working on a 3D design on a laptop', {
    caption: 'Designers hard at work',
  }),
  // Educators
  'educators-2': photo('educators-2', 'IMG_7702', 'A student drawing a structural diagram on a whiteboard', {
    caption: 'Structural-board design session',
  }),
  // Mentors
  'mentors-2': photo('mentors-2', 'IMG_2213', 'A classroom of students facing a projected screen while team members work at the whiteboards', {
    caption: 'Mentors judging participant presentations',
  }),
  // Audience landing pages (/lp/[slug]) — client event photography supplied
  // with the 2026-09 landing-page handoff.
  'lp-gallery-3': photo('lp-gallery-3', 'handoff mentor-student', 'A mentor and a student reviewing work on a tablet together'),
}
