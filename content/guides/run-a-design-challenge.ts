/**
 * Data for /guides/run-an-engineering-design-challenge — a public, free
 * introduction adapted from the teacher Campaign Guide (Drive: "Campaign Guide
 * - Teacher - ADVANCED"). It gives the framework — the stages, the first
 * session, the trade study, how to assess — and leaves the full facilitation
 * detail, judging packs and worksheets to the member material it points to.
 */

export const STAGES = [
  { stage: 'Read', what: 'The class reads the Request for Proposal (RFP) and handbook together.', you: 'Break one requirement down aloud with them.' },
  { stage: 'Own', what: 'Requirements are split between departments; every one gets a named owner.', you: 'Check nothing is left without an owner.' },
  { stage: 'Decide', what: 'Research, generate options, run trade studies.', you: 'Insist on more than one real option.' },
  { stage: 'Freeze', what: 'The student CEO locks the design in writing.', you: 'Protect the freeze date with your own authority.' },
  { stage: 'Build', what: 'Departments write their sections and draw their diagrams.', you: 'Watch progress on the requirements list, not the work itself.' },
  { stage: 'Integrate', what: 'The proposal is read end to end for contradictions.', you: 'Chair it — and resist fixing what they find.' },
  { stage: 'Check', what: 'Students score their own draft against the judging rubric.', you: 'Make them score themselves before you do.' },
  { stage: 'Submit', what: 'The final proposal goes to the client.', you: 'Hold the deadline.' },
] as const

export const FIRST_SESSION = [
  { step: 'Elect a CEO', min: 5, note: 'Volunteer or vote, then move on.' },
  { step: 'Staff the departments', min: 10, note: 'Balance the numbers; put capable students on communications, not whoever is left.' },
  { step: 'Read the requirements aloud', min: 15, note: 'As a whole class. Departments claim sections as you go.' },
  { step: 'Build the requirements list', min: 15, note: 'One row per requirement, each with an owner. Nothing else today.' },
  { step: 'Set the rhythm', min: 10, note: 'Who records decisions, where the team talks, and the freeze date on a calendar.' },
] as const

export const TRADE_STUDY = {
  criteria: [
    { name: 'Meets the hardest constraint', weight: 35, scores: [4, 2, 3] },
    { name: 'Room to grow', weight: 25, scores: [2, 4, 3] },
    { name: 'Build cost and schedule', weight: 20, scores: [3, 3, 4] },
    { name: 'Crew liveability', weight: 15, scores: [4, 3, 2] },
    { name: 'Risk if it fails', weight: 5, scores: [3, 2, 4] },
  ],
  options: ['Option A', 'Option B', 'Option C'],
} as const

/**
 * Weighted totals, computed rather than typed so the table can't be wrong —
 * the source guide's hand-typed totals (3.20 / 2.90 / 3.15) didn't match its
 * own scores (3.25 / 2.85 / 3.10). `weights` overrides for the sensitivity check.
 */
export function tradeStudyTotals(weights: readonly number[] = TRADE_STUDY.criteria.map((c) => c.weight)): number[] {
  return TRADE_STUDY.options.map((_, i) =>
    TRADE_STUDY.criteria.reduce((sum, c, k) => sum + (weights[k] / 100) * c.scores[i], 0)
  )
}

/** The sensitivity check shown on the page: ten points moved from the hardest constraint to room to grow. */
export const SENSITIVITY_WEIGHTS = [25, 35, 20, 15, 5] as const

export const WHEN_TO_STEP_IN = [
  { if: 'A requirement has no owner', then: 'Assign it yourself, today.', not: 'Wait for the class to notice.' },
  { if: 'The freeze date has passed with no decision', then: 'Call the freeze yourself, publicly.', not: 'Extend it “one more week”.' },
  { if: 'Two departments have contradictory numbers', then: 'Put them in a room together.', not: 'Tell them which number is right.' },
  { if: 'A student asks you a technical question', then: 'Point to the section of the brief that answers it.', not: 'Answer it.' },
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
    q: 'How do I grade an engineering design proposal?',
    a: 'Score each criterion separately against a rubric with described bands, and mark the work rather than the effort. Stellr proposals are judged on economic feasibility, design credibility and social viability, equally weighted. Have students score their own draft first.',
  },
  {
    q: 'Can students use AI in a design challenge?',
    a: 'Your school’s AI policy always comes first. Where AI is allowed, Stellr asks students to record the prompt behind every piece of AI-generated material. The parts AI can’t do for them — trade-offs and design decisions — are the parts that are scored.',
  },
  {
    q: 'Is the material free?',
    a: 'Yes. A free Stellr Educator account includes the abridged Request for Proposal and Mission Handbook, teacher and student Campaign guides, and optional submission with written feedback from Stellr’s judging panel.',
  },
]
