/**
 * Data for /guides/run-an-engineering-design-challenge — a public SUMMARY of
 * the teacher Campaign Guide (Drive: "Campaign Guide - Teacher - ADVANCED").
 *
 * Summary only, by decision (25 Sept 2026): the stages and how work is judged,
 * enough to answer "how would I run this?". Session plans, the worked trade
 * study, intervention guidance and judging packs stay in member material —
 * don't port them here.
 */

export const STAGES = [
  { stage: 'Read', what: 'The class reads the client’s Request for Proposal (RFP) and handbook together.' },
  { stage: 'Own', what: 'Requirements are split between departments, and every one gets a named student owner.' },
  { stage: 'Decide', what: 'Students research, generate options and compare them in a weighted trade study.' },
  { stage: 'Freeze', what: 'The student CEO locks the design in writing.' },
  { stage: 'Build', what: 'Departments write their sections and draw their diagrams.' },
  { stage: 'Integrate', what: 'The proposal is read end to end for contradictions.' },
  { stage: 'Check', what: 'Students score their own draft against the judging rubric.' },
  { stage: 'Submit', what: 'The final proposal goes to the client.' },
] as const

export const CRITERIA = [
  { name: 'Economic feasibility', ask: 'Is every major expense justified? Do they understand what things cost and return?' },
  { name: 'Design credibility', ask: 'Did they see how the systems depend on each other, and prioritise with data?' },
  { name: 'Social viability', ask: 'Would people actually thrive here — or were the humans added at the end?' },
] as const

/** Plain-text answers — rendered visibly and emitted as FAQPage, so they must match. */
export const FAQS: readonly { q: string; a: string }[] = [
  {
    q: 'Do I need an engineering background to run a design challenge?',
    a: 'No. Your job is to run the process — owners, deadlines, the design freeze — not to know the answers. When students ask technical questions, point them to the brief; building the justification themselves is the learning.',
  },
  {
    q: 'How long does a classroom engineering design challenge take?',
    a: 'Stellr Campaigns come with a 4-week and a 10-week schedule, so you can fit the challenge to the time you have. Either way it runs through the same eight stages, from reading the brief to submitting a proposal.',
  },
  {
    q: 'What equipment or lab do I need?',
    a: 'None. Students research, design and write a proposal, so a classroom and internet access are enough. There is no kit to buy.',
  },
  {
    q: 'How is an engineering design proposal judged?',
    a: 'Stellr proposals are judged on three equally weighted criteria: economic feasibility, design credibility and social viability. Each is scored on its own against described bands, marking the work rather than the effort.',
  },
  {
    q: 'Can students use AI in a design challenge?',
    a: 'Your school’s AI policy always comes first. Where AI is allowed, Stellr asks students to record the prompt behind every piece of AI-generated material. The parts AI can’t do for them — trade-offs and design decisions — are the parts that are scored.',
  },
  {
    q: 'Is the material free?',
    a: 'Yes. A free Stellr Educator account includes the abridged Request for Proposal and Mission Handbook, teacher and student Campaign guides, and optional submission with written feedback from Stellr’s judging panel. Paid educator tiers add session-by-session facilitation, worked examples and full judging packs.',
  },
]
