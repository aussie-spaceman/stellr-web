import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

// GET /api/schools/lookup?name=<school name>
// Best-effort address lookup via OpenStreetMap Nominatim
export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

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
