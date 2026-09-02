import { getCampaignDates } from '../../lib/campaigns'

// ── Slug rename guard ────────────────────────────────────────────────────────
// Validation runs in the Studio (a browser), so it can call the app's own API.
// Returns `true` on anything unexpected: a guard that can't reach the server
// must never block editing. scripts/audit-event-slugs.ts is the backstop.

type SlugValidationResult = true | string | Promise<true | string>
interface SlugValidationContext {
  document?: { _id?: string }
}

async function checkSlugRenameIsSafe(
  proposed: string,
  context: SlugValidationContext,
): Promise<true | string> {
  if (typeof window === 'undefined') return true // not an interactive edit
  const id = (context?.document?._id ?? '').replace(/^drafts\./, '')
  if (!id) return true
  try {
    const res = await fetch(
      `/api/admin/events/slug-guard?id=${encodeURIComponent(id)}&slug=${encodeURIComponent(proposed)}`,
    )
    if (!res.ok) return true
    const data = (await res.json()) as { blocked?: boolean; message?: string }
    if (data.blocked && data.message) return data.message
  } catch {
    return true
  }
  return true
}

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
      description:
        'URL path segment AND the join key to every registration, refund, order and ' +
        'company record for this event. Changing it on a published event orphans that ' +
        'data — the rename must be mirrored in the database (see the error you will get ' +
        'if you try). Click "Generate" rather than typing here.',
      // Slug is the join key to registrations/portal data — publishing without one
      // breaks the admin Events tab and registration links.
      //
      // It also becomes the URL path segment (/events/<slug>, /register/<slug>),
      // so it MUST be URL-safe: lowercase letters, numbers and hyphens only.
      // Free text with spaces or punctuation (e.g. a tagline pasted into this
      // field) produces a path Next.js can't route, which 404s both links while
      // the card still renders. Always click "Generate" rather than typing here.
      //
      // The second check is the one that cost us: Postgres has no foreign key to
      // Sanity, so renaming a published slug silently strands every row filed
      // under the old value (30 rows across five tables, 21 Aug 2026). The guard
      // asks the app whether this document's PUBLISHED slug still has data and
      // blocks the change if so, naming the script that migrates it.
      validation: (Rule: {
        required: () => {
          custom: (
            fn: (v: { current?: string } | undefined, ctx: SlugValidationContext) => SlugValidationResult,
          ) => unknown
        }
      }) =>
        Rule.required().custom((value, context) => {
          const current = value?.current
          if (!current) return true // handled by required()
          if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(current)) {
            return 'Use lowercase letters, numbers and hyphens only — no spaces or punctuation. Click "Generate" to build one from the title.'
          }
          return checkSlugRenameIsSafe(current, context)
        }),
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
      description:
        'The SCHOOL year the campaign belongs to — the year it ends in. Both terms of ' +
        '2026/27 are 2027: Fall 2027 runs Aug–Dec 2026, Spring 2027 runs Jan–Apr 2027.',
      hidden: ({ document }: { document?: Record<string, unknown> }) =>
        document?.activityType !== 'campaign',
      validation: (Rule: { custom: (fn: (v: unknown, ctx: { document?: Record<string, unknown> }) => true | string) => unknown }) =>
        Rule.custom((value, context) => {
          if (context.document?.activityType === 'campaign' && !value) return 'Campaign year is required'
          return true
        }),
    },

    // ── Campaign-only: Proposal deadline & deliverable ────────────────────────
    // Campaigns are asynchronous — groups work at their own pace and submit a
    // deliverable before this hard deadline. Unlike the season window (which is
    // derived), the deadline is authored explicitly so it can fall wherever the
    // programme sets it (e.g. Spring 2026 proposals due 15 May 2026).
    {
      name: 'deadline',
      title: 'Proposal Deadline',
      type: 'date',
      description: 'The date the student proposal is due. Shown as the deadline banner across the site and app.',
      hidden: ({ document }: { document?: Record<string, unknown> }) =>
        document?.activityType !== 'campaign',
      // The deadline is authored, the season window is derived — so they can
      // disagree. They did: a Fall 2027 campaign carried a deadline of
      // 2026-12-11, which reads as a year out until you know campaignYear is a
      // SCHOOL year. Cross-checking the two here catches that at authoring time
      // instead of leaving it to surface as a wrong date on the public site.
      validation: (Rule: { custom: (fn: (v: unknown, ctx: { document?: Record<string, unknown> }) => true | string) => unknown }) =>
        Rule.custom((value, context) => {
          const doc = context.document
          if (doc?.activityType !== 'campaign') return true
          if (!value) return 'A proposal deadline is required for campaigns'
          const season = doc.season
          const year = doc.campaignYear
          if ((season !== 'fall' && season !== 'spring') || typeof year !== 'number') return true
          const dates = getCampaignDates(season, year)
          if (typeof value !== 'string' || value < dates.startDate || value > dates.endDate) {
            return `Deadline must fall inside the ${dates.label} window (${dates.startDate} to ${dates.endDate}). ` +
              `Remember Campaign Year is the SCHOOL year — ${dates.label} runs in ${dates.calendarYear}.`
          }
          return true
        }),
    },
    {
      name: 'deliverable',
      title: 'Deliverable',
      type: 'string',
      description: 'What each group submits — e.g. "A written proposal". Defaults to a proposal.',
      initialValue: 'A written proposal',
      hidden: ({ document }: { document?: Record<string, unknown> }) =>
        document?.activityType !== 'campaign',
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

    // ── Landing-page map ──────────────────────────────────────────────────────
    // Coordinates drive the pins on the "Where we run" map used by the audience
    // landing pages (see lib/locations.ts). Deliberately optional: a location
    // with no coordinates still counts in the legend and appears in the
    // accessible location list, it just has no pin — which is a better failure
    // than a pin defaulted to (0, 0) in the Gulf of Guinea.
    {
      name: 'latitude',
      type: 'number',
      title: 'Latitude',
      description: 'Decimal degrees. Used only by the landing-page location map.',
      validation: (Rule: { min: (n: number) => { max: (n: number) => unknown } }) =>
        Rule.min(-90).max(90),
      hidden: ({ document }: { document?: Record<string, unknown> }) =>
        document?.activityType === 'campaign',
    },
    {
      name: 'longitude',
      type: 'number',
      title: 'Longitude',
      description: 'Decimal degrees. Used only by the landing-page location map.',
      validation: (Rule: { min: (n: number) => { max: (n: number) => unknown } }) =>
        Rule.min(-180).max(180),
      hidden: ({ document }: { document?: Record<string, unknown> }) =>
        document?.activityType === 'campaign',
    },
    // Untick to keep a real, dated event off the marketing map without touching
    // its dates or slug — clearing a date would look like a draft to every other
    // consumer, and renaming a slug has orphaned production rows before.
    {
      name: 'showOnLocationMap',
      type: 'boolean',
      title: 'Show on landing-page map',
      description:
        'On by default. Untick for an event that should not appear on the audience ' +
        'landing pages\u2019 "Where we run" map.',
      initialValue: true,
      hidden: ({ document }: { document?: Record<string, unknown> }) =>
        document?.activityType === 'campaign',
    },

    // ── Content & Display ─────────────────────────────────────────────────────
    { name: 'tagline', type: 'string', title: 'Tagline' },
    { name: 'description', type: 'array', title: 'Description', of: [{ type: 'block' }] },
    { name: 'image', type: 'image', title: 'Hero Image', options: { hotspot: true } },

    // ── Flyers & handouts ─────────────────────────────────────────────────────
    // Public marketing PDFs. Deliberately a Sanity file rather than a path into
    // /public: the bytes then hang off this document, so a slug rename can't
    // strand them, a re-issued flyer is an upload rather than a commit + deploy,
    // and the season's ~40MB of PDFs never lands in git history. Studio uploads
    // go straight to Sanity's asset API, so Vercel's 4.5MB request-body cap
    // (which constrains every in-app upload route) doesn't apply here either.
    //
    // An array because most events have more than one: the 3pp flyer plus the
    // 1pp version, and at some venues a Homeschool and a Robotics variant.
    {
      name: 'flyers',
      title: 'Flyers & Handouts',
      type: 'array',
      description:
        'Public marketing PDFs, shown as downloads on the event page. Leave empty and the ' +
        'Downloads section is hidden entirely. These are open — no email gate — so a teacher ' +
        'can forward one to colleagues.',
      of: [
        {
          type: 'object',
          fields: [
            {
              name: 'label',
              type: 'string',
              title: 'Label',
              description: 'What the download button says — e.g. "Event Flyer", "Homeschool Flyer".',
              initialValue: 'Event Flyer',
              validation: (Rule: { required: () => unknown }) => Rule.required(),
            },
            {
              name: 'file',
              type: 'file',
              title: 'PDF',
              options: { accept: 'application/pdf' },
              validation: (Rule: { required: () => unknown }) => Rule.required(),
            },
            {
              name: 'pages',
              type: 'number',
              title: 'Page count',
              description:
                'Optional — renders as "3-page PDF" beside the file size. Leave blank and the ' +
                'card shows the size alone. scripts/upload-event-flyers.ts fills this in.',
            },
          ],
          preview: {
            select: { title: 'label', subtitle: 'file.asset.originalFilename' },
          },
        },
      ],
    },
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
      // New campaigns start explicitly open. Left unset this is falsy, so a
      // campaign nobody had switched on read Closed everywhere — and, now that
      // it is a real gate, would have rejected registrations outright.
      initialValue: true,
      description:
        'Manual on/off switch for campaign registration. This really does gate the ' +
        'registration API — switching it off stops sign-ups, it is not just a label. ' +
        'Live events ignore this — their status is derived from the Registration ' +
        'Opens/Closes dates below (both empty = open).',
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
    // Retired Aug 2026. Eligibility is now standard copy rendered from the
    // event page itself (derived from Grade Level), so every event states the
    // same rules — hand-authored notes here had drifted out of date. Hidden
    // rather than deleted so the stored strings survive if we ever want them.
    {
      name: 'eligibility',
      type: 'string',
      title: 'Eligibility Notes (retired — no longer displayed)',
      hidden: true,
    },

    // ── Settings ──────────────────────────────────────────────────────────────
    { name: 'featured', type: 'boolean', title: 'Feature on homepage' },
    {
      name: 'stripePriceId',
      type: 'string',
      title: 'Stripe Price ID',
      description:
        'Live Event individual registration fee — copy the Price ID from Stripe (e.g. price_xxxxx). ' +
        'This amount is DISPLAYED PUBLICLY on the event page, so it must be an active, one-off price ' +
        'in the live Stripe account: an inactive or unknown price ID hides the fee on the page and is ' +
        'also rejected at checkout. A FREE event needs its own $0 price object here — do not leave ' +
        'this blank for one. Blank means the fee simply is not set yet, and the page reads ' +
        '"Pricing TBC". Not applicable for Campaigns.',
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
        // 'fall' sorts before 'spring' alphabetically, which is correct:
        // within a school year, Fall (Aug–Dec, prior calendar year) comes
        // before Spring (Jan–Apr)
        { field: 'season', direction: 'asc' },
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
