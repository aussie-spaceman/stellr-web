import type { LandingPageConfig } from './types'
import {
  FAQ_EYEBROW, FAQ_HEADING, FORM_SHELL, GALLERY_HEADING, GALLERY_LEAD,
  GALLERY_SHOTS, WHY_EYEBROW,
} from './shared'

/**
 * Homeschool families and students.
 *
 * Headline, kicker and both `why.reasons` are verbatim from the client's print
 * flyer, Title Case included. One edit was approved: the flyer's "a great way
 * for students to meeting new people" reads "to meet" here — a visible grammar
 * error on a paid landing page costs more than the provenance is worth.
 *
 * The kicker "One Day. A Real Space Mission." is the client's, kept knowingly
 * alongside the event-agnostic rewrite of everything around it.
 */
export const homeschoolStudents: LandingPageConfig = {
  slug: 'homeschool-students',
  audience: 'homeschool',
  analyticsSource: 'landing_page_family',
  theme: 'space',
  seo: {
    title: 'Homeschool students — Space Design Competitions',
    description:
      'Open to any student in grades 9–12, nation-wide. No school team required. Design a ' +
      'Martian habitat and defend it to industry judges. Scholarships at every event.',
  },
  hero: {
    eyebrow: 'Design competitions · {{States}} states',
    headline: 'Homeschooled and STEM Curious?',
    kicker: 'One Day. A Real Space Mission.',
    body:
      'Our Space Design Challenges are open to any student, nation-wide. Participants join ' +
      'a team of peers and design a futuristic Martian habitat, then defend the design ' +
      'against industry peers.',
    photoId: 'lp-hero-homeschool',
    imageCaption:
      'Students meet their company on arrival and work together for the whole weekend.',
    primaryCta: 'Reserve a spot',
    secondaryCta: 'Learn More',
  },
  why: {
    eyebrow: WHY_EYEBROW,
    heading: 'No school, no team, no experience needed',
    lead:
      'Students arrive on their own and leave with a network of peers, mentors and a ' +
      'design they defended in front of working engineers.',
    // "up to the full cost", confirmed 2 Sep 2026. The absolute version ("cover
    // the full cost") is the phrasing the Ad Grants remediation removed from
    // three other surfaces — do not reintroduce it here.
    note:
      'Scholarships are available at every event, and can cover up to the full cost of a ' +
      'place. Ask for details when you reserve a position.',
    reasons: [
      {
        title: 'No School Team Required',
        body:
          'Participants are formed into ‘companies’, a great way for students to meet new ' +
          'people, build their network, and develop soft skills.',
      },
      {
        title: 'Industry Mentoring + Judging',
        body:
          'Professionals — from college and local businesses — volunteer to mentor across ' +
          'the weekend, and then act as judges. Careers start here.',
      },
    ],
  },
  gallery: {
    heading: GALLERY_HEADING,
    lead: GALLERY_LEAD,
    shots: GALLERY_SHOTS,
  },
  testimonials: [
    {
      quote:
        'I’ve never seen my daughter so engaged and excited to be learning. What an ' +
        'opportunity for her!',
      who: 'Aaron, parent of 2019 competition participant',
    },
    {
      quote:
        'I didn’t know what I wanted to study when I left high-school. Now I am laser focused.',
      who: 'Aiden, 2025 competition participant',
    },
  ],
  form: {
    ...FORM_SHELL,
    eyebrow: 'Space design competition',
    lead:
      'Tell us who you are and how many students you are enquiring for. We will send ' +
      'follow up information, and schedule a call to answer your questions.',
    points: [
      'Preferential registration for your student/s',
      'A short call to answer your questions',
      'Scholarship eligibility and how to apply',
    ],
    defaultRole: 'parent',
    defaultStudents: 1,
  },
  faq: {
    eyebrow: FAQ_EYEBROW,
    heading: FAQ_HEADING,
    items: [
      {
        q: 'Does my student need a team to enter?',
        a:
          'No. Participants are formed into ‘companies’ on arrival, which is how most ' +
          'students meet the peers they stay in touch with afterwards. We will always ' +
          'welcome individual students attending our events.',
      },
      {
        q: 'Who is eligible?',
        a:
          'Any student in grades 9–12, including homeschooled students and students in ' +
          'co-ops. No school affiliation is needed.',
      },
      {
        q: 'Who mentors and judges?',
        a:
          'Professionals from college and local businesses volunteer to mentor across the ' +
          'weekend, then act as judges for the final design defence.',
      },
      {
        q: 'What does it cost?',
        a:
          'Registration is set per event and is all inclusive. Scholarships are available ' +
          'at every event.',
      },
      {
        q: 'Can parents attend?',
        a:
          'Parents are welcome for the opening briefing and the final design defence. ' +
          'Students work with their company for the rest of the weekend. If parents wish ' +
          'to stay for the duration of the event, we do our best to accommodate them.',
      },
      {
        q: 'Where are competitions held?',
        a:
          '{{Locations}} locations across {{states}} states, on university and museum ' +
          'campuses. Tell us where you are and we will point you to the nearest.',
      },
      {
        q: 'My student has never competed before. Is that a problem?',
        a:
          'No. Most participants arrive without competition experience. You do not need to ' +
          'know any orbital mechanics to start — that is what the mentors are for.',
      },
      {
        q: 'What does my student actually come away with?',
        a:
          'A lifelong network of similar students, and professional mentors. As well as the ' +
          'satisfaction of achieving against the technical challenges we set them.',
      },
    ],
  },
}
