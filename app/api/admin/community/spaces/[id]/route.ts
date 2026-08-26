import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { notifyMember } from '@/lib/notify'
import { sendEmail } from '@/lib/email'
import { createPendingSpaceInvite, spaceNotificationAudience, resolveSpaceAudience, resolveDerivedGrant } from '@/lib/spaces'
import { logActivity, actorFromAuth } from '@/lib/activity-log'
import { attachSpaceResource, ensureSpaceContainer } from '@/lib/container-sync'
import { sanitizeBracketRequirements, anyBracketMandatory } from '@/lib/space-training'
import { syncSpaceSourceRoster } from '@/lib/space-inheritance'

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
    // Grant this space to a set of web-app roles (Access Convergence). Replaces the
    // full set each save, mirroring set-tiers.
    case 'set-roles': {
      const roles: string[] = Array.isArray(b.roles) ? b.roles.filter((r: unknown) => typeof r === 'string') : []
      await db.from('community_space_roles').delete().eq('space_id', spaceId)
      if (roles.length) {
        await db.from('community_space_roles').insert(roles.map((role) => ({ space_id: spaceId, role })))
      }
      return NextResponse.json({ ok: true })
    }
    // Link an Object to this space — members assigned to it inherit space access.
    case 'add-source': {
      const objectType = String(b.objectType ?? '')
      const objectRef = String(b.objectRef ?? '').trim()
      if (!['event', 'training', 'mentoring', 'coaching'].includes(objectType) || !objectRef) {
        return NextResponse.json({ error: 'objectType and objectRef required' }, { status: 400 })
      }
      await db.from('community_space_sources').upsert(
        { space_id: spaceId, object_type: objectType, object_ref: objectRef, created_by: adminMemberId },
        { onConflict: 'space_id,object_type,object_ref', ignoreDuplicates: true },
      )
      // Backfill: roster members already assigned to this Object into the space
      // (syncObjectSpaceRoster only covers members assigned AFTER the link).
      await syncSpaceSourceRoster(db, spaceId, objectType as 'event' | 'training' | 'mentoring' | 'coaching', objectRef)
      return NextResponse.json({ ok: true })
    }
    case 'remove-source': {
      if (!b.sourceId) return NextResponse.json({ error: 'sourceId required' }, { status: 400 })
      await db.from('community_space_sources').delete().eq('id', String(b.sourceId)).eq('space_id', spaceId)
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
      // Invites grant Moderator (the only role the invite flow assigns); base
      // membership is inherited from an Object, never invited in.
      const role = b.role === 'moderator' ? 'moderator' : 'member'
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
      const role = ['admin', 'moderator', 'member'].includes(b.role) ? b.role : 'member'
      const memberId = b.memberId as string | undefined
      if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })

      // The Space role is an OVERLAY carried by a roster row, but access itself is
      // usually derived — tier, web-app role, open space or a linked Object all
      // grant entry without writing a row. This used to be a bare UPDATE, so for
      // any derived member it matched nothing, returned ok, and the admin was told
      // "Role saved" while the role reverted on the next refresh.
      if (role === 'member') {
        // Demotion. Deleting the row is right for someone who is ALSO derived —
        // their badge goes back to naming the real source. It would remove access
        // entirely from someone whose roster row is their only way in, so that
        // case keeps the row and just drops the elevated role.
        const derived = await resolveDerivedGrant(spaceId, memberId)
        if (derived) {
          await db
            .from('community_space_members')
            .delete()
            .eq('space_id', spaceId)
            .eq('member_id', memberId)
          return NextResponse.json({ ok: true, role, grantedBy: derived.reason })
        }
        const { error } = await db
          .from('community_space_members')
          .update({ role })
          .eq('space_id', spaceId)
          .eq('member_id', memberId)
        if (error) return NextResponse.json({ error: 'Could not update role' }, { status: 500 })
        return NextResponse.json({ ok: true, role, grantedBy: 'roster' })
      }

      // Elevation to Moderator / Stellr Admin always needs a row to carry it.
      const { error } = await db.from('community_space_members').upsert(
        { space_id: spaceId, member_id: memberId, role, status: 'active' },
        { onConflict: 'space_id,member_id' }
      )
      if (error) return NextResponse.json({ error: 'Could not update role' }, { status: 500 })
      return NextResponse.json({ ok: true, role })
    }
    case 'remove-member': {
      if (!b.memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })
      await db.from('community_space_members').delete().eq('space_id', spaceId).eq('member_id', b.memberId)

      // Deleting the roster row only undoes a ROSTER grant. If the member is
      // still in the derived audience — because a tier, a web-app role, an open
      // space or a linked Object lets them in — say so plainly instead of
      // reporting a removal that did nothing. (An Object grant would also be
      // re-written by the next reconcile pass.)
      const stillIn = (await resolveSpaceAudience(spaceId)).find(
        (m) => m.memberId === b.memberId && !m.revoked
      )
      if (stillIn) {
        return NextResponse.json({
          ok: true,
          stillHasAccess: true,
          grantedBy: stillIn.reason,
          note: 'Roster row removed, but this member still reaches the space another way — revoke to block them.',
        })
      }
      return NextResponse.json({ ok: true })
    }

    // ── Suspend (posting) / revoke (access) ─────────────────────────────────
    // Both are NEGATIVE grants in community_space_suspensions (migration 142),
    // checked ahead of every positive grant. That is the only thing that can stop
    // a tier-, role- or open-granted member, none of whom have a roster row to
    // delete.
    case 'revoke-access':
    case 'restore-access':
    case 'suspend-posting':
    case 'resume-posting': {
      const scope = action.endsWith('-access') ? 'access' : 'posting'
      const lifting = action.startsWith('restore-') || action.startsWith('resume-')
      const memberId = b.memberId as string | undefined
      if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })

      if (lifting) {
        const { error } = await db
          .from('community_space_suspensions')
          .delete()
          .eq('space_id', spaceId)
          .eq('member_id', memberId)
          .eq('scope', scope)
        if (error) return NextResponse.json({ error: 'Could not lift the block' }, { status: 500 })
        // Clear the legacy roster mute too, or a resumed member stays silenced by
        // the column the write paths still read.
        if (scope === 'posting') {
          await db
            .from('community_space_members')
            .update({ muted: false })
            .eq('space_id', spaceId)
            .eq('member_id', memberId)
        }
      } else {
        const { error } = await db.from('community_space_suspensions').upsert(
          {
            space_id: spaceId,
            member_id: memberId,
            scope,
            reason: typeof b.reason === 'string' && b.reason.trim() ? b.reason.trim() : null,
            created_by: adminMemberId,
            expires_at: typeof b.expiresAt === 'string' && b.expiresAt ? b.expiresAt : null,
          },
          { onConflict: 'space_id,member_id,scope' }
        )
        if (error) return NextResponse.json({ error: 'Could not apply the block' }, { status: 500 })
      }

      const { data: sp } = await db.from('community_spaces').select('name').eq('id', spaceId).maybeSingle()
      const spaceName = (sp as { name: string } | null)?.name ?? 'a space'
      const verb =
        scope === 'access'
          ? lifting ? 'Restored access to' : 'Revoked access to'
          : lifting ? 'Lifted posting suspension in' : 'Suspended posting in'
      void logActivity({
        ...(await actorFromAuth()),
        memberId,
        category: 'community',
        action: `space_${scope}_${lifting ? 'restored' : 'blocked'}`,
        summary: `${verb} ${spaceName}`,
        metadata: { spaceId, scope, reason: b.reason ?? null, expiresAt: b.expiresAt ?? null },
      })

      return NextResponse.json({ ok: true })
    }

    // ── Training ────────────────────────────────────────────────────────────────
    case 'assign-training': {
      if (!b.moduleId) return NextResponse.json({ error: 'moduleId required' }, { status: 400 })
      const reqs = sanitizeBracketRequirements(b.bracketRequirements)
      const { data: last } = await db
        .from('community_space_training')
        .select('display_order')
        .eq('space_id', spaceId)
        .order('display_order', { ascending: false })
        .limit(1)
        .maybeSingle()
      const order = ((last as { display_order: number } | null)?.display_order ?? -1) + 1
      await db.from('community_space_training').upsert(
        {
          space_id: spaceId,
          training_module_id: b.moduleId,
          // Legacy rollup kept in sync for callers that still read is_mandatory.
          is_mandatory: anyBracketMandatory(reqs),
          bracket_requirements: reqs,
          display_order: order,
        },
        { onConflict: 'space_id,training_module_id' }
      )
      return NextResponse.json({ ok: true })
    }
    case 'set-training-requirements': {
      if (!b.moduleId) return NextResponse.json({ error: 'moduleId required' }, { status: 400 })
      const reqs = sanitizeBracketRequirements(b.bracketRequirements)
      await db
        .from('community_space_training')
        .update({ bracket_requirements: reqs, is_mandatory: anyBracketMandatory(reqs) })
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
      const { data: created } = await db
        .from('community_announcements')
        .insert({
          space_id: spaceId,
          author_member_id: adminMemberId,
          title,
          body: String(b.body ?? '').trim() || null,
        })
        .select('id')
        .single()

      // Notify everyone with access to this space (in-app only). Best-effort —
      // never fail the publish if the fan-out hits a snag.
      try {
        const audience = (await spaceNotificationAudience(spaceId)).filter((id) => id !== adminMemberId)
        if (audience.length) {
          await db.from('community_notifications').insert(
            audience.map((recipientId) => ({
              recipient_member_id: recipientId,
              actor_member_id: adminMemberId,
              type: 'announcement' as const,
              reference_type: 'space',
              reference_id: spaceId,
              body: title,
            }))
          )
        }
      } catch (err) {
        console.error('[community] announcement notification fan-out failed:', err)
      }
      return NextResponse.json({ ok: true, id: created?.id ?? null })
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
    // Attach an existing catalogue binary to this space (by reference — the binary
    // is shared, not copied). Optional displayName renames it for this space only.
    case 'attach-resource': {
      if (!b.resourceId) return NextResponse.json({ error: 'resourceId required' }, { status: 400 })
      await attachSpaceResource(db, spaceId, String(b.resourceId), b.displayName ? String(b.displayName) : null)
      return NextResponse.json({ ok: true })
    }
    // Detach a catalogue attachment (removes the container_contents link only,
    // leaving the shared binary intact for other spaces/objects).
    case 'detach-resource': {
      if (!b.attachmentId) return NextResponse.json({ error: 'attachmentId required' }, { status: 400 })
      const { data: sp } = await db.from('community_spaces').select('slug, name').eq('id', spaceId).maybeSingle()
      if (!sp) return NextResponse.json({ error: 'Space not found' }, { status: 404 })
      const containerId = await ensureSpaceContainer(db, (sp as { slug: string }).slug, (sp as { name: string }).name)
      // Scope the delete to this space's container so a forged id can't detach elsewhere.
      await db
        .from('container_contents')
        .delete()
        .eq('id', String(b.attachmentId))
        .eq('container_id', containerId)
        .eq('content_type', 'resource')
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

      // Writes a 'posting' suspension rather than the roster mute flag. The flag
      // needed a roster row to live on, so muting a tier- or role-granted member
      // meant inventing one for them; the suspension needs nothing.
      const { error: muteErr } = await db.from('community_space_suspensions').upsert(
        {
          space_id: spaceId,
          member_id: memberId,
          scope: 'posting',
          reason: b.flagId ? 'Muted from the moderation queue' : null,
          created_by: adminMemberId,
        },
        { onConflict: 'space_id,member_id,scope' }
      )
      if (muteErr) return NextResponse.json({ error: 'Could not mute member' }, { status: 500 })

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
      await db
        .from('community_space_suspensions')
        .delete()
        .eq('space_id', spaceId)
        .eq('member_id', b.memberId)
        .eq('scope', 'posting')
      // Legacy flag cleared too — the write paths still read it for one release.
      await db.from('community_space_members').update({ muted: false }).eq('space_id', spaceId).eq('member_id', b.memberId)
      return NextResponse.json({ ok: true })
    }

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}
