import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

// Per-space admin config actions (Spaces design, screens 11–17 + modals 19/21/22).
// One JSON action router keeps the (many) small mutations in one place. Resource
// uploads (multipart) live in ./resources.

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}
const RESERVED = new Set(['general', 'resources', 'training', 'announcements', 'members'])
function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId, sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id: spaceId } = await params
  const b = await req.json().catch(() => ({}))
  const action = b.action as string
  const db = supabaseServer()

  // Resolve the acting admin's member id (for invited_by / resolved_by).
  let adminMemberId: string | null = null
  if (userId) {
    const { data } = await db.from('members').select('id').eq('clerk_user_id', userId).maybeSingle()
    adminMemberId = (data as { id: string } | null)?.id ?? null
  }

  switch (action) {
    // ── Access & tiers ──────────────────────────────────────────────────────
    case 'set-tiers': {
      const tierIds: string[] = Array.isArray(b.tierIds) ? b.tierIds : []
      await db.from('community_space_tiers').delete().eq('space_id', spaceId)
      if (tierIds.length) {
        await db.from('community_space_tiers').insert(tierIds.map((tier_id) => ({ space_id: spaceId, tier_id })))
      }
      return NextResponse.json({ ok: true })
    }

    // ── Channels ──────────────────────────────────────────────────────────────
    case 'add-channel': {
      const name = String(b.name ?? '').trim()
      if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
      const slug = slugify(name)
      if (!slug || RESERVED.has(slug)) return NextResponse.json({ error: 'Reserved or invalid channel name' }, { status: 400 })
      const { data: last } = await db
        .from('community_channels')
        .select('display_order')
        .eq('space_id', spaceId)
        .order('display_order', { ascending: false })
        .limit(1)
        .maybeSingle()
      const order = ((last as { display_order: number } | null)?.display_order ?? -1) + 1
      const { error } = await db
        .from('community_channels')
        .insert({ space_id: spaceId, slug, name, display_order: order })
      if (error) {
        const dup = (error as { code?: string }).code === '23505'
        return NextResponse.json({ error: dup ? 'A channel with that name exists' : 'Could not add channel' }, { status: dup ? 409 : 500 })
      }
      return NextResponse.json({ ok: true })
    }
    case 'rename-channel': {
      const name = String(b.name ?? '').trim()
      if (!b.channelId || !name) return NextResponse.json({ error: 'channelId and name required' }, { status: 400 })
      await db.from('community_channels').update({ name }).eq('id', b.channelId).eq('space_id', spaceId)
      return NextResponse.json({ ok: true })
    }
    case 'delete-channel': {
      if (!b.channelId) return NextResponse.json({ error: 'channelId required' }, { status: 400 })
      await db.from('community_channels').delete().eq('id', b.channelId).eq('space_id', spaceId)
      return NextResponse.json({ ok: true })
    }

    // ── Members & roles ────────────────────────────────────────────────────────
    case 'invite-member': {
      const role = ['admin', 'mentor', 'member'].includes(b.role) ? b.role : 'member'
      let memberId = b.memberId as string | undefined
      if (!memberId && b.email) {
        const { data } = await db
          .from('members')
          .select('id')
          .ilike('email', String(b.email).trim())
          .maybeSingle()
        memberId = (data as { id: string } | null)?.id
      }
      if (!memberId) return NextResponse.json({ error: 'No member found for that email' }, { status: 404 })
      const { error } = await db.from('community_space_members').upsert(
        {
          space_id: spaceId,
          member_id: memberId,
          role,
          status: 'invited',
          invited_by: adminMemberId,
          invited_at: new Date().toISOString(),
        },
        { onConflict: 'space_id,member_id' }
      )
      if (error) return NextResponse.json({ error: 'Could not invite member' }, { status: 500 })
      return NextResponse.json({ ok: true })
    }
    case 'update-member-role': {
      const role = ['admin', 'mentor', 'member'].includes(b.role) ? b.role : 'member'
      if (!b.memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })
      await db.from('community_space_members').update({ role }).eq('space_id', spaceId).eq('member_id', b.memberId)
      return NextResponse.json({ ok: true })
    }
    case 'remove-member': {
      if (!b.memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })
      await db.from('community_space_members').delete().eq('space_id', spaceId).eq('member_id', b.memberId)
      return NextResponse.json({ ok: true })
    }

    // ── Training ────────────────────────────────────────────────────────────────
    case 'assign-training': {
      if (!b.moduleId) return NextResponse.json({ error: 'moduleId required' }, { status: 400 })
      const { data: last } = await db
        .from('community_space_training')
        .select('display_order')
        .eq('space_id', spaceId)
        .order('display_order', { ascending: false })
        .limit(1)
        .maybeSingle()
      const order = ((last as { display_order: number } | null)?.display_order ?? -1) + 1
      await db.from('community_space_training').upsert(
        { space_id: spaceId, training_module_id: b.moduleId, is_mandatory: !!b.mandatory, display_order: order },
        { onConflict: 'space_id,training_module_id' }
      )
      return NextResponse.json({ ok: true })
    }
    case 'set-training-mandatory': {
      if (!b.moduleId) return NextResponse.json({ error: 'moduleId required' }, { status: 400 })
      await db
        .from('community_space_training')
        .update({ is_mandatory: !!b.mandatory })
        .eq('space_id', spaceId)
        .eq('training_module_id', b.moduleId)
      return NextResponse.json({ ok: true })
    }
    case 'remove-training': {
      if (!b.moduleId) return NextResponse.json({ error: 'moduleId required' }, { status: 400 })
      await db.from('community_space_training').delete().eq('space_id', spaceId).eq('training_module_id', b.moduleId)
      return NextResponse.json({ ok: true })
    }

    // ── Announcements ─────────────────────────────────────────────────────────
    case 'publish-announcement': {
      const title = String(b.title ?? '').trim()
      if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })
      await db.from('community_announcements').insert({
        space_id: spaceId,
        author_member_id: adminMemberId,
        title,
        body: String(b.body ?? '').trim() || null,
      })
      return NextResponse.json({ ok: true })
    }
    case 'delete-announcement': {
      if (!b.announcementId) return NextResponse.json({ error: 'announcementId required' }, { status: 400 })
      await db.from('community_announcements').delete().eq('id', b.announcementId).eq('space_id', spaceId)
      return NextResponse.json({ ok: true })
    }

    // ── Resources ──────────────────────────────────────────────────────────────
    case 'remove-resource': {
      if (!b.resourceId) return NextResponse.json({ error: 'resourceId required' }, { status: 400 })
      await db.from('community_resources').delete().eq('id', b.resourceId).eq('space_id', spaceId)
      return NextResponse.json({ ok: true })
    }

    // ── Moderation ─────────────────────────────────────────────────────────────
    case 'remove-post': {
      if (!b.flagId) return NextResponse.json({ error: 'flagId required' }, { status: 400 })
      const { data: flag } = await db
        .from('community_flags')
        .select('content_type, content_id')
        .eq('id', b.flagId)
        .maybeSingle()
      const f = flag as { content_type: string; content_id: string } | null
      if (f?.content_type === 'post') {
        await db.from('community_posts').update({ status: 'hidden' }).eq('id', f.content_id)
      } else if (f?.content_type === 'comment') {
        await db.from('community_comments').update({ status: 'hidden' }).eq('id', f.content_id)
      }
      await db
        .from('community_flags')
        .update({ status: 'resolved', resolved_by: adminMemberId, resolved_at: new Date().toISOString() })
        .eq('id', b.flagId)
      return NextResponse.json({ ok: true })
    }
    case 'dismiss-flag': {
      if (!b.flagId) return NextResponse.json({ error: 'flagId required' }, { status: 400 })
      await db
        .from('community_flags')
        .update({ status: 'dismissed', resolved_by: adminMemberId, resolved_at: new Date().toISOString() })
        .eq('id', b.flagId)
      return NextResponse.json({ ok: true })
    }
    case 'mute-member': {
      // No per-space mute store yet — acknowledge so the UI can confirm. Tracked
      // as a follow-up (would add a community_space_members.muted flag + gate).
      return NextResponse.json({ ok: true, note: 'mute not yet enforced' })
    }

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}
