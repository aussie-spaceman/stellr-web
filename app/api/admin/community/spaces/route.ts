import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

// Admin CRUD for community Spaces (convergence P3 — Spaces are first-class
// objects). The dedicated /admin/community/spaces list. Access tiers are still
// set per space via min_tier_rank (and refined in the Access map); this page
// owns the space records themselves.

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export async function GET() {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = supabaseServer()
  const { data } = await db
    .from('community_spaces')
    .select('id, slug, name, description, min_tier_rank, display_order, is_archived')
    .order('display_order', { ascending: true })
  return NextResponse.json({ spaces: data ?? [] })
}

export async function POST(req: Request) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const b = await req.json().catch(() => ({}))
  if (!b.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
  const slug = b.slug?.trim() ? slugify(b.slug) : slugify(b.name)
  if (!slug) return NextResponse.json({ error: 'invalid slug' }, { status: 400 })

  const db = supabaseServer()
  const { data, error } = await db
    .from('community_spaces')
    .insert({
      slug,
      name: b.name.trim(),
      description: b.description?.trim() || null,
      min_tier_rank: Number.isFinite(b.min_tier_rank) ? b.min_tier_rank : 0,
      display_order: Number.isFinite(b.display_order) ? b.display_order : 0,
    })
    .select('id')
    .single()
  if (error) {
    const dup = error.code === '23505'
    return NextResponse.json({ error: dup ? 'A space with that slug already exists' : 'Could not create space' }, { status: dup ? 409 : 500 })
  }
  return NextResponse.json({ id: data.id })
}

export async function PATCH(req: Request) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const b = await req.json().catch(() => ({}))
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (b.name !== undefined) patch.name = String(b.name).trim()
  if (b.description !== undefined) patch.description = String(b.description).trim() || null
  if (b.min_tier_rank !== undefined) patch.min_tier_rank = Number(b.min_tier_rank) || 0
  if (b.display_order !== undefined) patch.display_order = Number(b.display_order) || 0
  if (b.is_archived !== undefined) patch.is_archived = !!b.is_archived

  const db = supabaseServer()
  const { error } = await db.from('community_spaces').update(patch).eq('id', b.id)
  if (error) return NextResponse.json({ error: 'Could not update space' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
