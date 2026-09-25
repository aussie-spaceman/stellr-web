/**
 * Data for /guides/stem-competitions-for-schools.
 *
 * EVERY cell is either confirmed on the program's own site (source URL in
 * `sources`) or written as "Varies — check with the organizer". Nothing is
 * inferred. Checked 24 Sept 2026 for the 2026–27 season; re-check each August
 * when fees and dates roll over, and update CHECKED_ON.
 *
 * Editorial rule: one family of space-settlement design competitions is never
 * named in Stellr's public content (standing decision, 24 Sept 2026). Do not
 * add it here.
 */

export const CHECKED_ON = '24 September 2026'
export const SEASON = '2026–27'

export interface Program {
  name: string
  organizer: string
  grades: string
  team: string
  cost: string
  equipment: string
  format: string
  professionals: string
  sources: string[]
  stellr?: true
}

// Stellr last and highlighted: a comparison that leads with its author reads as an ad.
export const PROGRAMS: readonly Program[] = [
  {
    name: 'Science Olympiad',
    organizer: 'Science Olympiad, Inc.',
    grades: 'Div B 6–9 · Div C 9–12',
    team: 'Up to 15',
    cost: 'National dues plus state fees, paid through your state — varies by state',
    equipment: '23 events per division, including lab and build events',
    format: 'Season of one-day tournaments: invitational → regional → state → national',
    professionals: 'Varies — check with your state organization',
    sources: [
      'https://www.soinc.org/start-team/team-size-grade-levels',
      'https://www.soinc.org/events/2027-event-table',
      'https://www.soinc.org/start-team/membership-benefits',
    ],
  },
  {
    name: 'FIRST Robotics Competition',
    organizer: 'FIRST',
    grades: '9–12',
    team: 'No maximum; many teams are 10–20',
    cost: '$6,500 season fee (includes the Kit of Parts and first event)',
    equipment: 'Build space for a full-size robot',
    format: 'Season-long; game released January, events February–April',
    professionals: 'Optional volunteer mentors, including engineers',
    sources: ['https://www.firstinspires.org/programs/cost-and-registration', 'https://www.firstinspires.org/programs/frc/get-started'],
  },
  {
    name: 'FIRST Tech Challenge',
    organizer: 'FIRST',
    grades: '7–12',
    team: 'Many teams are 8–12',
    cost: '$350 season fee, plus about $1,500 in robot parts; event fees set locally',
    equipment: 'Robot kit and a place to build',
    format: 'Season-long league and qualifier events',
    professionals: 'Optional volunteer mentors, including engineers',
    sources: ['https://www.firstinspires.org/robotics/ftc/cost-and-registration', 'https://www.firstinspires.org/programs/ftc/get-started'],
  },
  {
    name: 'FIRST LEGO League Challenge',
    organizer: 'FIRST',
    grades: '4–8',
    team: 'Small teams plus 2 adult coaches',
    cost: '$285 registration; $900 for the traditional team package',
    equipment: 'LEGO robot set, laptop or tablet, practice table',
    format: 'Season-long; robot game plus an Innovation Project',
    professionals: 'Varies — check with your region',
    sources: ['https://www.firstinspires.org/programs/cost-and-registration', 'https://www.firstinspires.org/programs/fll/get-started'],
  },
  {
    name: 'VEX robotics (V5RC / VIQRC)',
    organizer: 'Global Robotics & Science Foundation',
    grades: 'Elementary through high school',
    team: 'Varies — check with the organizer',
    cost: 'Season and per-event fees — check with the organizer',
    equipment: 'VEX robot hardware and field elements',
    format: 'Season of in-person qualifiers leading to a world championship',
    professionals: 'Varies — check with the organizer',
    sources: ['https://events.vex.com/', 'https://recf.org/a-message-to-our-community/'],
  },
  {
    name: 'TSA TEAMS',
    organizer: 'Technology Student Association',
    grades: 'Middle and high school',
    team: '4–6',
    cost: '$300–$500 per school, by number of teams',
    equipment: 'A laptop with internet per team, plus a design/build kit',
    format: 'One competition day (Jan–Feb): design/build, test, essay and math modeling',
    professionals: 'Varies — check with the organizer',
    sources: ['https://tsaweb.org/teams', 'https://tsaweb.org/teams/state-competition-2026'],
  },
  {
    name: 'StellarXplorers',
    organizer: 'Air & Space Forces Association',
    grades: 'Mainly high school; middle school may compete',
    team: '2–6 plus a team director',
    cost: '$250; waived for Title I schools',
    equipment: '64-bit Windows PCs and free satellite-design software',
    format: 'Online qualifying rounds (Oct–Jan) of six hours each; in-person national finals',
    professionals: 'Yes — optional volunteer technical mentors',
    sources: ['https://www.stellarxplorers.org/dates-fees.html'],
  },
  {
    name: 'Future City (middle school)',
    organizer: 'DiscoverE',
    grades: '6–8',
    team: '3 or more',
    cost: '$25 per organization; model materials capped at $100',
    equipment: 'Recycled materials and space to build a scale model',
    format: 'September to February, about 2–3 hours a week; regionals in January, national finals in February',
    professionals: 'Yes — volunteer engineer mentors and STEM-professional judges',
    sources: ['https://futurecity.org/future-city-middle-school/', 'https://futurecity.org/how-future-city-works/'],
  },
  {
    name: 'NASA TechRise',
    organizer: 'NASA, via Future Engineers',
    grades: '6–12',
    team: '4 or more, led by a school employee',
    cost: 'Free; 60 winning teams receive $1,500 and a flight kit',
    equipment: 'None to enter',
    format: 'Written experiment proposal (due November); winners build a balloon payload',
    professionals: 'Yes — technical advisors support winning teams',
    sources: ['https://www.futureengineers.org/nasatechrise'],
  },
  {
    name: 'eCYBERMISSION',
    organizer: 'U.S. Army Educational Outreach Program',
    grades: 'Rising 6–9',
    team: '2–4 plus an adult advisor',
    cost: 'Free',
    equipment: 'None required',
    format: 'Fully online submission and judging (registration Aug–Feb)',
    professionals: 'Yes — STEM professionals judge and mentor',
    sources: ['https://usaeop.com/program/ecybermission/'],
  },
  {
    name: 'Stellr Campaign',
    organizer: 'Stellr Education',
    grades: '9–12',
    team: 'Groups; a school can enter as many as it likes',
    cost: 'Free (Educator membership)',
    equipment: 'None — no lab, no kit',
    format: 'In class or as a club, over 4 or 10 weeks; one written proposal per group',
    professionals: 'Yes — a judging panel returns written feedback on every proposal',
    sources: ['https://www.stellreducation.org/events/space-design-campaign-fall'],
    stellr: true,
  },
  {
    name: 'Stellr live Challenge',
    organizer: 'Stellr Education',
    grades: '7–12',
    team: 'Individuals or groups of 2–12, formed into “engineering companies” on the day',
    cost: 'Per participant — $75 at the Colorado event, Oct 2026; scholarships available',
    equipment: 'None — all material provided; a laptop helps but isn’t required',
    format: 'One day, in person, no preparation required',
    professionals: 'Yes — judges from aerospace, engineering and science industries',
    sources: ['https://www.stellreducation.org/events/colorado-space-design-challenge'],
    stellr: true,
  },
]

