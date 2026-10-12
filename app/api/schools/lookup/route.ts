import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { rateLimitGuard, HOUR_MS } from '@/lib/rate-limit'

// GET /api/schools/lookup?name=<school name>
// Best-effort address lookup via the Google Places API (New) Text Search.
// Public: used by the school picker on the public (www) registration form, so an
// unauthenticated registrant must be able to call it (returns only a best-effort
// public address, nothing sensitive). The Places key is server-side only
// (GOOGLE_PLACES_API_KEY, not NEXT_PUBLIC_) so it is never shipped to the browser.
//
// When the key is unset (e.g. a preview env without billing) we return
// { address: null } — the picker already treats that as "fill in manually",
// so the flow degrades gracefully instead of erroring.
//
// deep review PUB-7: Text Search is a PAID SKU. Left open it is a
// denial-of-wallet vector — anyone can loop GETs and spend the Google billing
// account (or exhaust a GCP daily quota so real registrants lose autofill). Three
// cheap defences below: a per-IP rate limit (the same warm-instance guard the
// public forms use), a minimum query length (no spend on near-empty/enumeration
// queries), and a cache keyed on the normalised query (repeat autofills of the
// same school cost one upstream call, not one per lookup).

// Minimum query length before we spend on an upstream lookup. The picker treats
// { address: null } as "type it in", so a shorter query degrades, not errors.
const MIN_QUERY_LEN = 4

interface GoogleAddressComponent {
  longText?: string
  shortText?: string
  types?: string[]
}

interface LookupResult {
  address: {
    address_line1: string | null
    city: string | null
    state: string | null
    postcode: string | null
  } | null
  place_id?: string | null
  formatted_address?: string | null
}

function component(components: GoogleAddressComponent[], type: string, prefer: 'long' | 'short' = 'long'): string | null {
  const match = components.find((c) => c.types?.includes(type))
  if (!match) return null
  return (prefer === 'short' ? match.shortText : match.longText) ?? null
}

// The actual upstream call + parse, cached by its (already-normalised) query.
// unstable_cache keys on both the keyParts below AND the function arguments, so
// each distinct `query` is a distinct cache entry. The API key is read inside
// (not passed in) so a secret never lands in the cache key. 24 h is well inside
// how often a school's address changes.
const lookupAddress = unstable_cache(
  async (query: string): Promise<LookupResult> => {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY
    if (!apiKey) {
      console.warn('[schools/lookup] GOOGLE_PLACES_API_KEY not set — address autofill disabled')
      return { address: null }
    }

    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        // Field mask keeps us on the cheapest SKU that still returns structured
        // address parts + a stable place_id we can later store for de-duping.
        'X-Goog-FieldMask': 'places.id,places.formattedAddress,places.addressComponents',
      },
      body: JSON.stringify({
        textQuery: query,
        regionCode: 'US',
        maxResultCount: 1,
      }),
    })

    if (!res.ok) {
      console.error('[schools/lookup] Places API error:', res.status, await res.text())
      return { address: null }
    }

    const data = await res.json()
    const place = data.places?.[0]
    if (!place) return { address: null }

    const components: GoogleAddressComponent[] = place.addressComponents ?? []

    const streetNumber = component(components, 'street_number')
    const route = component(components, 'route')

    const address = {
      address_line1: [streetNumber, route].filter(Boolean).join(' ') || null,
      city:
        component(components, 'locality') ??
        component(components, 'postal_town') ??
        component(components, 'sublocality') ??
        component(components, 'administrative_area_level_3') ??
        null,
      // Full state name (e.g. "Utah") to match the registration form's state
      // <select>, which uses full names rather than the "UT" short codes.
      state: component(components, 'administrative_area_level_1', 'long'),
      postcode: component(components, 'postal_code') ?? null,
    }

    // place_id / formatted_address are returned for future use (storing a stable
    // Google id on the school row to dedupe). The current picker reads `address`
    // only, so this is additive and safe.
    return {
      address,
      place_id: place.id ?? null,
      formatted_address: place.formattedAddress ?? null,
    }
  },
  ['schools-lookup'],
  { revalidate: 60 * 60 * 24 },
)

export async function GET(req: Request) {
  // deep review PUB-7: throttle per IP before spending anything. The guard is
  // per-warm-instance (see lib/rate-limit) — enough to turn a loop from one host
  // from unbounded spend into a trickle, which is what this protects against.
  const limited = rateLimitGuard(req, 'schools-lookup', { limit: 30, windowMs: HOUR_MS })
  if (limited) return limited

  const { searchParams } = new URL(req.url)
  const name = searchParams.get('name')?.trim() ?? ''
  // deep review PUB-7: no upstream call for empty/near-empty queries.
  if (name.length < MIN_QUERY_LEN) return NextResponse.json({ address: null })

  try {
    // Normalise so "Lincoln High" and "lincoln high" share one cache entry (and
    // one upstream call). Places Text Search is case-insensitive, so sending the
    // lower-cased query doesn't change the match.
    const result = await lookupAddress(name.toLowerCase())
    return NextResponse.json(result)
  } catch (e) {
    console.error('[schools/lookup] lookup failed:', e)
    return NextResponse.json({ address: null })
  }
}
