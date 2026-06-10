export interface MaterialTier {
  tier: string
  access: string
  cardClass: string
  badgeClass: string
  items: string[]
}

export const MATERIAL_TIERS: MaterialTier[] = [
  {
    tier: 'Core Material',
    access: 'Free — public access',
    cardClass: 'border-green-200 bg-green-50',
    badgeClass: 'bg-green-100 text-green-800',
    items: ['Request for Proposal (RFP)', 'Mission Handbook'],
  },
  {
    tier: 'Baseline',
    access: 'Subscriber',
    cardClass: 'border-blue-200 bg-blue-50',
    badgeClass: 'bg-blue-100 text-blue-800',
    items: [
      'Delivery Overview',
      'NSES Curriculum Map',
      'Worksheets (cost, calculations, schedule etc.)',
      'Assessment Guides / Marking Rubric',
      'Student access to Community free training',
    ],
  },
  {
    tier: 'Advanced',
    access: 'Educator Member',
    cardClass: 'border-purple-200 bg-purple-50',
    badgeClass: 'bg-purple-100 text-purple-800',
    items: [
      'Multi-week lesson plans',
      'Agentic AI Sub-Contractors + PM tools',
      'Live kick-off and close-out calls',
      'Student certificates',
    ],
  },
  {
    tier: 'Premium',
    access: 'Premium Member',
    cardClass: 'border-amber-200 bg-amber-50',
    badgeClass: 'bg-amber-100 text-amber-800',
    items: [
      'Weekly mentoring calls (recorded & posted)',
      'Teacher CTE activity',
      'Student access to Community paid membership',
      'Student awards',
      'Student progression to Finals',
    ],
  },
]
