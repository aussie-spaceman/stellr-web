// Authoritative tier data for the /membership explorer.
// Structure, copy, discounts and the educator content waterfall live here;
// PRICE NUMBERS are injected at render from membership_tiers (lib/tier-pricing)
// — marketing surfaces must never hard-code prices (see lib/tier-pricing.ts).
import type { BracketId, TierId } from '@stellr/web-ui'

export type AudienceId = 'school' | 'college' | 'educator'
export type GetKind = 'free' | 'buy' | 'earn'
export type ValueIcon = 'team' | 'launch' | 'award' | 'document' | 'idea' | 'global' | 'orbit' | 'certificate'

export interface GetPath { kind: GetKind; text: string }
export interface Cell { tone: 'included' | 'discount' | 'full'; label: string; sub?: string }

export interface Tier {
  id: TierId
  name: string
  role: string
  /** Note beside the price, e.g. 'always' | 'per year'. */
  priceNote: string
  free?: boolean
  store: string
  academy: string
  /** Educator facts-block mentoring line (waterfall only). */
  mentor?: string
  revert?: string | null
  get: GetPath[]
  granted: string[]
  /** [Events, Mentoring, Coaching, Merchandise, Training] — school/college only. */
  cells: Cell[]
}

export interface Audience {
  id: AudienceId
  /** Full name shown on the tier-lens pill. */
  name: string
  /** Label on the hero audience switcher. */
  switchLabel: string
  /** Bracket → tier-shade ramp + bracket palette (deliverable B). */
  bracket: BracketId
  tiers: Tier[]
}

export interface ValueCard { icon: ValueIcon; title: string; body: string }

export const PAY_PER_SESSION = '$99 / space'

const ev = (): Cell => ({ tone: 'full', label: 'Pay per event', sub: '$55–215 · free merch' })
const inc = (label: string, sub?: string): Cell => ({ tone: 'included', label, sub })
const disc = (label: string): Cell => ({ tone: 'discount', label })
const full = (label: string, sub?: string): Cell => ({ tone: 'full', label, sub })

