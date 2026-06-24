import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { logActivity } from '@/lib/activity-log'

function requireAdmin(sessionClaims: Record<string, unknown> | null | undefined) {
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  return role === 'admin'
}

// GET /api/admin/community/flags — list flags (default: pending only)
export async function GET(req: Request) {
  const { sessionClaims } = await auth()
  if (!requireAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? 'pending'

  const db = supabaseServer()
  const { data } = await db
    .from('community_flags')
    .select(`
      id, content_type, content_id, reason, status, created_at,
      flagged_by_member:flagged_by(first_name, last_name, email),
      resolved_by_member:resolved_by(first_name, last_name)
    `)
    .eq('status', status)
    .order('created_at', { ascending: false })

  return NextResponse.json({ flags: data ?? [] })
}

const resolveSchema = z.object({
  flagId: z.string().uuid(),
  action: z.enum(['resolved', 'dismissed']),
  // When action=resolved, optionally hide the content too.
  hideContent: z.boolean().optional(),
})

// PATCH /api/admin/community/flags — resolve or dismiss a flag (FR-COM-07)
export async function PATCH(req: Request) {
  const { sessionClaims } = await auth()
  if (!requireAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = resolveSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { flagId, action, hideContent } = parsed.data

  const admin = await getCurrentMember()
  const db = supabaseServer()

  const { data: flag } = await db
    .from('community_flags')
    .select('content_type, content_id, viewed_in_container')
    .eq('id', flagId)
    .maybeSingle()

  if (!flag) return NextResponse.json({ error: 'Flag not found' }, { status: 404 })

  await db
    .from('community_flags')
    .update({
      status: action,
      resolved_by: admin?.id ?? null,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', flagId)

  if (action === 'resolved' && hideContent) {
    if (flag.content_type === 'resource') {
      // Remove just the attachment in the container it was flagged from — the
      // binary and its other attachments survive (handover §4.7). Binary-wide
      // delete lives in the central admin index (PR4).
      if (flag.viewed_in_container) {
        await db
          .from('container_contents')
          .delete()
          .eq('container_id', flag.viewed_in_container as string)
          .in('content_type', ['resource', 'recording'])
          .eq('content_ref', flag.content_id)
      }
      // Log against the uploader (handover §4.7: action is auditable + author-facing).
      const { data: bin } = await db
        .from('community_resources')
        .select('uploaded_by, title')
        .eq('id', flag.content_id)
        .maybeSingle()
      const uploaderId = (bin?.uploaded_by as string | null) ?? null
      if (uploaderId) {
        logActivity({
          memberId: uploaderId,
          category: 'community',
          action: 'resource_attachment_removed',
          summary: `A flagged resource “${(bin?.title as string) ?? 'resource'}” was removed from an object by moderation`,
          metadata: { binaryId: flag.content_id, container: flag.viewed_in_container, flagId },
          actorType: 'admin',
          actorMemberId: admin?.id ?? null,
        }).catch(() => {})
      }
    } else {
      const table = flag.content_type === 'post' ? 'community_posts' : 'community_comments'
      await db.from(table).update({ status: 'hidden' }).eq('id', flag.content_id)
    }
  }

  return NextResponse.json({ ok: true })
}
