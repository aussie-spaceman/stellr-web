import { auth, clerkClient } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { currentUserIsAdmin } from '@/lib/admin-auth'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { deleteUnsharedClerkLogin } from '@/lib/deletion/external'
import { isCrewTargetOrUnknown } from '@/lib/authz'
import { loadTargetClerkRole } from '@/lib/authz/principal'
import { withAudit } from '@/lib/audit/route'
import {
  MERGE_COLUMNS,
  addressesRemovedByMerge,
  defaultSurvivor,
  fieldsToWrite,
  isBlank,
  mergedAddresses,
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
//                                     remove the dropped record's login, then
//                                     bring the kept login's primary email in
//                                     line with the kept record's

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

    // Only when the merge changed the kept record's email or gave it a login:
    // otherwise the login and the record are as they were before, and Clerk is
    // not called. After the dropped login is gone, so an address it held is free
    // to move to the kept one.
    const keptLogin = (toWrite.clerk_user_id ?? keep.clerk_user_id ?? null) as string | null
    const loginEmail = 'email' in toWrite || 'clerk_user_id' in toWrite
      ? await syncLoginEmail({
        memberId: keep.id,
        clerkUserId: keptLogin,
        email: mergedAddresses(keep, toWrite).email,
        removable: addressesRemovedByMerge(keep, drop, toWrite),
      })
      : null
    if (loginEmail && (loginEmail.status === 'updated' || loginEmail.status === 'failed' || loginEmail.status === 'skipped_staff')) {
      await logActivity({
        memberId: keep.id,
        category: 'account',
        action: loginEmail.status === 'updated'
          ? 'login_email_updated'
          : loginEmail.status === 'skipped_staff' ? 'login_email_skipped_staff' : 'login_email_update_failed',
        summary: loginEmail.status === 'updated'
          ? 'Login email updated to match the merged record'
          : loginEmail.status === 'skipped_staff'
            ? 'Login email left as it was after the merge: the login belongs to staff'
            : 'Login email could not be updated after the merge',
        metadata: { step: loginEmail.step ?? null, removedOldAddress: loginEmail.removedOldAddress ?? false },
        ...actor,
      })
    }

    return NextResponse.json({ ok: true, keptMemberId: keep.id, result: data, login, ...(loginEmail ? { loginEmail } : {}) })
  } catch (err) {
    console.error('[admin/members/merge] error:', err)
    return NextResponse.json({ error: 'The merge did not complete.' }, { status: 500 })
  }
}

interface LoginEmailResult {
  ok: boolean
  status: 'no_login' | 'unchanged' | 'updated' | 'failed' | 'skipped_staff'
  detail: string
  /** The Clerk step that failed, when one did. */
  step?: string
  removedOldAddress?: boolean
}

function clerkErrorMessage(e: unknown): string {
  const first = (e as { errors?: { longMessage?: string; message?: string }[] } | null)?.errors?.[0]
  return first?.longMessage ?? first?.message ?? (e instanceof Error ? e.message : String(e))
}

const lower = (s: string) => s.trim().toLowerCase()

/**
 * Tracker member-merge-school-email.3. A merge can change the kept record's
 * email (often school → personal) while its Clerk login keeps the old address
 * as primary, so signing in with the new address could start a second account.
 * When the two differ: add the record's email to the login as verified (an
 * admin chose it in the merge review), make it primary, then take the old
 * primary off the login only if the merge removed that address from the member.
 * Matching addresses mean no Clerk write. A failure is logged and returned to
 * the admin; the merge itself has already committed and stands.
 *
 * Never on a staff login. Putting a verified, primary address on a login hands
 * whoever controls that address the account (email code, password reset), so
 * a merge must not be a way round the rule view-as and login deletion already
 * keep: a staff target is refused. The same check as deleteUnsharedClerkLogin
 * runs before any write, and "could not tell" is refused too. A staff login's
 * email is changed in Clerk, by hand.
 */
async function syncLoginEmail(args: {
  memberId: string
  clerkUserId: string | null
  email: string
  removable: string[]
}): Promise<LoginEmailResult> {
  const { memberId, clerkUserId, email, removable } = args
  if (!clerkUserId) return { ok: true, status: 'no_login', detail: 'The kept record has no login.' }
  if (!email) return { ok: true, status: 'unchanged', detail: 'The kept record has no email to give its login.' }

  let step = 'read the login'
  let primaryMoved = false
  try {
    const client = await clerkClient()
    const user = await client.users.getUser(clerkUserId)
    const primary = user.emailAddresses.find((a) => a.id === user.primaryEmailAddressId) ?? null
    if (primary && lower(primary.emailAddress) === email) {
      return { ok: true, status: 'unchanged', detail: "The login's email already matches the kept record." }
    }

    step = 'check the login is not a staff account'
    const { role } = await loadTargetClerkRole(client, clerkUserId)
    const crew = await isCrewTargetOrUnknown({ clerkUserId, clerkRole: role, memberId }, { route: 'admin/members/merge/login-email' })
    if (crew !== false) {
      // Member id and step only: no addresses in the log.
      console.error('[admin/members/merge] login email not changed:', { memberId, step, crew })
      return crew
        ? {
          ok: false,
          status: 'skipped_staff',
          step,
          removedOldAddress: false,
          detail: 'This login belongs to staff, so its email was not changed. Update it in Clerk.',
        }
        : {
          ok: false,
          status: 'failed',
          step,
          removedOldAddress: false,
          detail: "The merge is complete, but we could not confirm this login isn't a staff account, so its email was not changed. Update it in Clerk.",
        }
    }

    step = 'add the kept email to the login'
    let target = user.emailAddresses.find((a) => lower(a.emailAddress) === email) ?? null
    if (!target) {
      target = await client.emailAddresses.createEmailAddress({ userId: clerkUserId, emailAddress: email, verified: true })
    } else if (target.verification?.status !== 'verified') {
      target = await client.emailAddresses.updateEmailAddress(target.id, { verified: true })
    }

    step = "make the kept email the login's primary"
    await client.users.updateUser(clerkUserId, { primaryEmailAddressID: target.id })
    primaryMoved = true

    let removedOldAddress = false
    if (primary && removable.includes(lower(primary.emailAddress))) {
      step = 'remove the old address from the login'
      await client.emailAddresses.deleteEmailAddress(primary.id)
      removedOldAddress = true
    }
    return {
      ok: true,
      status: 'updated',
      detail: removedOldAddress
        ? "The login now signs in with the kept record's email; the old address was removed from it."
        : "The login now signs in with the kept record's email; its old address is still on it.",
      removedOldAddress,
    }
  } catch (e) {
    const reason = clerkErrorMessage(e)
    // Member id and step only: no addresses in the log.
    console.error('[admin/members/merge] login email update failed:', { memberId, step, reason })
    return {
      ok: false,
      status: 'failed',
      step,
      removedOldAddress: false,
      detail: primaryMoved
        ? `The login now signs in with the kept record's email, but could not ${step}: ${reason}`
        : `The merge is complete, but could not ${step}: ${reason}. The login still has its old email; update it in Clerk.`,
    }
  }
}