export const AUDIENCES: Record<AudienceId, Audience> = {
  school: {
    id: 'school',
    name: 'School Students',
    switchLabel: 'School Students',
    bracket: 'school',
    tiers: [
      {
        id: 'explorer', name: 'Explorer', role: 'Everyone starts here', priceNote: 'always', free: true,
        store: '5%', academy: '0%', revert: null,
        get: [{ kind: 'free', text: 'Free for every high-school student' }],
        granted: ['Dedicated Explorer community space', 'Competition & campaign entry', 'Member newsletter & webinar invites', '5% off the store'],
        cells: [ev(), full('Full price'), full('Full price'), disc('5% off'), full('Pay per session', PAY_PER_SESSION)],
      },
      {
        id: 'pathfinder', name: 'Pathfinder', role: 'Competition participant', priceNote: 'per year',
        store: '10%', academy: '15%', revert: 'If granted via competition: reverts to Explorer after 12 months.',
        get: [{ kind: 'buy', text: 'Buy a Pathfinder membership' }, { kind: 'earn', text: 'Auto-assigned for 12 months to competition participants' }],
        granted: ['Everything in Explorer', 'Dedicated Pathfinder community space', 'Mentoring — 4 × 30-min cohort included', '15% off academy · 10% off store'],
        cells: [ev(), inc('Included', '4 × 30-min cohort'), disc('15% off'), disc('10% off'), disc('15% off')],
      },
      {
        id: 'scholar', name: 'Scholar', role: 'Competition award winner', priceNote: 'per year',
        store: '10%', academy: '25%', revert: 'If granted via award: reverts to Explorer after 12 months.',
        get: [{ kind: 'buy', text: 'Buy a Scholar membership' }, { kind: 'earn', text: 'Awarded for 12 months to competition winners' }],
        granted: ['Everything in Pathfinder (including group mentoring)', 'Dedicated Scholar community space', 'Coaching — 3 × 30-min sessions included', '25% off academy · 10% off store'],
        cells: [ev(), inc('Included', 'via Pathfinder'), inc('Included', '3 × 30-min'), disc('10% off'), disc('25% off')],
      },
    ],
  },
  college: {
    id: 'college',
    name: 'College & University',
    switchLabel: 'College & University',
    bracket: 'college',
    tiers: [
      {
        id: 'alumni', name: 'Alumni', role: 'Everyone starts here', priceNote: 'always', free: true,
        store: '5%', academy: '10%', revert: null,
        get: [{ kind: 'free', text: 'Free for every college & university student' }, { kind: 'earn', text: 'School members roll up to Alumni at graduation' }],
        granted: ['Dedicated Alumni community space', 'Competition & campaign entry', 'Member newsletter & webinar invites', '10% off academy · 5% off store'],
        cells: [ev(), disc('10% off'), disc('10% off'), disc('5% off'), disc('10% off')],
      },
      {
        id: 'contributor', name: 'Contributor', role: 'Volunteer', priceNote: 'per year',
        store: '10%', academy: '15%', revert: 'If granted via volunteering: reverts to Alumni after 12 months.',
        get: [{ kind: 'buy', text: 'Buy a Contributor membership' }, { kind: 'earn', text: 'Unlocked by volunteering (Stellr admin upgrade)' }],
        granted: ['Everything in Alumni', 'Dedicated Contributor community space', 'Mentoring — 8 × 30-min cohort included', '15% off academy · 10% off store'],
        cells: [ev(), inc('Included', '8 × 30-min cohort'), disc('15% off'), disc('10% off'), disc('15% off')],
      },
      {
        id: 'counselor', name: 'Counselor', role: 'Most active volunteer', priceNote: 'per year',
        store: '10%', academy: '25%', revert: 'If granted via volunteering: reverts to Alumni after 12 months.',
        get: [{ kind: 'buy', text: 'Buy a Counselor membership' }, { kind: 'earn', text: 'Unlocked through ongoing volunteering (admin upgrade)' }],
        granted: ['Everything in Contributor (including group mentoring)', 'Dedicated Counselor community space', 'Coaching — 1 × 60-min session included', '25% off academy · 10% off store'],
        cells: [ev(), inc('Included', 'via Contributor'), inc('Included', '1 × 60-min'), disc('10% off'), disc('25% off')],
      },
    ],
  },
  educator: {
    id: 'educator',
    name: 'Teachers & School Districts',
    switchLabel: 'Teachers & School Districts',
    bracket: 'adult',
    tiers: [
      {
        id: 'educator', name: 'Educator', role: 'Everyone starts here', priceNote: 'always', free: true,
        store: '5%', academy: '5%', mentor: '5% off all Academy material', revert: null,
        get: [{ kind: 'free', text: 'Free for every teacher & educator' }], granted: [], cells: [],
      },
      {
        id: 'catalyst', name: 'Catalyst', role: 'Competition toolkit', priceNote: 'per year',
        store: '5%', academy: '5%', mentor: '5% off all Academy material', revert: null,
        get: [{ kind: 'buy', text: 'Buy a Catalyst membership' }], granted: [], cells: [],
      },
      {
        id: 'innovator', name: 'Innovator', role: 'Mentoring & AI tools', priceNote: 'per year',
        store: '10%', academy: '10%', mentor: 'Group mentoring included — 8 × 30-min sessions each semester. Recorded for ongoing reference', revert: null,
        get: [{ kind: 'buy', text: 'Buy an Innovator membership' }], granted: [], cells: [],
      },
      {
        id: 'trailblazer', name: 'Trailblazer', role: 'For teachers who excel', priceNote: 'per year',
        store: '10%', academy: '10%', mentor: 'Group mentoring included — 8 × 30-min sessions each semester. Recorded for ongoing reference', revert: null,
        get: [{ kind: 'buy', text: 'Buy a Trailblazer membership' }], granted: [], cells: [],
      },
    ],
  },
}

export const AUDIENCE_ORDER: AudienceId[] = ['school', 'college', 'educator']

/** Flat list of every tier with its display name (for price lookup keyed by name). */
export const ALL_TIERS: { id: TierId; name: string }[] = AUDIENCE_ORDER.flatMap((a) =>
  AUDIENCES[a].tiers.map((t) => ({ id: t.id, name: t.name })),
)

