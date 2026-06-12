import { NextResponse } from 'next/server'

// GET /api/schools/lookup?name=<school name>
// Best-effort address lookup via OpenStreetMap Nominatim.
// Public: used by the school picker on the public (www) registration form, so an
// unauthenticated registrant must be able to call it (returns only a best-effort
// public address, nothing sensitive).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const name = searchParams.get('name')?.trim() ?? ''
  if (!name) return NextResponse.json({ address: null })

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&format=json&limit=1&countrycodes=us&addressdetails=1`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Stellr/1.0 (contact@insimeducation.com)' },
    })
    const results = await res.json()

    if (!results?.length) return NextResponse.json({ address: null })

    const r = results[0]
    const a = r.address ?? {}

    const address = {
      address_line1: [a.house_number, a.road].filter(Boolean).join(' ') || null,
      city: a.city ?? a.town ?? a.village ?? a.county ?? null,
      state: a.state ?? null,
      postcode: a.postcode ?? null,
    }

    return NextResponse.json({ address })
  } catch {
    return NextResponse.json({ address: null })
  }
}
