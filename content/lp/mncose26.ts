import type { CurriculumLandingPageConfig } from './cq-types'

/**
 * MnCOSE26 booth page (MSU Mankato, 20–21 Nov 2026). Flyer B's QR code reaches
 * it via bit.ly/27-mncose with utm_source=mncose26, utm_medium=flyer and
 * utm_campaign=classroom-qualifier.
 *
 * Every fact below is from the V2 handover's "Fixed facts" table, verbatim
 * where it says so. Do not add numbers that are not in it.
 *
 * Open with the owner (handover §1): the fall window's submission deadline and
 * its feedback + awards date are both 1/31/27 as supplied. Shown as given.
 */
export const mncose26: CurriculumLandingPageConfig = {
  kind: 'curriculum',
  slug: 'mncose26',
  leadSource: 'mncose26',
  window: '2026-27',
  noindex: true,
  seo: {
    title: 'Free Engineering Curriculum for Grades 7–12 | Classroom Qualifier | Stellr',
    description:
      'A free, standards-aligned engineering curriculum for grades 7–12. Your students design a ' +
      'real mission, submit a proposal by 1/31/27, and qualify for awards judged by industry professionals.',
  },
  hero: {
    eyebrow: 'Classroom Qualifier · Grades 7–12',
    headline: 'Free engineering curriculum your students can finish by January',
    tagline: 'You bring the passion — we provide the scientists.',
    positioning:
      'A free, standards-aligned engineering curriculum. Your students design a real mission, ' +
      'submit a proposal, and qualify for awards judged by industry professionals.',
    primaryCta: 'Get the free curriculum — due 1/31/27',
    badge: 'MnCOSE26 attendees: free Catalyst membership (code MNCOSE26)',
  },
  glance: [
    { value: 'Grades 7–12', label: 'Middle and high school' },
    { value: '4–10 weeks', label: '4- and 10-week schedules included' },
    { value: '10–20 pages', label: 'One team proposal' },
    { value: 'Submit by 1/31/27', label: 'Start anytime' },
    { value: 'Free', label: 'The curriculum costs nothing' },
  ],
  themes: {
    heading: 'Pick your theme',
    note: 'Same curriculum structure, same deadline.',
    cards: [
      {
        theme: 'space',
        name: 'Space Mission Design',
        body: 'Students plan a settlement beyond Earth and defend every design choice in their proposal.',
      },
      {
        theme: 'enviro',
        name: 'Environmental Design',
        body: 'Students engineer solutions to real-world environmental problems, here on Earth.',
      },
    ],
  },
  included: {
    heading: 'What’s included',
    lead: 'Free with the curriculum. Fill in the form below and we’ll send you everything.',
    items: [
      'Request for Proposal (RFP)',
      'Mission Handbook',
      '4-week and 10-week schedules',
      'Teacher Guide',
      'Student Guide',
      'Judging Rubric',
    ],
  },
  steps: {
    heading: 'Steps to enter',
    items: [
      { title: 'Get the curriculum', body: 'Free. Fill in the form and download the full pack.' },
      { title: 'Run it in class', body: '4–10 weeks, in class, after school or as a club.' },
      { title: 'Submit a proposal', body: 'One 10–20 page team proposal, by 1/31/27.' },
      { title: 'Industry judges score it', body: 'Every team gets written feedback.' },
      {
        title: 'Winners go to Houston',
        body:
          'Winning teams are invited to the 2027 International Summer Camp at NASA Johnson ' +
          'Space Center, Houston. A camp fee applies.',
      },
    ],
  },
  judging: {
    heading: 'How it’s judged',
    body:
      'Industry professionals score every proposal against three equally weighted criteria, ' +
      'set out in the Judging Rubric that comes with the curriculum.',
    // TODO(owner): the three criteria names from the Judging Rubric. The rubric
    // is not in the repo; the list renders once these are filled in.
    criteria: [],
    results: 'Feedback and awards by 1/31/27.',
  },
  offer: {
    heading: 'Met us at MnCOSE?',
    body:
      'Use code MNCOSE26 for a free Catalyst membership ({{catalystPrice}} value). Expires 1/31/27.',
    linkLabel: 'Compare membership tiers',
    href: '/membership',
  },
  grant: {
    heading: 'Teacher Grant',
    body: 'Up to $500 + 5–10 PD hours. 15 places for 2027.',
    cta: 'Tick “I’m interested in the Teacher Grant” on the form',
  },
  proof: {
    heading: 'Why teachers run it',
    // Verified stats only (handover §0). Do not add to this list.
    stats: [
      { value: '46%', label: 'female' },
      { value: 'More than 50%', label: 'race other than White' },
      { value: '33%', label: 'repeat participants' },
      { value: 'Nearly 90%', label: 'go on to pursue STEM or medicine' },
      { value: '1,000+', label: 'students in 10 states' },
    ],
    // Verbatim from stellreducation.org (cleared).
    testimonials: [
      {
        quote:
          'There’s no other forum available for school-aged students to learn about real-world ' +
          'work. These events should be mandatory for every student, globally.',
        who: 'Senior Aerospace Executive and Competition Judge',
      },
      {
        quote:
          'I didn’t know what I wanted to study when I left high school. Now I am laser focused.',
        who: 'Aiden · 2025 Competition Participant',
      },
    ],
  },
  form: {
    eyebrow: 'Free curriculum',
    heading: 'Get the curriculum',
    lead: 'Teachers only: we never ask for student details here.',
    submitLabel: 'Send me the curriculum',
    consentLabel: 'I agree to Stellr Education emailing me about the Classroom Qualifier.',
    success: {
      heading: 'You’re in. Here’s your curriculum.',
      body:
        'Create your free Educator account to download the RFP, Mission Handbook, schedules, ' +
        'guides and Judging Rubric. We’ve also sent the details to your inbox.',
      accountCta: 'Create my free Educator account',
      upgrade: {
        label: 'Upgrade with code MNCOSE26',
        href: '/membership',
        note: 'Free Catalyst membership for MnCOSE26 attendees. Expires 1/31/27.',
      },
    },
  },
  faq: {
    heading: 'Questions teachers ask',
    items: [
      {
        q: 'Do I need an engineering background?',
        a: 'No. The curriculum, guides and rubric walk you through it, and industry professionals do the judging.',
      },
      {
        q: 'What does it cost?',
        a: 'The curriculum is free. If your team wins, the International Summer Camp carries a fee.',
      },
      {
        q: 'Can I run it after school or in a club?',
        a: 'Yes. Run it in class, after school or as a club, on the 4-week or 10-week schedule.',
      },
      { q: 'How many students per team?', a: '2–12 students per team.' },
      { q: 'Is it standards-aligned?', a: 'Yes. It maps to {{standards}}.' },
      {
        q: 'What if we miss 1/31/27?',
        a: 'Join the Spring 2027 window: it runs 1/1/27–5/14/27, with results by 5/31/27.',
      },
      {
        q: 'Is there a guarantee on paid tiers?',
        a: 'Yes. A 100% money-back guarantee within 45 days.',
      },
      {
        q: 'How do I redeem MNCOSE26?',
        a:
          'Create your free Educator account, choose Catalyst under Membership, and enter MNCOSE26 ' +
          'at checkout. The code expires 1/31/27.',
      },
    ],
  },
  crossPromo: {
    text: 'Staying in Mankato? The Minnesota Environmental Design Challenge runs 11/24/26 at the same venue.',
    linkLabel: 'See the Challenge',
    href: '/events/minnesota-environmental-design-challenge',
  },
  finalCta: {
    heading: 'Free curriculum. Real judges. Due 1/31/27.',
    body: 'Start anytime this school year.',
  },
}