/** Column labels for the school/college "what you still pay for" derivation. */
export const PURCHASABLE_LABELS = ['Events', 'Mentoring', 'Coaching', 'Merchandise', 'Training']

export interface ResolvedTier {
  id: TierId
  name: string
  audience: AudienceId
  bracket: Audience['bracket']
  free: boolean
  priceNote: string
  /** Pay-by-invoice is offered only on the educator / school-district paid tiers. */
  invoiceEligible: boolean
}

/** Resolve a tier slug (e.g. "catalyst") to its tier + audience metadata, or null. */
export function tierBySlug(slug: string): ResolvedTier | null {
  for (const aid of AUDIENCE_ORDER) {
    const aud = AUDIENCES[aid]
    const t = aud.tiers.find((x) => x.id === slug)
    if (t) {
      return {
        id: t.id,
        name: t.name,
        audience: aid,
        bracket: aud.bracket,
        free: !!t.free,
        priceNote: t.priceNote,
        invoiceEligible: aid === 'educator' && !t.free,
      }
    }
  }
  return null
}

/* ── "What you get" value cards (audience-aware) ──────────────────────────── */
export const VALUE_CARDS: Record<AudienceId, ValueCard[]> = {
  school: [
    { icon: 'team', title: 'Mentors who have done it', body: 'Small-group cohorts and 1:1 coaching with working engineers — get unstuck fast and learn the how and the why behind real projects.' },
    { icon: 'launch', title: 'Build things that work', body: 'Compete on hands-on engineering challenges, ship a real deliverable, and leave with a portfolio — not just theory.' },
    { icon: 'award', title: 'Recognition that travels', body: 'Win awards, earn your Scholar tier, and get proactive LinkedIn support that follows you into college and your first role.' },
  ],
  college: [
    { icon: 'team', title: 'Mentoring toward the job', body: 'Semester-long mentoring cohorts and 1:1 coaching aimed squarely at internships, placements and graduate positions.' },
    { icon: 'global', title: 'A network with leverage', body: 'Career preparation, LinkedIn references and warm introductions that help you land internships and graduate roles.' },
    { icon: 'orbit', title: 'Keep your momentum', body: 'Your school progress rolls into Alumni automatically, and your tier grows as you volunteer and contribute.' },
  ],
  educator: [
    { icon: 'document', title: 'A competition, ready to teach', body: 'Lesson plans, worksheets, judging templates and assessment tools — a full toolkit that drops straight into your classroom.' },
    { icon: 'idea', title: 'AI tools and live support', body: 'Agentic project advisors, sub-contractor tools, and live kick-off and close-out calls — so you never run a competition alone.' },
    { icon: 'certificate', title: 'Credentialed impact', body: 'CTE credits, CPD hours, standards alignment (Common Core, NGSS, ISTE) and student awards — measurable, recognised outcomes.' },
  ],
}

/* ── FAQ ──────────────────────────────────────────────────────────────────── */
export const FAQS: { q: string; a: string }[] = [
  { q: 'How do I join Stellr?', a: 'Create a free account and you’re an Explorer (school), Alumni (college) or Educator (teacher) straight away — no card, no trial. Upgrade whenever it makes sense for you.' },
  { q: 'Can I buy a paid tier directly?', a: 'Yes. If you see the benefit, sign up today! Otherwise, register for a Competition and you’ll automatically upgrade your membership.' },
  { q: 'What happens when my tier expires?', a: 'All tier increases are valid for 12 months — regardless of whether you were granted one through competition participation or purchased an upgrade. Refer to our Terms of Service if you’re looking for refund information.' },
  { q: 'What’s the difference between Store and Academy discounts?', a: 'They are two separate tracks. Your Store discount (5–10%) applies to merchandise in the web store. Your Academy discount (0–25%) applies to mentoring, coaching and training. Higher tiers carry deeper discounts on both.' },
  { q: 'Can a teacher or school district enrol students on their behalf?', a: 'Absolutely! A staff member, or nominated student manager, must register as a Stellr member — but they can do that as part of the competition registration process.' },
]

