// Static content for the "Atmospheric Requirements" tutorial (student + teacher
// pages share this). Physics constants and worked-answer values live here so the
// interactive calculators and the teacher answer key can never drift apart.

export const TUTORIAL_META = {
  title: 'Estimating Atmospheric Requirements for Space Settlements',
  eyebrow: 'Tutorial · Space Design',
  time: '45–60 min',
  level: 'High school (Grades 9–12)',
  strand: 'Space Design Challenge',
} as const

// NGSS alignment. These are Stellr's mapping of the activity to the standards —
// the tutorial is a design/quantitative-reasoning task, so the strongest fits are
// engineering-design PEs plus the maths and scale practices/crosscutting concepts.
export const NGSS = [
  {
    code: 'HS-ETS1-2',
    label:
      'Design a solution to a complex real-world problem by breaking it down into smaller, more manageable problems that can be solved through engineering.',
  },
  {
    code: 'HS-ETS1-3',
    label:
      'Evaluate a solution to a complex real-world problem based on prioritized criteria and trade-offs that account for a range of constraints — including cost, safety and reliability.',
  },
  {
    code: 'SEP-5',
    label: 'Using Mathematics and Computational Thinking — applying Dalton’s and Amagat’s laws to size a real system.',
  },
  {
    code: 'CCC-3',
    label: 'Scale, Proportion, and Quantity — how percent oxygen changes with total pressure at fixed partial pressure.',
  },
] as const

export const OBJECTIVES = [
  'Convert between total pressure, partial pressure of oxygen, and percent oxygen.',
  'Explain why a lower total pressure forces a higher percent oxygen to keep people healthy.',
  'Describe how oxygen concentration — not just partial pressure — drives flammability.',
  'Weigh the competing demands of human comfort, fire risk, cost and structure when choosing an atmosphere.',
  'Estimate how much of each gas a settlement needs using Dalton’s Law, Amagat’s Law and expansion ratios.',
] as const

// The trade-off table from the original tutorial (total P, pO2, %O2).
export const TRADEOFF_ROWS = [
  { total: 0.25, ppo2: 0.1, pct: 40 },
  { total: 0.25, ppo2: 0.15, pct: 60 },
  { total: 0.25, ppo2: 0.2, pct: 80 },
  { total: 0.5, ppo2: 0.1, pct: 20 },
  { total: 0.5, ppo2: 0.15, pct: 30 },
  { total: 0.5, ppo2: 0.2, pct: 40 },
  { total: 1, ppo2: 0.1, pct: 10 },
  { total: 1, ppo2: 0.15, pct: 15 },
  { total: 1, ppo2: 0.2, pct: 20 },
] as const

// Worked container problem — the canonical settlement example.
export const CONTAINER_PROBLEM = {
  volume: 1_000_000, // m^3
  totalPressure: 0.75, // atm
  tempC: 20,
  ppo2: 0.132, // atm — from NASA SP-413 alveolar recommendation (~100 mmHg)
  ppn2: 0.618, // atm — remainder, nitrogen only
  containerSize: 100, // m^3
  // Expansion ratios (liquid : gas) at 1 atm.
  er: { o2: 1 / 860, n2: 1 / 696 },
} as const

// Verified reference links (checked 13-Jul-2026). Dead links from the original
// (US Army PHC altitude page; the ntrs.nasa.gov/archive PDF path) were replaced.
export const SOURCES = [
  {
    group: 'Oxygen & the human body',
    items: [
      {
        title: 'How does altitude affect the body? — Murdoch University',
        href: 'https://www.murdoch.edu.au/news/articles/opinion-how-does-altitude-affect-the-body',
      },
      {
        title: 'Effects of altitude / hypoxia — NCBI Bookshelf',
        href: 'https://www.ncbi.nlm.nih.gov/books/NBK232874/',
      },
      {
        title: 'NASA SP-413 “Space Settlements: A Design Study”, Ch. 3 — Human Needs in Space',
        href: 'https://nss.org/settlement/nasa/75SummerStudy/Chapt3.html',
      },
    ],
  },
  {
    group: 'Flammability',
    items: [
      {
        title: 'Elements of fire (the fire triangle) — Smokey Bear',
        href: 'https://smokeybear.com/en/about-wildland-fire/fire-science/elements-of-fire',
      },
      {
        title: 'Apollo 1: the fatal fire in a pure-oxygen cabin — Space.com',
        href: 'https://www.space.com/17338-apollo-1.html',
      },
      {
        title: 'NASA — oxygen partial pressure & concentration effects on flammability',
        href: 'https://ntrs.nasa.gov/citations/20160001047',
      },
      {
        title: 'Explosive / flammability limits of gases (20 °C, 1 atm) — Engineering ToolBox',
        href: 'https://www.engineeringtoolbox.com/explosive-concentration-limits-d_423.html',
      },
    ],
  },
  {
    group: 'Air components & non-ideal gases',
    items: [
      {
        title: 'Carbon dioxide scrubbers — Wikipedia',
        href: 'https://en.wikipedia.org/wiki/Carbon_dioxide_scrubber',
      },
      {
        title: 'Deviations from ideal-gas behaviour (van der Waals) — Purdue ChemEd',
        href: 'https://chemed.chem.purdue.edu/genchem/topicreview/bp/ch4/deviation5.html',
      },
    ],
  },
] as const

// Check-your-understanding items (student self-check + teacher key).
export const PRACTICE = [
  {
    id: 'q1',
    prompt:
      'A habitat runs at a total pressure of 0.60 atm. The designer wants a partial pressure of oxygen of 0.18 atm. What percent oxygen is that?',
    answer: 30,
    unit: '%',
    tolerance: 1,
    solution:
      '% oxygen = pO₂ ÷ total pressure = 0.18 ÷ 0.60 = 0.30 = 30%. Note this is well above Earth’s 21% — the lower total pressure forces a richer oxygen fraction.',
  },
  {
    id: 'q2',
    prompt:
      'You need 21% oxygen and the cabin runs at 0.50 atm total. What partial pressure of oxygen does that give? (atm)',
    answer: 0.105,
    unit: 'atm',
    tolerance: 0.005,
    solution:
      'pO₂ = fraction × total pressure = 0.21 × 0.50 = 0.105 atm — roughly two-thirds of Earth’s sea-level pO₂ (~0.16 atm), so occupants would feel mild altitude effects.',
  },
  {
    id: 'q3',
    prompt:
      'Two cabins hold the same partial pressure of oxygen, but cabin A is at 1.0 atm total and cabin B at 0.5 atm total. Which is more prone to fire?',
    choices: ['Cabin A', 'Cabin B', 'Identical risk'],
    answerIndex: 1,
    solution:
      'Cabin B. Same pO₂ at half the total pressure means double the oxygen fraction, and flammability tracks oxygen concentration (fraction) more than partial pressure — so the lower-pressure cabin is the more flammable one.',
  },
] as const
