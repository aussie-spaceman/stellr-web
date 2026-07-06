import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getAllEvents, getAllCampaigns } from '@/lib/sanity'

// GET /api/admin/community/spaces/sources/search?type=event|training|mentoring|coaching&q=…
// Powers the Access-tab object picker: resolve human-friendly options for linking
// an Object to a Space (community_space_sources). Returns { ref, label } where
// `ref` is what gets stored as object_ref (event slug / module id / cohort id).
export async function GET(req: Request) {
  const { sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') ?? ''
  const q = (searchParams.get('q') ?? '').trim().toLowerCase()
  const options: { ref: string; label: string }[] = []

  if (type === 'event') {
    const [events, campaigns] = await Promise.all([getAllEvents(), getAllCampaigns()])
    const all = [...(events ?? []), ...(campaigns ?? [])] as Array<{ title?: string; slug?: { current?: string } }>
    for (const e of all) {
      const ref = e.slug?.current
      if (!ref) continue
      const label = e.title ?? ref
      if (!q || label.toLowerCase().includes(q) || ref.toLowerCase().includes(q)) options.push({ ref, label })
    }
  } else if (type === 'training') {
    const db = supabaseServer()
    let query = db.from('training_modules').select('id, title').order('title').limit(25)
    if (q) query = query.ilike('title', `%${q}%`)
    const { data } = await query
    for (const m of (data ?? []) as Array<{ id: string; title: string }>) options.push({ ref: m.id, label: m.title })
  } else if (type === 'mentoring' || type === 'coaching') {
    const db = supabaseServer()
    let query = db.from('mentoring_cohorts').select('id, name').eq('container_type', type).order('name').limit(25)
    if (q) query = query.ilike('name', `%${q}%`)
    const { data } = await query
    for (const c of (data ?? []) as Array<{ id: string; name: string | null }>) options.push({ ref: c.id, label: c.name ?? c.id })
  } else {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 })
  }

  return NextResponse.json({ options: options.slice(0, 25) })
}
