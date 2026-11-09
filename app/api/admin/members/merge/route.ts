import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { currentUserIsAdmin } from '@/lib/admin-auth'
import { actorFromAuth } from '@/lib/activity-log'
import { deleteUnsharedClerkLogin } from '@/lib/deletion/external'
import { withAudit } from '@/lib/audit/route'
import {
  MERGE_COLUMNS,
  defaultSurvivor,
  fieldsToWrite,
  isBlank,
  proposeMerge,
  validateMergeChoice,
  type MergeMember,
} from '@/lib/member-merge'

// Admin "Merge members" (4 Nov 2026). Admins only: a merge permanently deletes
// one record and cannot be undone.
//
//   GET  ?a=<id>&b=<id>[&keep=<id>]  both records, the default choice for every
//                                     field, and what is linked to each
//   POST { keepId, dropId, fields }   commit the reviewed values in one
//                                     transaction (public.merge_members), then
//                                     remove the dropped record's login

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SELECT = ['id', 'membership_id', 'created_at', 'updated_at', 'is_active', 'deleted_at', ...MERGE_COLUMNS].join(', ')

// What the review shows as "linked to this record". Every reference moves to
// the kept member whether listed here or not; these are the ones an admin
// recognises.
const LINKS: { table: string; column: string; label: string }[] = [
  { table: 'participants', column: 'member_id', label: 'Event registrations' },
  { table: 'registrations', column: 'teacher_member_id', label: 'Groups organised' },
  { table: 'agreements', column: 'member_id', label: 'Consent forms' },
  { table: 'event_participations', column: 'member_id', label: 'Event activity' },
  { table: 'credentials', column: 'member_id', label: 'Credentials' },
  { table: 'member_memberships', column: 'member_id', label: 'Memberships' },
  { table: 'member_schools', column: 'member_id', label: 'Schools' },
  { table: 'account_credits', column: 'member_id', label: 'Account credits' },
  { table: 'event_refunds', column: 'member_id', label: 'Cancellations and refunds' },
  { table: 'member_activity_log', column: 'member_id', label: 'History entries' },
]

async function loadPair(ids: string[]) {
  const db = supabaseServer()
  const { data, error } = await db.from('members').select(SELECT).in('id', ids)
  if (error) throw error
  return (data ?? []) as unknown as MergeMember[]
}

async function linkCounts(memberId: string) {
  const db = supabaseServer()
  const rows = await Promise.all(LINKS.map(async (l) => {
    const { count } = await db.from(l.table).select('*', { count: 'exact', head: true }).eq(l.column, memberId)
    return { label: l.label, count: count ?? 0 }
  }))
  return rows.filter((r) => r.count > 0)
}

export async function GET(req: NextRequest) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sp = new URL(req.url).searchParams
  const a = sp.get('a') ?? ''
  const b = sp.get('b') ?? ''
  const keepParam = sp.get('keep')
  if (!UUID.test(a) || !UUID.test(b) || a === b) {
    return NextResponse.json({ error: 'Choose two different members.' }, { status: 400 })
  }

  try {
    const pair = await loadPair([a, b])
    if (pair.length !== 2) return NextResponse.json({ error: 'One of these members no longer exists.' }, { status: 404 })
    const [ma, mb] = [pair.find((m) => m.id === a)!, pair.find((m) => m.id === b)!]
    const { keep, drop } = keepParam === a ? { keep: ma, drop: mb }
      : keepParam === b ? { keep: mb, drop: ma }
      : defaultSurvivor(ma, mb)

    const [keepLinks, dropLinks] = await Promise.all([linkCounts(keep.id), linkCounts(drop.id)])
    return NextResponse.json({
      keep, drop,
      proposal: proposeMerge(keep, drop),
      links: { keep: keepLinks, drop: dropLinks },
    })
  } catch (err) {
    console.error('[admin/members/merge] preview error:', err)
    return NextResponse.json({ error: 'Could not load these members.' }, { status: 500 })
  }
}

// What this request acted on, which withAudit's spec cannot read for itself: the body has gone.
const audited = new WeakMap<NextRequest, { keepId: string; dropId: string; userId: string | null }>()

export const POST = withAudit(
  ({ args: [req] }: { args: [NextRequest] }) => {
    const a = audited.get(req)
    return {
      action: 'member.record.merge',
      actor: a ? { userId: a.userId } : { session: true },
      tenant: { stellr: true },
      target: { table: 'members', id: a?.keepId ?? null },
      metadata: { dropId: a?.dropId ?? null },
    }
  },
  mergeMembers,
)

async function mergeMembers(req: NextRequest) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null) as
    { keepId?: string; dropId?: string; fields?: Record<string, unknown> } | null
  const keepId = body?.keepId ?? ''
  const dropId = body?.dropId ?? ''
  if (!UUID.test(keepId) || !UUID.test(dropId) || keepId === dropId) {
    return NextResponse.json({ error: 'Choose two different members.' }, { status: 400 })
  }
  audited.set(req, { keepId, dropId, userId: (await auth()).userId })

  const db = supabaseServer()
  try {
    const pair = await loadPair([keepId, dropId])
    const keep = pair.find((m) => m.id === keepId)
    const drop = pair.find((m) => m.id === dropId)
    if (!keep || !drop) return NextResponse.json({ error: 'One of these members no longer exists.' }, { status: 404 })

    const chosen: Record<string, unknown> = { ...(body?.fields ?? {}) }
    // The login is never the client's choice: the survivor keeps its own, and
    // inherits the other's only when it has none.
    delete chosen.clerk_user_id
    if (isBlank(keep.clerk_user_id) && !isBlank(drop.clerk_user_id)) chosen.clerk_user_id = drop.clerk_user_id

    const check = validateMergeChoice(chosen, keep)
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })

    const toWrite = fieldsToWrite(keep, chosen)
    const fieldSources = Object.fromEntries(Object.keys(toWrite).map((c) => [c, 'changed']))
    const actor = await actorFromAuth()

    const { data, error } = await db.rpc('merge_members', {
      p_keep: keep.id,
      p_drop: drop.id,
      p_fields: toWrite,
      p_actor: actor.actorMemberId ?? null,
      p_summary: { actorLabel: actor.actorLabel ?? null, fields: fieldSources },
    })
    if (error) {
      console.error('[admin/members/merge] merge_members error:', error)
      return NextResponse.json({ error: 'The merge did not complete. Nothing was changed.' }, { status: 500 })
    }

    const result = data as { droppedClerkUserId?: string | null } | null
    // The dropped record's login, unless the survivor took it over.
    const droppedLogin = result?.droppedClerkUserId ?? null
    const login = droppedLogin && droppedLogin !== chosen.clerk_user_id
      ? await deleteUnsharedClerkLogin(droppedLogin)
      : { kind: 'clerk' as const, ok: true, detail: droppedLogin ? 'Login moved to the kept record' : 'No login on the removed record' }

    return NextResponse.json({ ok: true, keptMemberId: keep.id, result: data, login })
  } catch (err) {
    console.error('[admin/members/merge] error:', err)
    return NextResponse.json({ error: 'The merge did not complete.' }, { status: 500 })
  }
}
