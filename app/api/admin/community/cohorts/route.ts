import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { inviteMembersToCohort, resendCohortInvites, scheduleMentoring } from '@/lib/sessions'

// Admin: mentoring cohorts (FR-COM-11) — create a cohort, assign a mentor, and
// manage its members.

async function requireAdmin() {
  const { sessionClaims } = await auth()
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'
}

// Resolve an email to a member id (admin convenience for assigning people).
async function memberIdByEmail(email: string): Promise<string | null> {
  const db = supabaseServer()
  // Case-insensitive: emails are stored normalised, but admins may type any case.
  const { data } = await db.from('members').select('id').ilike('email', email.trim()).maybeSingle()
  return data?.id ?? null
}

// POST — create a cohort. Body: { name, mentorId | mentorEmail }
// Mentor is required. Cohort names must be unique (case-insensitive).
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { name, mentorId, mentorEmail } = await req.json().catch(() => ({}))
  if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  // Mentor is required — a cohort without a mentor cannot run sessions.
  let resolvedMentorId: string | null = mentorId ?? null
  if (!resolvedMentorId && mentorEmail) {
    resolvedMentorId = await memberIdByEmail(mentorEmail)
    if (!resolvedMentorId) return NextResponse.json({ error: 'Mentor not found' }, { status: 404 })
  }
  if (!resolvedMentorId) {
    return NextResponse.json({ error: 'A mentor must be assigned when creating a cohort' }, { status: 400 })
  }

  const db = supabaseServer()

  // Enforce unique cohort names (case-insensitive).
  const { data: existing } = await db
    .from('mentoring_cohorts')
    .select('id')
    .ilike('name', name.trim())
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ error: 'A cohort with that name already exists' }, { status: 409 })
  }

  const { data, error } = await db
    .from('mentoring_cohorts')
    .insert({ name: name.trim(), mentor_member_id: resolvedMentorId })
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: 'Could not create cohort' }, { status: 500 })
  return NextResponse.json({ id: data.id })
}

// PATCH — update mentor or membership.
// Body: { cohortId, mentorEmail?, addMemberEmail?, removeMemberId? }
export async function PATCH(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.cohortId) return NextResponse.json({ error: 'cohortId required' }, { status: 400 })
  const db = supabaseServer()

  if ('mentorEmail' in b) {
    const mentorId = b.mentorEmail ? await memberIdByEmail(b.mentorEmail) : null
    if (b.mentorEmail && !mentorId) return NextResponse.json({ error: 'Mentor email not found' }, { status: 404 })
    await db.from('mentoring_cohorts').update({ mentor_member_id: mentorId }).eq('id', b.cohortId)
  }
  // Add a member by id (from the member-search picker) or by email (fallback).
  if (b.addMemberId || b.addMemberEmail) {
    const id = b.addMemberId ?? (await memberIdByEmail(b.addMemberEmail))
    if (!id) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    await inviteMembersToCohort(b.cohortId, [id])
  }
  if (b.removeMemberId) {
    await db.from('cohort_members').delete().eq('cohort_id', b.cohortId).eq('member_id', b.removeMemberId)
  }
  // Bulk add members by email (de-blocker for populating a cohort quickly).
  if (Array.isArray(b.addMemberEmails) && b.addMemberEmails.length) {
    const ids: string[] = []
    for (const email of b.addMemberEmails) {
      if (typeof email !== 'string' || !email.trim()) continue
      const id = await memberIdByEmail(email)
      if (id && !ids.includes(id)) ids.push(id)
    }
    const invited = ids.length ? await inviteMembersToCohort(b.cohortId, ids) : 0
    return NextResponse.json({ ok: true, invited, resolved: ids.length, requested: b.addMemberEmails.length })
  }
  // Resend pending invites for a cohort (PRD §11 — admin "resend invites").
  if (b.resendInvites) {
    const resent = await resendCohortInvites(b.cohortId)
    return NextResponse.json({ ok: true, resent })
  }
  // Link / unlink referenced training material for the cohort (PRD §11).
  if (b.linkModuleId) {
    await db.from('cohort_training_links').upsert(
      {
        cohort_id: b.cohortId,
        module_id: b.linkModuleId,
        is_mandatory: !!b.linkMandatory,
        due_at: b.linkDueAt || null,
      },
      { onConflict: 'cohort_id,module_id' },
    )
  }
  if (b.unlinkModuleId) {
    await db
      .from('cohort_training_links')
      .delete()
      .eq('cohort_id', b.cohortId)
      .eq('module_id', b.unlinkModuleId)
  }
  // Admin direct session create — admin picks host + cohort + time.
  if (b.action === 'scheduleSession') {
    if (!b.hostEmail || !b.start) {
      return NextResponse.json({ error: 'hostEmail and start required' }, { status: 400 })
    }
    const hostId = await memberIdByEmail(b.hostEmail)
    if (!hostId) return NextResponse.json({ error: 'Host not found' }, { status: 404 })
    const r = await scheduleMentoring(hostId, b.cohortId, b.start)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
    return NextResponse.json({ ok: true, sessionId: r.sessionId })
  }
  // Archive / re-activate the container (Phase 5 lifecycle). When archiving, record
  // the persistence policy for its content: keepOpen → past members keep access;
  // otherwise re-gate (the default). content_persistence is read by
  // lib/containers.ts containerAccessPersists() at content-access time.
  if ('archive' in b) {
    const archived = !!b.archive
    await db
      .from('mentoring_cohorts')
      .update({ lifecycle: archived ? 'archived' : 'active', archived_at: archived ? new Date().toISOString() : null })
      .eq('id', b.cohortId)
    if (archived) {
      await db.from('content_persistence').upsert(
        { target_type: 'container', target_ref: b.cohortId, policy: b.keepOpen ? 'keep_open' : 're_gate' },
        { onConflict: 'target_type,target_ref' },
      )
    }
  }
  return NextResponse.json({ ok: true })
}

// DELETE — permanently remove a cohort. Query: ?cohortId=
// Blocked if the cohort has active members or pending sessions.
export async function DELETE(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const cohortId = new URL(req.url).searchParams.get('cohortId')
  if (!cohortId) return NextResponse.json({ error: 'cohortId required' }, { status: 400 })

  const db = supabaseServer()

  // Block if active members are still enrolled.
  const { count: memberCount } = await db
    .from('cohort_members')
    .select('member_id', { count: 'exact', head: true })
    .eq('cohort_id', cohortId)
    .eq('status', 'active')
  if ((memberCount ?? 0) > 0) {
    return NextResponse.json(
      { error: `Remove all ${memberCount} active member(s) before deleting this cohort` },
      { status: 409 },
    )
  }

  // Block if there are upcoming sessions.
  const { count: sessionCount } = await db
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('cohort_id', cohortId)
    .eq('status', 'scheduled')
  if ((sessionCount ?? 0) > 0) {
    return NextResponse.json(
      { error: `Cancel all ${sessionCount} scheduled session(s) before deleting this cohort` },
      { status: 409 },
    )
  }

  const { error } = await db.from('mentoring_cohorts').delete().eq('id', cohortId)
  if (error) return NextResponse.json({ error: 'Could not delete cohort' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
