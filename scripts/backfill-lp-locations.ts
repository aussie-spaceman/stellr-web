/**
 * Populate the location data behind the landing-page map.
 *
 *   npx tsx scripts/backfill-lp-locations.ts            # dry run, writes nothing
 *   npx tsx scripts/backfill-lp-locations.ts --apply    # writes to Sanity
 *
 * Three jobs:
 *   1. Geocode and stamp latitude/longitude onto the live in-person events.
 *   2. Untick `showOnLocationMap` on the two dated events that should not be on
 *      the marketing map (see MAP_EXCLUSIONS below).
 *   3. Create one `plannedLocation` document per venue in planning.
 *
 * Idempotent: an event that already has coordinates is left alone, and a
 * planned location is matched on its slug before being created. Safe to re-run.
 *
 * Coordinates come from the Places API rather than being typed in, because a
 * transposed digit puts a competition in the wrong state and nothing in the
 * pipeline would catch it. (The Geocoding API is not enabled on this project's
 * key; Places searchText is, and returns the same location field.)
 */
import { config as loadEnv } from 'dotenv'
import { resolve } from 'node:path'

// Loaded before the Sanity client module is imported: ESM hoists imports above
// top-level statements, so a static `import { client }` here would capture an
// unconfigured client and silently no-op.
loadEnv({ path: resolve(process.cwd(), '.env.local') })

const APPLY = process.argv.includes('--apply')

/** Dated live events that must not appear on the landing-page map. */
const MAP_EXCLUSIONS: { slug: string; why: string }[] = [
  {
    slug: 'texas-space-design-competition',
    why: 'Austin — removed from the published location list (David, 2 Sep 2026)',
  },
  {
    slug: 'north-carolina-space-design-challenge',
    why: 'Raleigh — reclassified as planned, so it shows via its plannedLocation document instead',
  },
]

/** Venue queries for the live events, keyed by slug. */
const EVENT_VENUES: Record<string, string> = {
  'nevada-space-design-challenge': 'University of Nevada Las Vegas, Las Vegas, NV',
  'nebraska-space-design-challenge':
    'Strategic Air Command & Aerospace Museum, Ashland, NE',
  'south-dakota-space-design-challenge': 'South Dakota State University, Brookings, SD',
  'colorado-space-design-challenge': 'STEM School Highlands Ranch, Highlands Ranch, CO',
  'colorado-environmental-design-challenge': 'CSU Spur, Denver, CO',
  'minnesota-environmental-design-challenge': 'Minnesota State University Mankato, Mankato, MN',
}

const PLANNED: {
  slug: string
  venue: string
  city: string
  state: string
  theme: 'space' | 'enviro'
  query: string
}[] = [
  { slug: 'baylor-waco-tx', venue: 'Baylor University', city: 'Waco', state: 'TX', theme: 'space', query: 'Baylor University, Waco, TX' },
  { slug: 'st-marys-raleigh-nc', venue: "St Mary's School", city: 'Raleigh', state: 'NC', theme: 'space', query: "Saint Mary's School, Raleigh, NC" },
  { slug: 'iowa-state-ames-ia', venue: 'Iowa State University', city: 'Ames', state: 'IA', theme: 'space', query: 'Iowa State University, Ames, IA' },
  { slug: 'jsc-houston-tx', venue: 'NASA Johnson Space Center', city: 'Houston', state: 'TX', theme: 'space', query: 'NASA Johnson Space Center, Houston, TX' },
]

interface Coords {
  lat: number
  lng: number
  matched: string
}

async function geocode(query: string): Promise<Coords | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) throw new Error('GOOGLE_PLACES_API_KEY is not set')
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location',
    },
    body: JSON.stringify({ textQuery: query }),
  })
  if (!res.ok) {
    console.error(`  ✗ geocode failed (${res.status}) for "${query}": ${await res.text()}`)
    return null
  }
  const json = (await res.json()) as {
    places?: { location?: { latitude: number; longitude: number }; formattedAddress?: string }[]
  }
  const place = json.places?.[0]
  if (!place?.location) {
    console.error(`  ✗ no result for "${query}"`)
    return null
  }
  return {
    lat: place.location.latitude,
    lng: place.location.longitude,
    matched: place.formattedAddress ?? '',
  }
}

async function main() {
  const { client } = await import('../lib/sanity')
  if (!client) throw new Error('Sanity client is not configured — check .env.local')
  console.log(APPLY ? '── APPLYING ──' : '── DRY RUN (pass --apply to write) ──')

  /* ── 1 + 2. Events ─────────────────────────────────────────────────────── */
  const events = await client.fetch<
    { _id: string; title: string; slug?: { current?: string }; city?: string; state?: string; latitude?: number; showOnLocationMap?: boolean }[]
  >(`*[_type == "event" && defined(slug.current)]{ _id, title, slug, city, state, latitude, showOnLocationMap }`)

  console.log(`\n${events.length} event documents\n`)

  for (const event of events) {
    const slug = event.slug?.current
    if (!slug) continue

    const exclusion = MAP_EXCLUSIONS.find((e) => e.slug === slug)
    if (exclusion) {
      if (event.showOnLocationMap === false) {
        console.log(`  = ${slug} already off the map`)
      } else {
        console.log(`  - ${slug} → showOnLocationMap: false\n      ${exclusion.why}`)
        if (APPLY) await client.patch(event._id).set({ showOnLocationMap: false }).commit()
      }
      continue
    }

    const query = EVENT_VENUES[slug]
    if (!query) continue
    if (typeof event.latitude === 'number') {
      console.log(`  = ${slug} already has coordinates`)
      continue
    }

    const coords = await geocode(query)
    if (!coords) continue
    console.log(
      `  + ${slug} → ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}\n      ${coords.matched}`,
    )
    if (APPLY) {
      await client
        .patch(event._id)
        .set({ latitude: coords.lat, longitude: coords.lng, showOnLocationMap: true })
        .commit()
    }
  }

  /* ── 3. Planned locations ──────────────────────────────────────────────── */
  console.log('\nPlanned locations\n')
  const existing = await client.fetch<{ _id: string; slug?: { current?: string } }[]>(
    `*[_type == "plannedLocation"]{ _id, slug }`,
  )
  const bySlug = new Map(existing.map((p) => [p.slug?.current, p._id]))

  for (const site of PLANNED) {
    if (bySlug.has(site.slug)) {
      console.log(`  = ${site.slug} already exists`)
      continue
    }
    const coords = await geocode(site.query)
    if (!coords) continue
    console.log(
      `  + ${site.venue}, ${site.city} ${site.state} → ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}\n      ${coords.matched}`,
    )
    if (APPLY) {
      await client.create({
        _type: 'plannedLocation',
        // A deterministic id makes a re-run after a partial failure a no-op
        // rather than a duplicate pin in the same city.
        _id: `plannedLocation.${site.slug}`,
        slug: { _type: 'slug', current: site.slug },
        venue: site.venue,
        city: site.city,
        state: site.state,
        theme: site.theme,
        latitude: coords.lat,
        longitude: coords.lng,
      })
    }
  }

  console.log(APPLY ? '\n✓ Applied.' : '\n✓ Dry run complete — nothing written.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
