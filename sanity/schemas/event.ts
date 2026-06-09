export const event = {
  name: 'event',
  title: 'Event',
  type: 'document',
  fields: [
    // ── Identity ─────────────────────────────────────────────────────────────
    { name: 'title', type: 'string', title: 'Event Name' },
    { name: 'slug', type: 'slug', title: 'Slug', options: { source: 'title' } },

    // ── Activity Type ─────────────────────────────────────────────────────────
    // This is the primary discriminator. Live Events are facilitated by Stellr
    // staff at a fixed date/venue. Campaigns are asynchronous, educator-led
    // activities running over an academic term — billed and displayed differently.
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

    // ── Dates ─────────────────────────────────────────────────────────────────
    {
      name: 'date',
      type: 'date',
      title: 'Start Date',
      description: 'Live Events: event date. Campaigns: term start date.',
    },
    {
      name: 'endDate',
      type: 'date',
      title: 'End Date',
      description: 'Live Events: last day if multi-day. Campaigns: term end date.',
    },

    // ── Campaign-only ─────────────────────────────────────────────────────────
    {
      name: 'term',
      title: 'Term / Season Label',
      type: 'string',
      description: 'Display label for the academic term, e.g. "Fall 2026" or "Spring 2027".',
      hidden: ({ document }: { document?: Record<string, unknown> }) =>
        document?.activityType !== 'campaign',
    },

    // ── Live Event-only ───────────────────────────────────────────────────────
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

    // ── Registration ──────────────────────────────────────────────────────────
    { name: 'registrationOpen', type: 'boolean', title: 'Registration Open' },
    { name: 'registrationOpenDate', type: 'date', title: 'Registration Opens' },
    { name: 'registrationCloseDate', type: 'date', title: 'Registration Closes' },
    { name: 'capacity', type: 'number', title: 'Max Participants' },
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
  ],

  preview: {
    select: {
      title: 'title',
      activityType: 'activityType',
      date: 'date',
      media: 'image',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prepare(selection: Record<string, any>) {
      const { title, activityType, date, media } = selection
      const typeLabel = activityType === 'campaign' ? 'Campaign' : 'Live Event'
      return {
        title,
        subtitle: `${typeLabel}${date ? ` · ${date}` : ''}`,
        media,
      }
    },
  },
}
