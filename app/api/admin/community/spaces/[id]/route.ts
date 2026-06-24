import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { notifyMember } from '@/lib/notify'
import { sendEmail } from '@/lib/email'
import { createPendingSpaceInvite } from '@/lib/spaces'

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
      // Invites grant member or mentor only — admin is assigned later via Manage.
      const role = b.role === 'mentor' ? 'mentor' : 'member'
      let memberId = b.memberId as string | undefined
      if (!memberId && b.email) {
        const { data } = await db
          .from('members')
          .select('id')
          .ilike('email', String(b.email).trim())
          .maybeSingle()
        memberId = (data as { id: string } | null)?.id
      }
      // No account yet for this email → can't create a roster row (member_id is a
      // hard FK). Park a PENDING invite by email + email them a sign-up link; the
      // Clerk user.created webhook auto-claims it into a real 'invited' roster row
      // when they register (see claimPendingSpaceInvites).
      if (!memberId) {
        const email = String(b.email ?? '').trim()
        if (!email) return NextResponse.json({ error: 'An email is required to invite' }, { status: 400 })
        const parked = await createPendingSpaceInvite(spaceId, email, role, adminMemberId)
        if (!parked) return NextResponse.json({ error: 'A valid email is required to invite' }, { status: 400 })
        const { data: space } = await db
          .from('community_spaces')
          .select('name')
          .eq('id', spaceId)
          .maybeSingle()
        const spaceName = (space as { name: string } | null)?.name ?? 'a Stellr space'
        const signUpUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.stellreducation.org'}/sign-up`
        await sendEmail({
          to: email,
          subject: `You're invited to ${spaceName} on Stellr`,
          html: `<p>You've been invited to join the <strong>${spaceName}</strong> space on Stellr.</p>
<p><a href="${signUpUrl}">Create your account</a> — your invitation will be waiting on your Spaces directory when you sign in.</p>`,
          text: `You've been invited to join ${spaceName} on Stellr. Create your account and your invitation will be waiting on your Spaces directory: ${signUpUrl}`,
        }).catch((e) => console.error('[spaces] invite-by-email send error:', e))
        return NextResponse.json({ ok: true, invitedByEmail: true })
      }

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

      // Notify the invitee (in-app + email, respecting their prefs). Best-effort —
      // the invite row is already written, so a notification failure must not 500.
      void (async () => {
        const { data: space } = await db
          .from('community_spaces')
          .select('name, slug')
          .eq('id', spaceId)
          .maybeSingle()
        const sp = space as { name: string; slug: string } | null
        if (!sp) return
        const url = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.stellreducation.org'}/community`
        await notifyMember(memberId!, {
          type: 'invite',
          body: `You've been invited to join ${sp.name}.`,
          referenceType: 'space',
          referenceId: spaceId,
          actorMemberId: adminMemberId ?? undefined,
          email: {
            subject: `You're invited to ${sp.name}`,
            html: `<p>You've been invited to join the <strong>${sp.name}</strong> space on Stellr.</p>
<p><a href="${url}">Open your Spaces directory</a> to accept the invitation.</p>`,
            text: `You've been invited to join ${sp.name} on Stellr. Open your Spaces directory to accept: ${url}`,
          },
        })
      })().catch((e) => console.error('[spaces] invite notify error:', e))

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
      // Mute a member in this space (read-only — the post/comment write paths
      // check community_space_members.muted). Callable two ways:
      //   • directly with memberId (admin Manage-member modal), or
      //   • with flagId from the moderation queue (resolve the flagged author).
      let memberId = b.memberId as string | undefined
      if (!memberId && b.flagId) {
        const { data: flag } = await db
          .from('community_flags')
          .select('content_type, content_id')
          .eq('id', b.flagId)
          .maybeSingle()
        const f = flag as { content_type: string; content_id: string } | null
        if (f?.content_type === 'post') {
          const { data } = await db.from('community_posts').select('author_member_id').eq('id', f.content_id).maybeSingle()
          memberId = (data as { author_member_id: string } | null)?.author_member_id
        } else if (f?.content_type === 'comment') {
          const { data } = await db.from('community_comments').select('author_member_id').eq('id', f.content_id).maybeSingle()
          memberId = (data as { author_member_id: string } | null)?.author_member_id
        }
      }
      if (!memberId) return NextResponse.json({ error: 'Could not resolve member to mute' }, { status: 404 })

      // Members can post in open spaces without a roster row, so upsert one
      // carrying the mute rather than only updating an existing row.
      const { data: existing } = await db
        .from('community_space_members')
        .select('id')
        .eq('space_id', spaceId)
        .eq('member_id', memberId)
        .maybeSingle()
      if (existing) {
        await db.from('community_space_members').update({ muted: true }).eq('id', (existing as { id: string }).id)
      } else {
        await db.from('community_space_members').insert({ space_id: spaceId, member_id: memberId, role: 'member', status: 'active', muted: true })
      }

      // Resolve the originating flag (if any) so the report leaves the queue.
      if (b.flagId) {
        await db
          .from('community_flags')
          .update({ status: 'resolved', resolved_by: adminMemberId, resolved_at: new Date().toISOString() })
          .eq('id', b.flagId)
      }
      return NextResponse.json({ ok: true })
    }
    case 'unmute-member': {
      if (!b.memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })
      await db.from('community_space_members').update({ muted: false }).eq('space_id', spaceId).eq('member_id', b.memberId)
      return NextResponse.json({ ok: true })
    }

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}
