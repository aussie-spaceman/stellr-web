import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'

const reactionSchema = z.object({
  targetType: z.enum(['post', 'comment']),
  targetId: z.string().uuid(),
  emoji: z.string().min(1).max(16),
})

// POST /api/community/reactions — toggle an emoji reaction on a post or comment.
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

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
