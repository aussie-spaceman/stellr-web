// ─── Standard campaign page copy ─────────────────────────────────────────────
//
// The campaign equivalent of the constants at the top of the event detail page.
// Kept here rather than in Sanity so every campaign makes the same promises, and
// separate from the event copy because most of the event wording is bound to a
// venue and a single day — campaigns have neither.
//
// Deliberate differences from the event page, each load-bearing:
//
//   • Campaigns are entered as a GROUP, never by an individual student. The
//     group can be registered by a teacher, a mentor, or a student manager.
//   • Campaigns are freemium, not free: membership IS required, and the
//     entry-level Educator tier costs $0. "Free with membership" is the accurate
//     phrasing and is used verbatim on the page — do not soften it to "free to
//     enter", which loses the membership requirement.
//   • There is no travel, venue, meal, t-shirt or chaperone story to tell, and
//     no progression to the Congress: the Educator tier's competition
//     engagement is written judging feedback on an optional submission.
//
// FAQ shape mirrors the event page: `a` renders, `text` is the plain-text twin
// serialised into FAQPage JSON-LD. Keep the two in step — schema that disagrees
// with the visible copy is treated as spam by search and answer engines.

import { gradeBand, type GradeBandInput } from './grade-band'

/**
 * Standard eligibility wording. The audience clause comes from the campaign's
 * grade band (lib/grade-band.ts), exactly as on the event page, so a middle
 * school campaign cannot inherit the high school range. Everything after it is
 * constant — and differs from the event copy on both counts that matter:
 * groups only, and a student manager may be the one who registers.
 *
 * Takes the document rather than its `gradeLevel` alone: the band can be an
 * explicit `gradeMin`/`gradeMax` override, and passing one field would silently
 * drop it.
 */

export function campaignEligibilityCopy(campaign: GradeBandInput): string {
  return (
    `Open to all ${gradeBand(campaign).audience}. The Classroom Qualifier is entered as a group rather than ` +
    'by individual students, in teams of 2–12 — a teacher, mentor or student manager registers the group, and ' +
    'schools can enter as many groups as they like.'
  )
}

/**
 * What every campaign includes: the free Educator membership tier, per the 2027
 * membership ladder. Written as public copy rather than the internal tier names
 * ("Campaign Guide Teacher BASIC"), but matched line-for-line to that tier.
 */
export const CAMPAIGN_INCLUDED: string[] = [
  'Annual Stellr Educator membership for teachers and students — always free',
  'The curriculum’s Request for Proposal (RFP) and Mission Handbook, abridged editions',
  'Teacher curriculum guide, with 4-week and 10-week indicative schedules',
  'Student curriculum guide and assessment tools',
  'Optional proposal submission, with written feedback from our judging panel',
]

/**
 * The upsell beneath the list, in the flyer's own framing. Names the paid tiers
 * without prices; the link goes to /membership, which was realigned to the 2027
 * flyer and is safe to point campaign traffic at again (it previously was not).
 */
export const CAMPAIGN_INCLUDED_NOTE =
  'Stellr material is always available for free. Catalyst, Innovator and Trailblazer ' +
  'memberships add deeper teacher support, PD hours and extra student benefits.'

/** Where CAMPAIGN_INCLUDED_NOTE's "Compare memberships" link points. */
export const CAMPAIGN_INCLUDED_NOTE_HREF = '/membership'

/** The campaign arc, start to finish — the counterpart to the event-day steps. */
export const CAMPAIGN_STEPS: { title: string; body: string }[] = [
  {
    title: 'Register your group',
    body: 'A teacher, mentor or student manager registers the group and gets access to your Qualifier workspace.',
  },
  {
    title: 'Run the workshops with your group',
    body: 'Use the curriculum’s workshop slides and starter pack from your Qualifier workspace to get your students up to speed.',
  },
  {
    title: 'Develop your design and write it up',
    body: 'Groups work at their own pace — typically 4–10 weeks of class time — turning their ideas into a 10–20 page team proposal.',
  },
  {
    title: 'Submit a proposal before the deadline',
    body: 'Upload the finished proposal from your Qualifier workspace. You can replace it any time until the deadline.',
  },
  {
    title: 'Receive written judging feedback',
    body: 'Every proposal submitted before the deadline is read by our judging panel, who return written feedback to the group.',
  },
]

export const CAMPAIGN_FAQS: { q: string; a: string; text: string }[] = [
  {
    q: 'How are teams structured?',
    a: 'The Classroom Qualifier is entered as a group rather than by individual students, in teams of 2–12. A teacher, mentor or student manager registers the group, and a school can enter as many groups as it likes.',
    text: 'The Classroom Qualifier is entered as a group rather than by individual students, in teams of 2–12. A teacher, mentor or student manager registers the group, and a school can enter as many groups as it likes.',
  },
  {
    q: 'Is there a cost to take part?',
    a: 'No. Entering the Classroom Qualifier requires a Stellr membership, and the entry-level Educator membership is free — it is included for every group and covers the core curriculum for both teachers and students. Paid tiers are optional and add more.',
    text: 'No. Entering the Classroom Qualifier requires a Stellr membership, and the entry-level Educator membership is free — it is included for every group and covers the core curriculum for both teachers and students. Paid tiers are optional and add more.',
  },
  {
    q: 'This seems like a really challenging activity! What are the preparation expectations?',
    a: 'Nothing beforehand. Everything your group needs comes with the curriculum — the RFP, the Mission Handbook, workshop material and the teacher and student guides. You do not need to be a specialist engineer or scientist to run it.',
    text: 'Nothing beforehand. Everything your group needs comes with the curriculum — the RFP, the Mission Handbook, workshop material and the teacher and student guides. You do not need to be a specialist engineer or scientist to run it.',
  },
  {
    q: 'How much time does the Classroom Qualifier take?',
    a: 'Groups work at their own pace rather than to a fixed timetable — typically 4–10 weeks of class time. Your Educator membership includes both a 4-week and a 10-week indicative schedule, so you can fit the curriculum to the time you actually have.',
    text: 'Groups work at their own pace rather than to a fixed timetable — typically 4–10 weeks of class time. Your Educator membership includes both a 4-week and a 10-week indicative schedule, so you can fit the curriculum to the time you actually have.',
  },
  {
    q: 'What do we submit, and how?',
    a: 'Each group submits one 10–20 page team proposal through its Qualifier workspace, before the deadline. You can replace the file as many times as you like up to that point, so an early upload is never a commitment.',
    text: 'Each group submits one 10–20 page team proposal through its Qualifier workspace, before the deadline. You can replace the file as many times as you like up to that point, so an early upload is never a commitment.',
  },
  {
    q: 'What happens after we submit?',
    a: 'Our judging panel reads every proposal submitted before the deadline and returns written feedback to the group.',
    text: 'Our judging panel reads every proposal submitted before the deadline and returns written feedback to the group.',
  },
  {
    q: 'What if our group can’t finish?',
    a: 'Let us know. There is no penalty for withdrawing from the Classroom Qualifier, and the material your group has already been given stays available to you.',
    text: 'Let us know. There is no penalty for withdrawing from the Classroom Qualifier, and the material your group has already been given stays available to you.',
  },
]
