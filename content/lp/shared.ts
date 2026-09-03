// Content that is identical on every audience landing page.
//
// It lives here rather than in each page config so a new audience page cannot
// drift from the others on facts that are not audience-specific. The handoff's
// own JSON had already drifted: four separate strings each asserted a different
// version of how many locations we run. Anything genuinely per-audience
// (`why.note`, testimonials, the hero, the form lead) stays in the page config.
//
// `{{locations}}` / `{{states}}` / `{{live}}` / `{{planned}}` are filled at
// render time from lib/locations.ts — see fillCounts(). Never type the numbers.

import type { LpGalleryShot, LpGlanceFact } from './types'

export const GLANCE_EYEBROW = 'At a glance'

export const GLANCE_FACTS: LpGlanceFact[] = [
  {
    value: 'Grades 9–12',
    label: 'Open to every student in these years',
  },
  {
    value: 'One or Two Day Events',
    label: 'We partner with leading colleges and aerospace facilities',
  },
  {
    value: 'Cost varies by event',
    // The newline is intentional and rendered — see GlanceAndLocations.
    label: 'Refer to event-specific pages for details.\nScholarships available!',
  },
]

export const MAP_HEADING = 'Where we run'

export const MAP_LEAD =
  '{{Locations}} locations across {{states}} states — {{live}} running now, ' +
  '{{planned}} in planning. Reserve a spot and we will point you to the one nearest you.'

export const GALLERY_HEADING = 'Real students, real competitions'
export const GALLERY_LEAD = 'Scenes from past Stellr design challenges.'

/**
 * The same four photos on every page. None of them may be a hero image — the
 * hero photo differs per audience and repeating it here would make the page
 * look like it has two of one photograph.
 */
export const GALLERY_SHOTS: LpGalleryShot[] = [
  { photoId: 'lp-gallery-1', caption: 'Students collaborate endlessly as they design and engineer' },
  { photoId: 'lp-gallery-2', caption: 'Company hard at work' },
  { photoId: 'lp-gallery-3', caption: 'Students of different ages collaborate together' },
  { photoId: 'lp-gallery-4', caption: 'A successful conclusion!' },
]

export const WHY_EYEBROW = 'Why design competitions'

export const FAQ_EYEBROW = 'Questions'
export const FAQ_HEADING = 'Before you ask us'

/**
 * The form shell. Everything here reads the same on every audience page; the
 * eyebrow, lead, points and defaults are per-page.
 *
 * The duration wording is deliberately "a short call" rather than the handoff's
 * "20-minute call": the live Motion calendar offers 15 or 30 minutes, and a page
 * that promises twenty next to a calendar that offers neither reads as careless.
 */
export const FORM_SHELL = {
  heading: 'Reserve a spot',
  submitLabel: 'Learn more now',
  reassurance: 'No payment now. This takes you to a calendar to book a short call.',
  callNote:
    'Every enquiry ends with a short call. You will pick a time straight after the ' +
    'form — no waiting on an email.',
  consentLabel: 'I agree to Stellr Education contacting me about this competition.',
  /**
   * Shown while the browser is on its way to the Motion calendar. Almost nobody
   * sees it — the redirect fires in the same tick — but it is what a slow
   * connection, a blocked navigation or a back-button return lands on, so it
   * carries a working link rather than being a spinner.
   */
  redirect: {
    heading: 'Taking you to the calendar',
    body:
      'Your details are saved. The calendar will ask for your name and email again. ' +
      'If nothing happens in a few seconds, use the link below.',
    manual: 'Open the calendar',
  },
  confirm: {
    eyebrow: 'Step 2 of 2',
    heading: 'Pick a time to talk',
    body:
      'Fifteen or thirty minutes with the person who runs the competitions. Bring your ' +
      'questions about dates, cost, travel and what your students would actually do. ' +
      'The calendar will ask for your name and email again.',
    cta: 'Choose a time',
    fallback:
      'Your details are saved. If the calendar does not open, email hello@stellreducation.org.',
  },
} as const