/* ── Educator content waterfall — 37 resources × 7 categories ─────────────── */
export interface WaterfallCategory { key: string; name: string; color: string }
export const WATERFALL_CATEGORIES: WaterfallCategory[] = [
  { key: 'core', name: 'Core material', color: '#13183A' },
  { key: 'student', name: 'Student support', color: '#3C6DF6' },
  { key: 'live', name: 'Live competition', color: '#7C5CFC' },
  { key: 'edu', name: 'Educator support', color: '#E0922F' },
  { key: 'cte', name: 'CTE & standards', color: '#1FA97A' },
  { key: 'ai', name: 'AI tools', color: '#16B6C4' },
  { key: 'mem', name: 'Student membership', color: '#E0A23A' },
]

/** t = educator tier index (0 Educator → 3 Trailblazer); c = category key. */
export interface WaterfallItem { t: number; c: string; x: string }
export const WATERFALL_ITEMS: WaterfallItem[] = [
  // Educator (free) — t:0 — 9 new
  { t: 0, c: 'core', x: 'RFP' },
  { t: 0, c: 'core', x: 'Mission Handbook' },
  { t: 0, c: 'core', x: 'Scoring Rubric' },
  { t: 0, c: 'student', x: 'Activity Planning — Basic' },
  { t: 0, c: 'student', x: 'Sub-Contractor Guide' },
  { t: 0, c: 'live', x: 'Campaign submission & written judging feedback' },
  { t: 0, c: 'edu', x: 'Competition Guide for Teachers' },
  { t: 0, c: 'edu', x: 'Assessment Tools — Basic' },
  { t: 0, c: 'mem', x: 'Students can register as members' },
  // Catalyst — t:1 — 9 new
  { t: 1, c: 'student', x: 'Activity Planning — Advanced' },
  { t: 1, c: 'student', x: 'Worksheets — cost control, Gantt, materials calc' },
  { t: 1, c: 'live', x: 'Intro & close-out calls' },
  { t: 1, c: 'edu', x: 'Assessment Tools — Intermediate' },
  { t: 1, c: 'edu', x: 'Intro + close-out slides' },
  { t: 1, c: 'edu', x: 'Judging template' },
  { t: 1, c: 'edu', x: 'Lesson plans' },
  { t: 1, c: 'edu', x: 'Curated resources (sites, books, videos)' },
  { t: 1, c: 'ai', x: 'AI ethics — student guide & teacher notes' },
  // Innovator — t:2 — 12 new
  { t: 2, c: 'student', x: 'Brainstorming templates' },
  { t: 2, c: 'student', x: 'Curated student resources' },
  { t: 2, c: 'live', x: 'Biweekly 30-min student feedback calls' },
  { t: 2, c: 'edu', x: 'Assessment Tools — Advanced' },
  { t: 2, c: 'edu', x: 'Question banks' },
  { t: 2, c: 'edu', x: 'Background / resource slides + talking notes' },
  { t: 2, c: 'edu', x: 'Reflection templates' },
  { t: 2, c: 'cte', x: 'Standards alignment — Common Core' },
  { t: 2, c: 'cte', x: 'Biweekly group mentoring calls (recorded)' },
  { t: 2, c: 'ai', x: 'Agentic sub-contractors' },
  { t: 2, c: 'ai', x: 'Agentic project advisor' },
  { t: 2, c: 'mem', x: 'Student participants invited as Explorer' },
  // Trailblazer — t:3 — 7 new
  { t: 3, c: 'live', x: 'Student awards presented' },
  { t: 3, c: 'live', x: 'Virtual presentation deliverable (Zoom)' },
  { t: 3, c: 'edu', x: 'LMS upload (SCORM)' },
  { t: 3, c: 'cte', x: 'Standards alignment — NGSS & ISTE' },
  { t: 3, c: 'cte', x: 'CTE credits' },
  { t: 3, c: 'ai', x: 'AI ethics — teacher guide, slides, talking points' },
  { t: 3, c: 'mem', x: 'Students upgraded to Pathfinder (12 months)' },
]

export const WATERFALL_TOTAL = WATERFALL_ITEMS.length // 37
