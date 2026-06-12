import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

// GET /api/schools/search?q=<query>
// Public: the school picker lives on the public (www) registration form, so an
// unauthenticated registrant must be able to search. Only non-sensitive
// reference data (name/city/state) is returned.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim() ?? ''

  if (q.length < 2) return NextResponse.json({ schools: [] })

  const db = supabaseServer()
  // Include legacy rows whose is_active was never set (NULL) — schools created
  // by registration linking / the 024 backfill predate the is_active default,
  // and excluding them is why existing schools didn't show up in search. Only
  // schools explicitly deactivated (is_active = false) are hidden.
  // Match name, city, or state so a town/state search also surfaces the school
  // (a name-only ilike missed schools users searched for by city). The two .or()
  // filters are AND-combined: (active) AND (name/city/state matches). Strip
  // PostgREST reserved chars (commas/parens) from the user input first.
  const safe = q.replace(/[(),]/g, ' ')
  const { data } = await db
    .from('schools')
    .select('id, name, city, state')
    .or('is_active.is.null,is_active.eq.true')
    .or(`name.ilike.%${safe}%,city.ilike.%${safe}%,state.ilike.%${safe}%`)
    .order('name')
    .limit(8)

  return NextResponse.json({ schools: data ?? [] })
}
