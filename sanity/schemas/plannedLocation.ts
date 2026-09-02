// A venue we intend to run at but have not scheduled yet.
//
// These exist so the "Where we run" map on the audience landing pages can show
// reach we have not dated yet, without inventing stub `event` documents. A stub
// event would leak into /events, the sitemap, registration and the Space
// provisioning that all key off event slugs — which has bitten this codebase
// before. A planned location is deliberately inert: nothing but the map reads it.
//
// Adding or retiring one is a Studio edit, not a deploy. The legend counts on
// the landing pages derive from these documents plus the live events (see
// lib/locations.ts), so they cannot disagree with what is published here.

export const plannedLocation = {
  name: 'plannedLocation',
  type: 'document',
  title: 'Planned Location',
  description:
    'A venue in planning, shown on the landing-page map as "Planned". Not an event: ' +
    'it has no dates, no registration and no page of its own.',
  fields: [
    {
      name: 'venue',
      type: 'string',
      title: 'Venue Name',
      description: 'e.g. "Baylor University". Shown in the accessible location list.',
      validation: (Rule: { required: () => unknown }) => Rule.required(),
    },
    {
      name: 'city',
      type: 'string',
      title: 'City',
      validation: (Rule: { required: () => unknown }) => Rule.required(),
    },
    {
      name: 'state',
      type: 'string',
      title: 'State',
      description:
        'Two-letter code or full name — both are normalised. Must be a US state: ' +
        'anything else is excluded from the US map.',
      validation: (Rule: { required: () => unknown }) => Rule.required(),
    },
    {
      name: 'theme',
      type: 'string',
      title: 'Theme',
      description: 'Colour codes meaning on the map, so this drives the pin colour.',
      options: {
        list: [
          { title: 'Space Design', value: 'space' },
          { title: 'Environmental Design', value: 'enviro' },
        ],
        layout: 'radio',
      },
      initialValue: 'space',
      validation: (Rule: { required: () => unknown }) => Rule.required(),
    },
    {
      name: 'latitude',
      type: 'number',
      title: 'Latitude',
      description:
        'Decimal degrees. Leave blank and the location still counts in the legend ' +
        'and appears in the accessible list — it just has no pin.',
      validation: (Rule: { min: (n: number) => { max: (n: number) => unknown } }) =>
        Rule.min(-90).max(90),
    },
    {
      name: 'longitude',
      type: 'number',
      title: 'Longitude',
      description: 'Decimal degrees.',
      validation: (Rule: { min: (n: number) => { max: (n: number) => unknown } }) =>
        Rule.min(-180).max(180),
    },
    {
      name: 'targetSeason',
      type: 'string',
      title: 'Target Season',
      description: 'Internal only — never rendered. e.g. "Spring 2028".',
    },
    {
      name: 'notes',
      type: 'text',
      rows: 3,
      title: 'Internal Notes',
      description: 'Internal only — never rendered.',
    },
  ],
  preview: {
    select: { venue: 'venue', city: 'city', state: 'state', theme: 'theme' },
    prepare({ venue, city, state, theme }: Record<string, string | undefined>) {
      return {
        title: `${venue ?? 'Unnamed venue'} — ${city ?? '?'}, ${state ?? '?'}`,
        subtitle: `Planned · ${theme === 'enviro' ? 'Environmental' : 'Space'}`,
      }
    },
  },
}
