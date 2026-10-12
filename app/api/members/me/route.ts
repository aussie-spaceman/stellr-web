import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { logActivity } from '@/lib/activity-log'
import { assertNotImpersonating, impersonatedMemberId } from '@/lib/impersonation'

// Treat null/undefined/'' as equivalent so an untouched empty field (the form
// submits null DB values as '') is not flagged as a change.
function norm(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim()
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = new Set(a)
  return b.every((x) => sa.has(x))
}

// Enum-typed columns: the DB rejects '' (an empty select submits '' for an
// untouched field). Normalise '' / whitespace → null so a blank doesn't fail the
// whole save (see admin-member-save-fix; /api/members/me had the same latent
// pass-through, MEM-16).
const ENUM_FIELDS = new Set(['gender', 'grade'])

type Db = ReturnType<typeof supabaseServer>

// deep review MEM-16: validate every supplied option id against its lookup table
// BEFORE anything is deleted. The replace was delete-then-insert with the insert
// error only logged, so one bad id silently wiped a member's recorded allergies
// (event medical data) while the UI still reported success. Fail CLOSED: a lookup
// error or any unknown id means "reject", so the stored set is never touched.
async function optionIdsValid(db: Db, optionTable: string, ids: string[]): Promise<boolean> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return true
  const { data, error } = await db.from(optionTable).select('id').in('id', unique)
  if (error || !data) return false
  const known = new Set((data as { id: string }[]).map((r) => r.id))
  return unique.every((id) => known.has(id))
}

// Replace a member's option set atomically-enough: delete the old rows, insert
// the new (pre-validated) ones, and if the insert fails restore the previous set
// so a transient error can't leave the member with an empty medical record.
// Returns false on any failure so the caller can surface it (MEM-16).
async function replaceOptionSet(
  db: Db,
  opts: { table: string; column: string; memberId: string; newIds: string[]; previousIds: string[] },
): Promise<boolean> {
  const ids = [...new Set(opts.newIds.filter((v): v is string => typeof v === 'string' && !!v))]
  const { error: delErr } = await db.from(opts.table).delete().eq('member_id', opts.memberId)
  if (delErr) {
    console.error(`Error clearing ${opts.table}:`, delErr)
    return false
  }
  if (ids.length === 0) return true
  const { error: insErr } = await db
    .from(opts.table)
    .insert(ids.map((id) => ({ member_id: opts.memberId, [opts.column]: id })))
  if (insErr) {
    console.error(`Error saving ${opts.table}:`, insErr)
    if (opts.previousIds.length > 0) {
      await db
        .from(opts.table)
        .insert(opts.previousIds.map((id) => ({ member_id: opts.memberId, [opts.column]: id })))
    }
    return false
  }
  return true
}

// GET /api/members/me — fetch the current member's full record
export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = supabaseServer()

  // Honours an admin view-as session (read only — PATCH is blocked outright).
  const viewAsId = await impersonatedMemberId()
  const query = db
    .from('members')
    .select(`
      *,
      member_schools(*, schools(*)),
      member_memberships(*, membership_tiers(*)),
      member_ethnicities(*, ethnicity_options(*)),
      member_allergies(*, allergy_options(*)),
      event_participations(*)
    `)
  const { data: member, error } = viewAsId
    ? await query.eq('id', viewAsId).maybeSingle()
    : await query.eq('clerk_user_id', userId).eq('is_active', true).maybeSingle()

  if (error) {
    console.error('Error fetching member:', error)
    return NextResponse.json({ error: 'Failed to fetch member' }, { status: 500 })
  }

  return NextResponse.json({ member })
}

