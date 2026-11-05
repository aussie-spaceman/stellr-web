import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { getOnboardedMember } from '@/lib/onboarded-member'
import { assertNotImpersonating } from '@/lib/impersonation'
import { memberCanSeeComment, memberCanSeePost } from '@/lib/spaces'
import { memberCanSeeResource } from '@/lib/resources-catalogue'

// Ids use z.guid() (any UUID-shaped string, as zod 3's uuid() was) across the
// API: zod 4's z.uuid() also checks RFC version/variant bits, which the dev
// seed's fixed ids (e.g. seed-commons, 00000000-0000-4000-f000-…) fail.
const flagSchema = z.object({
  contentType: z.enum(['post', 'comment', 'resource']),
  contentId: z.guid(),
  reason: z.string().trim().max(700).optional(),
  // Resource flags (handover §4.3): optional free-text note + the container the
  // resource was viewed in (the same binary can be fine in one object, not another).
  note: z.string().trim().max(700).optional(),
  containerRef: z.guid().optional(),
})

// POST /api/community/flag — member or teacher flags a post, comment, or resource
// for admin review (FR-COM-07). Reports land in the space's Moderation queue.
export async function POST(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getOnboardedMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = flagSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { contentType, contentId, reason, note, containerRef } = parsed.data

  // Only content the member can see can be reported. Same answer as for an id that
  // does not exist.
  const canSee =
    contentType === 'post'
      ? await memberCanSeePost(member, contentId)
      : contentType === 'comment'
        ? await memberCanSeeComment(member, contentId)
        : await memberCanSeeResource(member, contentId, containerRef)
  if (!canSee) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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
    note: note ?? null,
    // Only a resource report keeps a container: the check above is what vouches for it.
    viewed_in_container: contentType === 'resource' ? (containerRef ?? null) : null,
  })

  return NextResponse.json({ ok: true })
}
