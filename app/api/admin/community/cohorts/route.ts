import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

// Admin: mentoring cohorts (FR-COM-11) — create a cohort, assign a mentor, and
// manage its members.

async function requireAdmin() {
  const { sessionClaims } = await auth()
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'
}

// Resolve an email to a member id (admin convenience for assigning people).
async function memberIdByEmail(email: string): Promise<string | null> {
  const db = supabaseServer()
  const { data } = await db.from('members').select('id').eq('email', email).maybeSingle()
  return data?.id ?? null
}

// POST — create a cohort. Body: { name, mentorEmail? }
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { name, mentorEmail } = await req.json().catch(() => ({}))
  if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const mentorId = mentorEmail ? await memberIdByEmail(mentorEmail) : null
  if (mentorEmail && !mentorId) return NextResponse.json({ error: 'Mentor email not found' }, { status: 404 })

  const db = supabaseServer()
  const { data, error } = await db
    .from('mentoring_cohorts')
    .insert({ name: name.trim(), mentor_member_id: mentorId })
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
  if (b.addMemberEmail) {
    const id = await memberIdByEmail(b.addMemberEmail)
    if (!id) return NextResponse.json({ error: 'Member email not found' }, { status: 404 })
    await db
      .from('cohort_members')
      .upsert({ cohort_id: b.cohortId, member_id: id }, { onConflict: 'cohort_id,member_id' })
  }
  if (b.removeMemberId) {
    await db.from('cohort_members').delete().eq('cohort_id', b.cohortId).eq('member_id', b.removeMemberId)
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
