import Link from 'next/link'
import {
  STIPEND_AMOUNTS,
  STIPEND_PAYMENT_DATE,
  STIPEND_PD_HOURS,
  STIPEND_THRESHOLDS,
  closeOutThreshold,
  stipendAmount,
} from '@/lib/stipend'

/**
 * Published copy for /stipend. Every figure is read from lib/stipend.ts rather
 * than typed here, so the page, the participation agreement and the API route
 * cannot drift apart.
 */

export const EARNINGS: { what: string; detail: string; amount: number }[] = [
  {
    what: 'Onboarding',
    detail: 'orientation, agreement, a short baseline survey, and a one-page plan for your year',
    amount: STIPEND_AMOUNTS.onboarding,
  },
  {
    what: 'Bring a team to a live Challenge',
    detail: `at least ${STIPEND_THRESHOLDS.challengeStudents} students plus you attend — ${STIPEND_THRESHOLDS.challengeStudents + 1} attendees minimum`,
    amount: STIPEND_AMOUNTS.challenge,
  },
  {
    what: 'Run a Campaign at your school',
    detail: `in class or as a club, with at least ${STIPEND_THRESHOLDS.campaignStudents} students registered`,
    amount: STIPEND_AMOUNTS.campaign,
  },
  {
    what: 'Close out',
    detail:
      'you submit your survey and reflection, and at least two-thirds of your students submit theirs',
    amount: STIPEND_AMOUNTS.closeOut,
  },
]

export const BENEFITS: { title: string; body: string }[] = [
  {
    title: `${STIPEND_PD_HOURS} documented PD contact hours.`,
    body: 'You get a written statement of hours and the standards covered. It may count toward CTE or recertification, subject to your district’s approval.',
  },
  {
    title: 'Catalyst membership, free',
    body: 'for the program year.',
  },
  {
    title: 'A certificate and a shareable digital badge',
    body: 'you can put on LinkedIn.',
  },
  {
    title: 'A letter of recommendation',
    body: 'on request.',
  },
  {
    title: 'The private educator LinkedIn group',
    body: '— other teachers running the same material, sharing what worked.',
  },
  {
    title: 'Public recognition',
    body: 'on our site and at events.',
  },
]

export const HOW_IT_WORKS: { title: string; body: string }[] = [
  {
    title: 'Apply and onboard.',
    body: 'We’ll walk you through orientation, the participation agreement, and a W-9. You write a one-page plan for your year.',
  },
  {
    title: 'Do the work.',
    body: 'Your team joins a Competition — either by you bringing students to a live Challenge, or by you supporting them through a Campaign at your school. We supply the curriculum, lesson plans, and delivery guides.',
  },
  {
    title: 'Close out.',
    body: 'You complete a short survey and reflection, and at least two-thirds of your students complete theirs.',
  },
  {
    title: 'Get paid.',
    body: `One check, posted ${STIPEND_PAYMENT_DATE}, covering everything you earned that year.`,
  },
]

/**
 * `text` is the plain-language answer and is what goes into the FAQPage
 * schema — `buildFaqJsonLd` takes a string, and a React node there would
 * serialise to nothing. `node` is the richer on-page rendering where one is
 * needed; it must say the same thing as `text`.
 */
export const FAQS: { q: string; text: string; node?: React.ReactNode }[] = [
  {
    q: 'When exactly do I get paid?',
    text: `Checks post on ${STIPEND_PAYMENT_DATE} each year and cover everything you completed since the last payout. Sign up in January and you're paid that same ${STIPEND_PAYMENT_DATE}. Anything you finish after ${STIPEND_PAYMENT_DATE} rolls into the next year's check.`,
  },
  {
    q: 'What is the difference between a Challenge and a Campaign?',
    text: 'Both are ways of running a Competition. A Challenge is the live version — you bring a team to a venue for the event. A Campaign is the remote version — you run it at your own school, in class or as a club. Either one earns the same amount.',
  },
  {
    q: 'Do I need to do both a Challenge and a Campaign?',
    text: `No. Either one earns ${stipendAmount(STIPEND_AMOUNTS.challenge)}. Doing both is how you reach the ${stipendAmount(STIPEND_AMOUNTS.annualMaximum)} maximum.`,
  },
  {
    q: 'What counts as "at least two-thirds of student responses"?',
    text: `Two-thirds of the students who took part, rounded up. Bring ${STIPEND_THRESHOLDS.challengeStudents} students to a Challenge and ${closeOutThreshold(STIPEND_THRESHOLDS.challengeStudents)} of them need to submit; run a Campaign with ${STIPEND_THRESHOLDS.campaignStudents} students and ${closeOutThreshold(STIPEND_THRESHOLDS.campaignStudents)} need to submit. We'll give you the links and a reminder schedule to make this straightforward.`,
  },
  {
    q: 'Does this count for CTE credit?',
    text: "We give you documented PD contact hours and a statement of the standards covered. Whether those count toward CTE or recertification is decided by your district or state — we can't approve that, but we'll give you everything you need to ask.",
  },
  {
    q: 'Do I need to be a Stellr member first?',
    text: 'No — applying is how you join. Submitting the form registers you as a Stellr Educator, our free membership for teachers, or updates the account you already have. There is no cost to take part, and Catalyst membership is included for the program year.',
  },
  {
    q: 'What about my students’ information?',
    text: 'For Campaigns we ask for a roster with student names and email addresses so we can send them their survey. It is handled under our privacy policy, stored securely, and never shared or sold.',
    node: (
      <>
        For Campaigns we ask for a roster with student names and email addresses so we can send
        them their survey. It&rsquo;s handled under our{' '}
        <Link href="/privacy" className="text-primary-deep font-medium hover:underline">
          privacy policy
        </Link>
        , stored securely, and never shared or sold.
      </>
    ),
  },
]
