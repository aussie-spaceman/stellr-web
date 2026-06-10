import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, tiptapToPlainText } from '@/lib/community'
import { sendEmail, communityAnnouncementEmail } from '@/lib/email'

function requireAdmin(sessionClaims: Record<string, unknown> | null | undefined) {
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  return role === 'admin'
}

const announcementSchema = z.object({
  spaceId: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  bodyJson: z.unknown().optional(),
  emailAll: z.boolean().optional(), // also blast email to all active members
})

// POST /api/admin/community/announcements — create a pinned announcement post (FR-COM-05).
export async function POST(req: Request) {
  const { sessionClaims } = await auth()
  if (!requireAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = announcementSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { spaceId, title, bodyJson, emailAll } = parsed.data

  const admin = await getCurrentMember()
  const db = supabaseServer()
  const bodyText = tiptapToPlainText(bodyJson)

  const { data: post, error } = await db
    .from('community_posts')
    .insert({
      space_id: spaceId,
      author_member_id: admin?.id ?? null,
      title,
      body_json: bodyJson ?? null,
      body_text: bodyText,
      is_announcement: true,
      is_pinned: true,
    })
    .select('id, community_spaces(slug)')
    .single()

  if (error) {
    console.error('[community] announcement insert error:', error)
    return NextResponse.json({ error: 'Failed to create announcement' }, { status: 500 })
  }

  const spaceSlug = Array.isArray(post.community_spaces)
    ? post.community_spaces[0]?.slug
    : (post.community_spaces as { slug: string } | null)?.slug ?? 'general'

  const postUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.stellreducation.org'}/community/${spaceSlug}/${post.id}`

  // Create in-app notifications for all active members.
  const { data: members } = await db
    .from('members')
    .select('id, first_name, email')
    .eq('is_active', true)

  if (members && members.length > 0) {
    await db.from('community_notifications').insert(
      members.map((m) => ({
        recipient_member_id: m.id,
        actor_member_id: admin?.id ?? null,
        type: 'announcement' as const,
        reference_type: 'post',
        reference_id: post.id,
        body: title,
      }))
    )

    // Optionally email all members (FR-COM-06).
    if (emailAll) {
      const snippet = bodyText.slice(0, 200)
      await Promise.allSettled(
        members
          .filter((m) => m.email)
          .map((m) => {
            const { subject, html, text } = communityAnnouncementEmail({
              recipientFirstName: m.first_name ?? 'there',
              title,
              body: snippet,
              url: postUrl,
            })
            return sendEmail({ to: m.email, subject, html, text })
          })
      )
    }
  }

  return NextResponse.json({ id: post.id, spaceSlug })
}

// GET /api/admin/community/announcements — list all announcement posts
export async function GET() {
  const { sessionClaims } = await auth()
  if (!requireAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = supabaseServer()
  const { data } = await db
    .from('community_posts')
    .select('id, title, status, created_at, community_spaces(name, slug)')
    .eq('is_announcement', true)
    .order('created_at', { ascending: false })

  return NextResponse.json({ announcements: data ?? [] })
}
