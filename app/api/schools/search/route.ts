import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'

// GET /api/schools/search?q=<query>
export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim() ?? ''

  if (q.length < 2) return NextResponse.json({ schools: [] })

  const db = supabaseServer()
  const { data } = await db
    .from('schools')
    .select('id, name, city, state')
    .eq('is_active', true)
    .ilike('name', `%${q}%`)
    .order('name')
    .limit(8)

  return NextResponse.json({ schools: data ?? [] })
}
