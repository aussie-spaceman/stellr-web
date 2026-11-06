import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { communityWriteBlock } from '@/lib/community'
import { getOnboardedMember } from '@/lib/onboarded-member'
import { assertNotImpersonating } from '@/lib/impersonation'
import { memberCanSeeComment, memberCanSeePost } from '@/lib/spaces'

const reactionSchema = z.object({
  targetType: z.enum(['post', 'comment']),
  targetId: z.guid(),
  emoji: z.string().min(1).max(16),
})

// POST /api/community/reactions — toggle an emoji reaction on a post or comment.
export async function POST(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getOnboardedMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  // Decision 24: age and guardian-consent restrictions (lib/community).
  const restricted = await communityWriteBlock(member, 'react')
  if (restricted) return restricted

  const parsed = reactionSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { targetType, targetId, emoji } = parsed.data

  const db = supabaseServer()

  // Toggle: delete if present, otherwise insert.
  const { data: existing } = await db
    .from('community_reactions')
    .select('id')
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .eq('author_member_id', member.id)
    .eq('emoji', emoji)
    .maybeSingle()

  if (existing) {
    await db.from('community_reactions').delete().eq('id', existing.id)
    return NextResponse.json({ reacted: false })
  }

  // A new reaction needs a target the member can see, with the same answer as for
  // an id that does not exist. Taking back their own, above, is always allowed.
  const canSee = targetType === 'post' ? await memberCanSeePost(member, targetId) : await memberCanSeeComment(member, targetId)
  if (!canSee) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await db.from('community_reactions').insert({
    target_type: targetType,
    target_id: targetId,
    author_member_id: member.id,
    emoji,
  })

  if (error) {
    console.error('[community] reaction insert error:', error)
    return NextResponse.json({ error: 'Failed to react' }, { status: 500 })
  }

  return NextResponse.json({ reacted: true })
}
