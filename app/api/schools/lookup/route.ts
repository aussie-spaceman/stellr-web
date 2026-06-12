import { NextResponse } from 'next/server'

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

interface GoogleAddressComponent {
  longText?: string
  shortText?: string
  types?: string[]
}

function component(components: GoogleAddressComponent[], type: string, prefer: 'long' | 'short' = 'long'): string | null {
  const match = components.find((c) => c.types?.includes(type))
  if (!match) return null
  return (prefer === 'short' ? match.shortText : match.longText) ?? null
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const name = searchParams.get('name')?.trim() ?? ''
  if (!name) return NextResponse.json({ address: null })

  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    console.warn('[schools/lookup] GOOGLE_PLACES_API_KEY not set — address autofill disabled')
    return NextResponse.json({ address: null })
  }

  try {
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
        textQuery: name,
        regionCode: 'US',
        maxResultCount: 1,
      }),
    })

    if (!res.ok) {
      console.error('[schools/lookup] Places API error:', res.status, await res.text())
      return NextResponse.json({ address: null })
    }

    const data = await res.json()
    const place = data.places?.[0]
    if (!place) return NextResponse.json({ address: null })

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
    return NextResponse.json({
      address,
      place_id: place.id ?? null,
      formatted_address: place.formattedAddress ?? null,
    })
  } catch (e) {
    console.error('[schools/lookup] lookup failed:', e)
    return NextResponse.json({ address: null })
  }
}