// PATCH /api/members/me — update the current member's profile
export async function PATCH(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — see lib/impersonation.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json()
  const db = supabaseServer()

  // Only allow safe fields to be updated by the member themselves
  const allowed = [
    'nickname', 'phone', 'discord_handle', 'gender',
    'grade', 'tshirt_size', 'profile_photo_url',
    'ec_first_name', 'ec_last_name', 'ec_email', 'ec_phone', 'ec_relationship',
    'health_conditions',
  ]

  const { data: member } = await db
    .from('members')
    .select(['id', 'first_name', 'last_name', ...allowed].join(','))
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .single()

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  const memberRow = member as unknown as Record<string, unknown>
  const memberId = memberRow.id as string

  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (!(key in body)) continue
    let value = body[key]
    // MEM-16: a blank enum must become null, not '' (which the DB enum rejects).
    if (ENUM_FIELDS.has(key) && typeof value === 'string' && value.trim() === '') value = null
    updates[key] = value
  }

  const changedFields = Object.keys(updates).filter((k) => norm(memberRow[k]) !== norm(updates[k]))

  // Snapshot current ethnicity/allergy selections before the replacement runs.
  const [{ data: beforeEth }, { data: beforeAllergy }] = await Promise.all([
    db.from('member_ethnicities').select('ethnicity_option_id').eq('member_id', memberId),
    db.from('member_allergies').select('allergy_option_id').eq('member_id', memberId),
  ])
  const beforeEthIds = (beforeEth ?? []).map((r: { ethnicity_option_id: string }) => r.ethnicity_option_id)
  const beforeAllergyIds = (beforeAllergy ?? []).map((r: { allergy_option_id: string }) => r.allergy_option_id)

  // MEM-16: validate the incoming option ids up front, before any write. An
  // unknown id (or a failed validation lookup) rejects the whole request and
  // leaves the stored sets untouched, rather than deleting them and failing the
  // re-insert.
  const wantEthnicity = 'ethnicity_ids' in body && Array.isArray(body.ethnicity_ids)
  const wantAllergy = 'allergy_ids' in body && Array.isArray(body.allergy_ids)
  const nextEthIds: string[] = wantEthnicity ? (body.ethnicity_ids as unknown[]).filter((v): v is string => typeof v === 'string' && !!v) : []
  const nextAllergyIds: string[] = wantAllergy ? (body.allergy_ids as unknown[]).filter((v): v is string => typeof v === 'string' && !!v) : []
  if (
    (wantEthnicity && !(await optionIdsValid(db, 'ethnicity_options', nextEthIds))) ||
    (wantAllergy && !(await optionIdsValid(db, 'allergy_options', nextAllergyIds)))
  ) {
    return NextResponse.json({ error: 'Invalid selection' }, { status: 400 })
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await db
      .from('members')
      .update(updates)
      .eq('id', memberId)

    if (error) {
      console.error('Error updating member:', error)
      return NextResponse.json({ error: 'Failed to update member' }, { status: 500 })
    }
  }

  // Replace ethnicity + allergy selections with the pre-validated ids. Independent
  // tables, run concurrently; each replace restores its previous set on a transient
  // insert failure (MEM-16). Surface any failure as a non-2xx so the UI doesn't
  // report a save that silently lost medical data.
  const replaceResults = await Promise.all([
    wantEthnicity
      ? replaceOptionSet(db, { table: 'member_ethnicities', column: 'ethnicity_option_id', memberId, newIds: nextEthIds, previousIds: beforeEthIds })
      : Promise.resolve(true),
    wantAllergy
      ? replaceOptionSet(db, { table: 'member_allergies', column: 'allergy_option_id', memberId, newIds: nextAllergyIds, previousIds: beforeAllergyIds })
      : Promise.resolve(true),
  ])
  if (replaceResults.some((ok) => !ok)) {
    return NextResponse.json({ error: 'Failed to save some selections' }, { status: 500 })
  }

  // Audit trail — the member edited their own profile.
  const changed = [...changedFields]
  if (wantEthnicity && !sameSet(beforeEthIds, nextEthIds)) {
    changed.push('ethnicity')
  }
  if (wantAllergy && !sameSet(beforeAllergyIds, nextAllergyIds)) {
    changed.push('dietary')
  }
  if (changed.length > 0) {
    const actorLabel = [memberRow.first_name, memberRow.last_name].filter(Boolean).join(' ').trim() || null
    await logActivity({
      memberId,
      category: 'profile',
      action: 'profile_updated',
      summary: `Updated profile (${changed.map((k) => k.replace(/^ec_/, 'emergency ').replace(/_/g, ' ')).join(', ')})`,
      metadata: { fields: changed },
      actorType: 'member',
      actorMemberId: memberId,
      actorLabel,
    })
  }

  return NextResponse.json({ success: true })
}
