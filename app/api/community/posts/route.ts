import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, getSpaceBySlug, memberCanAccessSpace, tiptapToPlainText } from '@/lib/community'
import { getSpaceForMember, canPostInSpace } from '@/lib/spaces'
import { getChannelPosts } from '@/lib/space-posts'
import { extractMentionIds, notifyMentions } from '@/lib/mentions'

const createPostSchema = z.object({
  spaceSlug: z.string().min(1),
  // When posting into a channel (Spaces design). Omitted = legacy flat-space post.
  channelSlug: z.string().min(1).optional(),
  title: z.string().trim().max(300).optional(),
  bodyJson: z.unknown().optional(),
})

// GET /api/community/posts?channelId=… — hydrated channel feed (used for the
// realtime refetch when a live post/reply event arrives).
export async function GET(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const channelId = new URL(req.url).searchParams.get('channelId')
  if (!channelId) return NextResponse.json({ error: 'channelId required' }, { status: 400 })

  const db = supabaseServer()
  const { data: ch } = await db
    .from('community_channels')
    .select('id, space_id, community_spaces(slug)')
    .eq('id', channelId)
    .maybeSingle()
  if (!ch) return NextResponse.json({ error: 'Channel not found' }, { status: 404 })

  const rel = (ch as { community_spaces: { slug: string } | { slug: string }[] | null }).community_spaces
  const slug = Array.isArray(rel) ? rel[0]?.slug : rel?.slug
  if (!slug) return NextResponse.json({ error: 'Channel not found' }, { status: 404 })

  const space = await getSpaceForMember(member, slug)
  if (!space || !space.access.canAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!space.channels.some((c) => c.id === channelId)) {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
  }

  const posts = await getChannelPosts(channelId, space.id, member.id)
  return NextResponse.json({ posts })
}

// POST /api/community/posts — create a post. Channel path uses the Spaces access
// model (access_type + roster) and posting policy; legacy path is unchanged.
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = createPostSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }
  const { spaceSlug, channelSlug, title, bodyJson } = parsed.data
  const db = supabaseServer()
  const bodyText = tiptapToPlainText(bodyJson)

  // ── Channel post (Spaces design) ──────────────────────────────────────────
  if (channelSlug) {
    if (!bodyText.trim() && !(title ?? '').trim()) {
      return NextResponse.json({ error: 'Post is empty' }, { status: 400 })
    }
    const space = await getSpaceForMember(member, spaceSlug)
    if (!space || !space.access.canAccess) {
      return NextResponse.json({ error: 'No access to this space' }, { status: 403 })
    }
    if (space.myMuted) {
      return NextResponse.json({ error: 'You have been muted in this space' }, { status: 403 })
    }
    if (!canPostInSpace(member, space.postingPolicy, space.myRole, space.myMuted)) {
      return NextResponse.json({ error: 'Posting is limited to moderators' }, { status: 403 })
    }
    const channel = space.channels.find((c) => c.slug === channelSlug)
    if (!channel) return NextResponse.json({ error: 'Channel not found' }, { status: 404 })

    const { data, error } = await db
      .from('community_posts')
      .insert({
        space_id: space.id,
        channel_id: channel.id,
        author_member_id: member.id,
        title: (title ?? '').trim(),
        body_json: bodyJson ?? null,
        body_text: bodyText,
      })
      .select('id')
      .single()
    if (error) {
      console.error('[community] channel post insert error:', error)
      return NextResponse.json({ error: 'Failed to create post' }, { status: 500 })
    }

    fireMentions(bodyJson, member, data.id, spaceSlug)
    return NextResponse.json({ id: data.id, spaceSlug, channelSlug })
  }

  // ── Legacy flat-space post ──────────────────────────────────────────────────
  if (!(title ?? '').trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }
  const space = await getSpaceBySlug(spaceSlug)
  if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  if (!(await memberCanAccessSpace(member, space))) {
    return NextResponse.json({ error: 'Upgrade required' }, { status: 403 })
  }

  const { data, error } = await db
    .from('community_posts')
    .insert({
      space_id: space.id,
      author_member_id: member.id,
      title: (title ?? '').trim(),
      body_json: bodyJson ?? null,
      body_text: bodyText,
    })
    .select('id')
    .single()
  if (error) {
    console.error('[community] post insert error:', error)
    return NextResponse.json({ error: 'Failed to create post' }, { status: 500 })
  }

  fireMentions(bodyJson, member, data.id, spaceSlug)
  return NextResponse.json({ id: data.id, spaceSlug })
}

function fireMentions(
  bodyJson: unknown,
  member: { id: string; first_name: string | null; last_name: string | null },
  postId: string,
  spaceSlug: string
) {
  const mentionIds = extractMentionIds(bodyJson)
  if (!mentionIds.length) return
  notifyMentions({
    mentionIds,
    actorMemberId: member.id,
    actorName: [member.first_name, member.last_name].filter(Boolean).join(' ') || 'A member',
    context: 'post',
    postId,
    spaceSlug,
  }).catch((e) => console.error('[community] mention notify error:', e))
}
