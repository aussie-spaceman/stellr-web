import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { ensureSpaceContainer } from '@/lib/container-sync'

// Admin CRUD for community Spaces (Spaces design — list / create / delete).
// Per-space config (channels, tiers, members, resources, training, announcements,
// moderation) is handled by /api/admin/community/spaces/[id].

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}
function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
const ACCESS = new Set(['open', 'private', 'secret'])
const THEME = new Set(['space', 'enviro', 'campaign', 'college'])

export async function GET() {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = supabaseServer()
  const { data } = await db
    .from('community_spaces')
    .select('id, slug, name, description, access_type, theme, posting_policy, allow_member_uploads, display_order, is_archived')
    .order('display_order', { ascending: true })
  return NextResponse.json({ spaces: data ?? [] })
}

export async function POST(req: Request) {
  const { userId, sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const b = await req.json().catch(() => ({}))
  if (!b.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
  const slug = b.slug?.trim() ? slugify(b.slug) : slugify(b.name)
  if (!slug) return NextResponse.json({ error: 'invalid slug' }, { status: 400 })

  const access_type = ACCESS.has(b.access_type) ? b.access_type : 'open'
  const db = supabaseServer()
  const { data, error } = await db
    .from('community_spaces')
    .insert({
      slug,
      name: b.name.trim(),
      description: b.description?.trim() || null,
      access_type,
      theme: THEME.has(b.theme) ? b.theme : 'space',
      min_tier_rank: access_type === 'open' ? 0 : 1,
      display_order: Number.isFinite(b.display_order) ? b.display_order : 0,
    })
    .select('id')
    .single()
  if (error) {
    const dup = error.code === '23505'
    return NextResponse.json(
      { error: dup ? 'A space with that slug already exists' : 'Could not create space' },
      { status: dup ? 409 : 500 }
    )
  }

  // Every space starts with a default "general" channel + a sync container.
  await db.from('community_channels').insert({ space_id: data.id, slug: 'general', name: 'General', display_order: 0 })
  await ensureSpaceContainer(db, slug, b.name.trim())

  // Seed the creating admin as an active space member so the new space shows ≥1
  // member from the outset (counts are status='active' only).
  if (userId) {
    const { data: me } = await db.from('members').select('id').eq('clerk_user_id', userId).maybeSingle()
    const creatorId = (me as { id: string } | null)?.id
    if (creatorId) {
      await db.from('community_space_members').insert({
        space_id: data.id,
        member_id: creatorId,
        role: 'admin',
        status: 'active',
        accepted_at: new Date().toISOString(),
      })
    }
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
  if (b.access_type !== undefined && ACCESS.has(b.access_type)) {
    patch.access_type = b.access_type
    patch.min_tier_rank = b.access_type === 'open' ? 0 : 1
  }
  if (b.theme !== undefined && THEME.has(b.theme)) patch.theme = b.theme
  if (b.posting_policy !== undefined && ['all', 'moderators'].includes(b.posting_policy)) patch.posting_policy = b.posting_policy
  if (b.allow_member_uploads !== undefined) patch.allow_member_uploads = !!b.allow_member_uploads
  if (b.display_order !== undefined) patch.display_order = Number(b.display_order) || 0
  if (b.is_archived !== undefined) patch.is_archived = !!b.is_archived

  const db = supabaseServer()
  const { error } = await db.from('community_spaces').update(patch).eq('id', b.id)
  if (error) return NextResponse.json({ error: 'Could not update space' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = supabaseServer()
  // Channels / posts / members / tiers / training / announcements cascade via FKs.
  const { error } = await db.from('community_spaces').delete().eq('id', b.id)
  if (error) return NextResponse.json({ error: 'Could not delete space' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
