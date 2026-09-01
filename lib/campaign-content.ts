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

/**
 * Standard eligibility wording. The audience clause is derived from the
 * campaign's grade level, exactly as on the event page, so a middle school
 * campaign cannot inherit the high school range. Everything after it is
 * constant — and differs from the event copy on both counts that matter:
 * groups only, and a student manager may be the one who registers.
 */
export function campaignEligibilityCopy(gradeLevel?: string): string {
  const audience =
    gradeLevel === 'Middle School'
      ? 'middle school students (grades 6–8)'
      : gradeLevel === 'Both'
        ? 'middle and high school students (grades 6–12)'
        : 'high school students (grades 9–12)'
  return (
    `Open to all ${audience}. Campaigns are entered as a group rather than by individual ` +
    'students — a teacher, mentor or student manager registers the group, and schools can ' +
    'enter as many groups as they like.'
  )
}

/**
 * What every campaign includes: the free Educator membership tier, per the 2027
 * membership ladder. Written as public copy rather than the internal tier names
 * ("Campaign Guide Teacher BASIC"), but matched line-for-line to that tier.
 */
export const CAMPAIGN_INCLUDED: string[] = [
  'Annual Stellr Educator membership for teachers and students — always free',
  'The campaign Request For Proposal (RFP) and Mission Handbook, abridged editions',
  'Teacher campaign guide, with 4-week and 10-week indicative schedules',
  'Student campaign guide and assessment tools',
  'Optional proposal submission, with written feedback from our judging panel',
]

/**
 * The upsell beneath the list, in the flyer's own framing. Names the paid tiers
 * without prices and without linking to /membership — that page is known to be
 * out of date, and pointing campaign traffic at inaccurate pricing is worse than
 * saying less. Add the link when /membership is corrected.
 */
export const CAMPAIGN_INCLUDED_NOTE =
  'Stellr material is always available for free. Catalyst, Innovator and Trailblazer ' +
  'memberships add deeper teacher support, PD hours and extra student benefits.'

/** The campaign arc, start to finish — the counterpart to the event-day steps. */
export const CAMPAIGN_STEPS: { title: string; body: string }[] = [
  {
    title: 'Register your group',
    body: 'A teacher, mentor or student manager registers the group and gets access to your campaign workspace.',
  },
  {
    title: 'Run the workshops with your group',
    body: 'Use the theme workshop slides and starter pack from your campaign workspace to get your students up to speed.',
  },
  {
    title: 'Develop your design and write it up',
    body: 'Groups work at their own pace across the season, turning their ideas into a structured proposal.',
  },
  {
    title: 'Submit a proposal before the deadline',
    body: 'Upload the finished proposal from your campaign workspace. You can replace it any time until the deadline.',
  },
  {
    title: 'Receive written judging feedback',
    body: 'Every proposal submitted before the deadline is read by our judging panel, who return written feedback to the group.',
  },
]

export const CAMPAIGN_FAQS: { q: string; a: string; text: string }[] = [
  {
    q: 'How are teams structured?',
    a: 'Campaigns are entered as a group rather than by individual students. A teacher, mentor or student manager registers the group, and a school can enter as many groups as it likes.',
    text: 'Campaigns are entered as a group rather than by individual students. A teacher, mentor or student manager registers the group, and a school can enter as many groups as it likes.',
  },
  {
    q: 'Is there a cost to take part?',
    a: 'No. Taking part in a campaign requires a Stellr membership, and the entry-level Educator membership is free — it is included for every group and covers the core campaign material for both teachers and students. Paid tiers are optional and add more.',
    text: 'No. Taking part in a campaign requires a Stellr membership, and the entry-level Educator membership is free — it is included for every group and covers the core campaign material for both teachers and students. Paid tiers are optional and add more.',
  },
  {
    q: 'This seems like a really challenging activity! What are the preparation expectations?',
    a: 'Nothing beforehand. Everything your group needs arrives with the campaign — the RFP, the Mission Handbook, workshop material and the teacher and student guides. You do not need to be a specialist engineer or scientist to run one.',
    text: 'Nothing beforehand. Everything your group needs arrives with the campaign — the RFP, the Mission Handbook, workshop material and the teacher and student guides. You do not need to be a specialist engineer or scientist to run one.',
  },
  {
    q: 'How much time does a campaign take?',
    a: 'Groups work at their own pace across the season rather than to a fixed timetable. Your Educator membership includes both a 4-week and a 10-week indicative schedule, so you can fit the campaign to the time you actually have.',
    text: 'Groups work at their own pace across the season rather than to a fixed timetable. Your Educator membership includes both a 4-week and a 10-week indicative schedule, so you can fit the campaign to the time you actually have.',
  },
  {
    q: 'What do we submit, and how?',
    a: 'Each group submits one written proposal through its campaign workspace, before the campaign deadline. You can replace the file as many times as you like up to that point, so an early upload is never a commitment.',
    text: 'Each group submits one written proposal through its campaign workspace, before the campaign deadline. You can replace the file as many times as you like up to that point, so an early upload is never a commitment.',
  },
  {
    q: 'What happens after we submit?',
    a: 'Our judging panel reads every proposal submitted before the deadline and returns written feedback to the group.',
    text: 'Our judging panel reads every proposal submitted before the deadline and returns written feedback to the group.',
  },
  {
    q: 'What if our group can’t finish?',
    a: 'Let us know. There is no penalty for withdrawing from a campaign, and the material your group has already been given stays available to you.',
    text: 'Let us know. There is no penalty for withdrawing from a campaign, and the material your group has already been given stays available to you.',
  },
]
