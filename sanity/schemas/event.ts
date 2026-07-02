export const event = {
  name: 'event',
  title: 'Event',
  type: 'document',
  fields: [
    // ── Identity ─────────────────────────────────────────────────────────────
    { name: 'title', type: 'string', title: 'Event Name' },
    {
      name: 'slug',
      type: 'slug',
      title: 'Slug',
      options: { source: 'title' },
      // Slug is the join key to registrations/portal data — publishing without one
      // breaks the admin Events tab and registration links.
      validation: (Rule: { required: () => unknown }) => Rule.required(),
    },

    // ── Activity Type ─────────────────────────────────────────────────────────
    // Primary discriminator — controls which fields are visible below.
    {
      name: 'activityType',
      title: 'Activity Type',
      type: 'string',
      description:
        'Live Events: fixed date, Stellr-facilitated, in-person or virtual. ' +
        'Campaigns: asynchronous, educator-led, term-length — free to join.',
      options: {
        list: [
          { title: 'Live Event', value: 'live_event' },
          { title: 'Campaign', value: 'campaign' },
        ],
        layout: 'radio',
      },
      initialValue: 'live_event',
      validation: (Rule: { required: () => unknown }) => Rule.required(),
    },

    // ── Theme & Audience ──────────────────────────────────────────────────────
    {
      name: 'type',
      type: 'string',
      title: 'Theme',
      description: 'The competition theme this event or campaign is based on.',
      options: {
        list: [
          { title: 'Space Design', value: 'Space Design Challenge' },
          { title: 'Environmental Design', value: 'Environmental Design Challenge' },
        ],
      },
    },
    {
      name: 'gradeLevel',
      type: 'string',
      title: 'Grade Level',
      options: { list: ['Middle School', 'High School', 'Both'] },
    },

    // ── Campaign-only: Season & Year ──────────────────────────────────────────
    // Selecting a season determines all campaign dates automatically:
    //   Fall   → Campaign: Aug 15 – Dec 15  |  Registration: Aug 1 – Nov 30
    //   Spring → Campaign: Jan 1  – Apr 30  |  Registration: Dec 1 (prior yr) – Mar 31
    {
      name: 'season',
      title: 'Season',
      type: 'string',
      description:
        'Fall — Campaign runs Aug 15 – Dec 15. Registration opens Aug 1, closes Nov 30.\n' +
        'Spring — Campaign runs Jan 1 – Apr 30. Registration opens Dec 1 (prior year), closes Mar 31.',
      options: {
        list: [
          { title: 'Fall', value: 'fall' },
          { title: 'Spring', value: 'spring' },
        ],
        layout: 'radio',
      },
      hidden: ({ document }: { document?: Record<string, unknown> }) =>
        document?.activityType !== 'campaign',
      validation: (Rule: { custom: (fn: (v: unknown, ctx: { document?: Record<string, unknown> }) => true | string) => unknown }) =>
        Rule.custom((value, context) => {
          if (context.document?.activityType === 'campaign' && !value) return 'Season is required for campaigns'
          return true
        }),
    },

    {
      name: 'campaignYear',
      title: 'Campaign Year',
      type: 'number',
      description: 'The calendar year the campaign takes place in — e.g. 2026 for Fall 2026, 2027 for Spring 2027.',
      hidden: ({ document }: { document?: Record<string, unknown> }) =>
        document?.activityType !== 'campaign',
      validation: (Rule: { custom: (fn: (v: unknown, ctx: { document?: Record<string, unknown> }) => true | string) => unknown }) =>
        Rule.custom((value, context) => {
          if (context.document?.activityType === 'campaign' && !value) return 'Campaign year is required'
          return true
        }),
    },

    // ── Live Event-only: Dates ────────────────────────────────────────────────
    {
      name: 'date',
      type: 'date',
      title: 'Event Date',
      hidden: ({ document }: { document?: Record<string, unknown> }) =>
        document?.activityType === 'campaign',
    },
    {
      name: 'endDate',
      type: 'date',
      title: 'End Date (if multi-day)',
      hidden: ({ document }: { document?: Record<string, unknown> }) =>
        document?.activityType === 'campaign',
    },

    // ── Live Event-only: Venue ────────────────────────────────────────────────
    {
      name: 'setting',
      title: 'Setting',
      type: 'string',
      options: {
        list: [
          { title: 'In-Person', value: 'in_person' },
          { title: 'Virtual', value: 'virtual' },
        ],
        layout: 'radio',
      },
      initialValue: 'in_person',
      hidden: ({ document }: { document?: Record<string, unknown> }) =>
        document?.activityType === 'campaign',
    },
    {
      name: 'venue',
      type: 'string',
      title: 'Venue Name',
      hidden: ({ document }: { document?: Record<string, unknown> }) =>
        document?.activityType === 'campaign',
    },
    {
      name: 'city',
      type: 'string',
      title: 'City',
      hidden: ({ document }: { document?: Record<string, unknown> }) =>
        document?.activityType === 'campaign',
    },
    {
      name: 'state',
      type: 'string',
      title: 'State',
      hidden: ({ document }: { document?: Record<string, unknown> }) =>
        document?.activityType === 'campaign',
    },

    // ── Content & Display ─────────────────────────────────────────────────────
    { name: 'tagline', type: 'string', title: 'Tagline' },
    { name: 'description', type: 'array', title: 'Description', of: [{ type: 'block' }] },
    { name: 'image', type: 'image', title: 'Hero Image', options: { hotspot: true } },
    {
      name: 'schedule',
      title: 'Schedule',
      type: 'array',
      description:
        'Agenda rows shown on the event page. Leave empty to hide the Schedule section entirely.',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'time', type: 'string', title: 'Time', description: 'e.g. "Day 1 — 09:00"' },
            { name: 'label', type: 'string', title: 'Activity' },
          ],
          preview: { select: { title: 'time', subtitle: 'label' } },
        },
      ],
      hidden: ({ document }: { document?: Record<string, unknown> }) =>
        document?.activityType === 'campaign',
    },

    // ── Registration ──────────────────────────────────────────────────────────
    // For campaigns, registrationOpen is a manual on/off toggle.
    // Registration dates are automatic (derived from season+year) — not stored.
    // For live events, all three fields apply.
    {
      name: 'registrationOpen',
      type: 'boolean',
      title: 'Registration Open (campaigns only)',
      description:
        'Manual on/off switch for campaign registration. Live events ignore this — their ' +
        'status is derived from the Registration Opens/Closes dates below (both empty = open).',
      hidden: ({ document }: { document?: Record<string, unknown> }) =>
        document?.activityType !== 'campaign',
    },
    {
      name: 'registrationOpenDate',
      type: 'date',
      title: 'Registration Opens',
      hidden: ({ document }: { document?: Record<string, unknown> }) =>
        document?.activityType === 'campaign',
    },
    {
      name: 'registrationCloseDate',
      type: 'date',
      title: 'Registration Closes',
      hidden: ({ document }: { document?: Record<string, unknown> }) =>
        document?.activityType === 'campaign',
    },
    {
      name: 'capacity',
      type: 'number',
      title: 'Max Participants',
      hidden: ({ document }: { document?: Record<string, unknown> }) =>
        document?.activityType === 'campaign',
    },
    { name: 'eligibility', type: 'string', title: 'Eligibility Notes' },

    // ── Settings ──────────────────────────────────────────────────────────────
    { name: 'featured', type: 'boolean', title: 'Feature on homepage' },
    {
      name: 'stripePriceId',
      type: 'string',
      title: 'Stripe Price ID',
      description:
        'Live Event individual registration fee — copy the Price ID from Stripe (e.g. price_xxxxx). Leave blank for free events. Not applicable for Campaigns.',
      hidden: ({ document }: { document?: Record<string, unknown> }) =>
        document?.activityType === 'campaign',
    },
  ],

  orderings: [
    {
      title: 'Event Date, Soonest First',
      name: 'dateAsc',
      by: [{ field: 'date', direction: 'asc' }],
    },
    {
      title: 'Campaign Year & Season',
      name: 'campaignAsc',
      by: [
        { field: 'campaignYear', direction: 'asc' },
        // 'spring' sorts after 'fall' alphabetically, which is correct:
        // within a given year, Spring (Jan–Apr) comes before Fall (Aug–Dec)
        { field: 'season', direction: 'desc' },
      ],
    },
  ],

  preview: {
    select: {
      title: 'title',
      activityType: 'activityType',
      date: 'date',
      season: 'season',
      campaignYear: 'campaignYear',
      media: 'image',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prepare(selection: Record<string, any>) {
      const { title, activityType, date, season, campaignYear, media } = selection
      if (activityType === 'campaign') {
        const seasonLabel =
          season === 'fall'
            ? `Fall ${campaignYear ?? ''}`
            : season === 'spring'
              ? `Spring ${campaignYear ?? ''}`
              : ''
        return { title, subtitle: `Campaign · ${seasonLabel}`.trim(), media }
      }
      return {
        title,
        subtitle: `Live Event${date ? ` · ${date}` : ''}`,
        media,
      }
    },
  },
}