/** Plain-text answers — rendered visibly and emitted as FAQPage, so they must match. */
export const FAQS: readonly { q: string; a: string }[] = [
  {
    q: 'Which STEM competitions are free for schools?',
    a: 'Of the programs compared here, NASA TechRise, eCYBERMISSION and Stellr Campaigns are free to enter. StellarXplorers waives its $250 fee for Title I schools. Future City costs $25 per organization for middle school.',
  },
  {
    q: 'Which STEM competitions need no lab or equipment?',
    a: 'eCYBERMISSION, NASA TechRise (to enter), Stellr Campaigns and Stellr live Challenges need no lab or kit. StellarXplorers needs only Windows PCs. Robotics programs such as FIRST and VEX need robot hardware and build space.',
  },
  {
    q: 'Do I need an engineering background to coach a STEM competition?',
    a: 'Usually not. FIRST says anyone can join regardless of technical experience, StellarXplorers and Future City pair teams with volunteer mentors, and Stellr Campaigns and Challenges are designed to be run by teachers with no engineering background.',
  },
  {
    q: 'What is an industry-simulation design competition?',
    a: 'Students act as a professional engineering company responding to a client’s Request for Proposal: they split into departments, research and design a solution, and submit or present a proposal judged by industry professionals. Stellr’s Space and Environmental Design Challenges use this format.',
  },
]
