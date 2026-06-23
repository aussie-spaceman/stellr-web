import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'

const flagSchema = z.object({
  contentType: z.enum(['post', 'comment', 'resource']),
  contentId: z.string().uuid(),
  reason: z.string().trim().max(700).optional(),
})

// POST /api/community/flag — member or teacher flags a post, comment, or resource
// for admin review (FR-COM-07). Reports land in the space's Moderation queue.
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = flagSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { contentType, contentId, reason } = parsed.data

  const db = supabaseServer()

  // Prevent duplicate flags from the same member on the same content.
  const { data: existing } = await db
    .from('community_flags')
    .select('id')
    .eq('content_type', contentType)
    .eq('content_id', contentId)
    .eq('flagged_by', member.id)
    .eq('status', 'pending')
    .maybeSingle()

  if (existing) return NextResponse.json({ ok: true, duplicate: true })

  await db.from('community_flags').insert({
    content_type: contentType,
    content_id: contentId,
    flagged_by: member.id,
    reason: reason ?? null,
  })

  return NextResponse.json({ ok: true })
}
