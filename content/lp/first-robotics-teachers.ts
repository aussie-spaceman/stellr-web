import type { LandingPageConfig } from './types'
import {
  FAQ_EYEBROW, FAQ_HEADING, FORM_SHELL, GALLERY_HEADING, GALLERY_LEAD,
  GALLERY_SHOTS, WHY_EYEBROW,
} from './shared'

/**
 * Teachers already running a FIRST Robotics programme.
 *
 * Headline, kicker and the three `why.reasons` are verbatim from the client's
 * print flyer, Title Case included, so the page matches the ad creative it is
 * bought against. The hero body was edited to drop single-event framing
 * ("Our 2027 Space Design Competition" → "Our Space Design Competitions"),
 * since these pages are event-agnostic.
 */
export const firstRoboticsTeachers: LandingPageConfig = {
  slug: 'first-robotics-teachers',
  audience: 'first_robotics_teacher',
  analyticsSource: 'landing_page_teacher',
  theme: 'space',
  seo: {
    title: 'FIRST Robotics teachers — Space Design Competitions',
    description:
      'No hardware, no build budget. Design competitions scheduled to offset the robotics ' +
      'season, at {{locations}} locations across {{states}} states. Teacher Grant Program available.',
  },
  hero: {
    eyebrow: 'Design competitions · {{States}} states',
    headline: 'Robotics Teacher Looking For The Next Challenge?',
    kicker: 'No Hardware. No Build Budget. Real Space Mission.',
    body:
      'Our Space Design Competitions are the perfect complement to FIRST Robotics. ' +
      'Participants join a team of peers and design a futuristic Martian habitat, then ' +
      'defend the design against industry peers.',
    photoId: 'lp-hero-robotics',
    imageCaption:
      'A mission room mid-competition. Students work the trade-off wall while mentors circulate.',
    primaryCta: 'Reserve a spot',
    secondaryCta: 'Learn More',
  },
  why: {
    eyebrow: WHY_EYEBROW,
    heading: 'Built for the season you have not got room for',
    lead:
      'A design competition trains the skills a build season cannot, and ours are ' +
      'scheduled so they never compete with yours.',
    note:
      'Teacher Grant Program is available to support your attendance. Ask for details ' +
      'when you reserve a position.',
    reasons: [
      {
        title: 'Complementary Skills',
        body:
          'Design Competitions are theoretical design exercises, focused on building ' +
          '‘soft skills’ in future engineers — communications, large group management, ' +
          'design trade-offs.',
      },
      {
        title: 'Off Season Training',
        body: 'Scheduled to offset robotics — keep your students engaged and learning.',
      },
      {
        title: 'Cost Effective STEM',
        body: 'No build budget, minimal travel. Teacher Grant Program available.',
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
        'There’s no other forum available for school-aged students to learn about ' +
        'real-world work. These events should be mandatory for every student, globally.',
      who: 'Senior aerospace executive and competition judge',
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
      'Tell us who you are and roughly how many students you would bring. We will ' +
      'schedule a call so provide additional information and help you manage your ' +
      'registration.',
    points: [
      'Preferential registration for your student/s',
      'A short call to answer your questions',
      'Teacher Grant Program and scholarship information',
    ],
    defaultRole: 'teacher',
    defaultStudents: 6,
  },
  faq: {
    eyebrow: FAQ_EYEBROW,
    heading: FAQ_HEADING,
    items: [
      {
        q: 'Does my school need to enter a full team?',
        a:
          'No. Students are placed into ‘companies’ on the day alongside peers from other ' +
          'programmes, so you can bring one student or a dozen.',
      },
      {
        q: 'How does this fit around our robotics season?',
        a:
          'Design competitions are scheduled to offset the robotics calendar, so they keep ' +
          'students engaged without competing with build or competition season.',
      },
      {
        q: 'What do students need to bring?',
        a:
          'Laptops or tablets if they have them available. For our overnight events living ' +
          'essentials. There is no hardware to build and no build budget to raise.',
      },
      {
        q: 'What is the Teacher Grant Program?',
        a:
          'Support for teachers who bring a group of students to a competition. We will go ' +
          'through the current terms on your call.',
      },
      {
        q: 'What does it cost?',
        a:
          'Registration is set per event and is all inclusive. Scholarships are available ' +
          'at every event.',
      },
      {
        q: 'Where are competitions held?',
        a:
          '{{Locations}} locations across {{states}} states, on university and museum ' +
          'campuses. Tell us where you are and we will point you to the nearest.',
      },
      {
        q: 'How many students should I bring?',
        a:
          'Anywhere from one to a dozen works. Students are mixed into companies with peers ' +
          'from other programmes, so group size does not affect their experience.',
      },
      {
        q: 'Do I need to know the subject matter to bring a group?',
        a:
          'No. Mentors and judges from industry run the technical side across the weekend. ' +
          'Your role is getting students there.',
      },
    ],
  },
}
