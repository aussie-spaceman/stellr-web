import { auth } from '@clerk/nextjs/server'
import { hasCapability } from '@/lib/authz'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { isAdminClaims } from '@/lib/admin-auth'
import { startRetentionClock } from '@/lib/esign/retention'
import { resolveEmailPair } from '@/lib/member-email'
import { shadowSyncFields } from '@/lib/field-crypto-shadow'

function humanizeFields(keys: string[]): string {
  return keys.map((k) => k.replace(/^ec_/, 'emergency ').replace(/_/g, ' ')).join(', ')
}

// Treat null/undefined/'' as equivalent so an untouched empty field (the form
// submits null DB values as '') is not flagged as a change.
function norm(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim()
}

// Labels for the columns an admin edits, as the profile form names them.
const FIELD_LABEL: Record<string, string> = {
  first_name: 'First name', last_name: 'Last name', nickname: 'Nickname', phone: 'Phone',
  email: 'Email', school_email: 'School email', discord_handle: 'Discord handle',
  date_of_birth: 'Date of birth', gender: 'Gender', age_bracket: 'Age bracket', event_role: 'Role',
  grade: 'Grade', grade_auto_promote: 'Grade auto-promote', tshirt_size: 'T-shirt size',
  ec_first_name: 'Emergency contact first name', ec_last_name: 'Emergency contact last name',
  ec_email: 'Emergency contact email', ec_phone: 'Emergency contact phone',
  ec_relationship: 'Emergency contact relationship', health_conditions: 'Health conditions',
  is_active: 'Active',
}
// Enum types on members, so an invalid-value error can name its field.
const ENUM_FIELD: Record<string, string> = {
  grade_type: 'grade', tshirt_size_type: 'tshirt_size', gender_type: 'gender',
  age_bracket_type: 'age_bracket', event_role_type: 'event_role',
}

type DbError = { code?: string; message?: string; details?: string | null }

/**
 * Why a member save failed, in words an admin can act on (TRACKER 20.5).
 * Reads the Postgres error code and names the field where it can; the raw
 * error is logged by the caller and never returned. Only fields this request
 * tried to change are named.
 */
function describeMemberUpdateError(error: DbError, sent: string[]): { status: number; error: string } {
  const text = `${error.message ?? ''} ${error.details ?? ''}`
  const label = (col: string | undefined) => (col && sent.includes(col) ? FIELD_LABEL[col] : undefined)
  switch (error.code) {
    case '23505': { // unique_violation: members_email_key, members_email_lower_idx, members_clerk_user_id_key
      if (/email/i.test(text)) {
        return { status: 409, error: 'Another member already uses that email address. Use a different one, or merge the two records.' }
      }
      return { status: 409, error: 'Another member already has that value. Nothing was saved.' }
    }
    case '23502': { // not_null_violation: null value in column "x" of relation "members"
      const field = label(/column "([^"]+)"/.exec(text)?.[1])
      return { status: 400, error: field ? `${field} is required.` : 'A required field is empty. Nothing was saved.' }
    }
    case '22P02': { // invalid_text_representation: invalid input value for enum grade_type: "x"
      const enumType = /enum (?:public\.)?(\w+)/.exec(text)?.[1]
      const field = label(enumType ? ENUM_FIELD[enumType] : undefined)
      return { status: 400, error: field ? `That ${field.toLowerCase()} is not one of the options.` : 'One of the values is not in the expected format. Nothing was saved.' }
    }
    case '22007': // invalid_datetime_format
    case '22008': // datetime_field_overflow
      return { status: 400, error: label('date_of_birth') ? 'Date of birth is not a valid date.' : 'A date is not valid. Nothing was saved.' }
    case '22001': // string_data_right_truncation
      return { status: 400, error: 'One of the values is too long. Nothing was saved.' }
    case '23514': // check_violation: new row for relation "members" violates check constraint "x"
      return { status: 400, error: 'One of the values is outside what a member record allows. Nothing was saved.' }
    case 'PGRST116': // .single() found no row
      return { status: 404, error: 'This member no longer exists.' }
    default:
      return { status: 500, error: 'The save did not go through. Nothing was changed; try again.' }
  }
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = new Set(a)
  return b.every((x) => sa.has(x))
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { sessionClaims } = await auth()
  if (!(await hasCapability('members:write'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const db = supabaseServer()

  const allowed = [
    'first_name', 'last_name', 'nickname', 'phone', 'email', 'school_email', 'discord_handle',
    'date_of_birth', 'gender', 'age_bracket', 'event_role',
    'grade', 'grade_auto_promote', 'tshirt_size',
    'ec_first_name', 'ec_last_name', 'ec_email', 'ec_phone', 'ec_relationship',
    'health_conditions', 'is_active',
  ]
  const updates: Record<string, unknown> = {}
  // The form submits cleared/unset fields as ''. Enum and date columns (grade,
  // tshirt_size, gender, date_of_birth) reject '', so an Adult with no grade
  // could never be saved — store empties as NULL instead.
  for (const key of allowed) {
    if (key in body) updates[key] = body[key] === '' ? null : body[key]
  }
  // Personal takes primacy (lib/member-email): with no personal address the
  // school one becomes the primary, and email (NOT NULL) is never blanked.
  if ('email' in body || 'school_email' in body) {
    const pair = resolveEmailPair({ email: body.email, school_email: body.school_email })
    if ('email' in body) {
      if (!pair.email) return NextResponse.json({ error: 'An email address is required.' }, { status: 400 })
      updates.email = pair.email
    }
    if ('school_email' in body) updates.school_email = pair.school_email
  }

  // Snapshot the editable fields + current ethnicity/allergy selections before
  // the write so we can record exactly what changed.
  const [{ data: before }, { data: beforeEth }, { data: beforeAllergy }] = await Promise.all([
    db.from('members').select(allowed.join(',')).eq('id', id).maybeSingle(),
    db.from('member_ethnicities').select('ethnicity_option_id').eq('member_id', id),
    db.from('member_allergies').select('allergy_option_id').eq('member_id', id),
  ])

  const { data, error } = await db
    .from('members')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    // The raw error stays in the server log; the admin gets a reason to act on.
    console.error('Admin member update error:', error)
    const reason = describeMemberUpdateError(error, Object.keys(updates))
    return NextResponse.json({ error: reason.error }, { status: reason.status })
  }
  // S4 field encryption: inert unless FIELD_CRYPTO_MODE=shadow; never fails this write.
  shadowSyncFields('members', [id])

  // Replace ethnicity + allergy selections — independent tables, run concurrently
  const replacements: Promise<void>[] = []
  if ('ethnicity_ids' in body && Array.isArray(body.ethnicity_ids)) {
    replacements.push((async () => {
      await db.from('member_ethnicities').delete().eq('member_id', id)
      if (body.ethnicity_ids.length > 0) {
        const { error: insertError } = await db.from('member_ethnicities').insert(
          body.ethnicity_ids.map((eid: string) => ({ member_id: id, ethnicity_option_id: eid }))
        )
        if (insertError) console.error('Admin member ethnicity insert error:', insertError)
      }
    })())
  }
  if ('allergy_ids' in body && Array.isArray(body.allergy_ids)) {
    replacements.push((async () => {
      await db.from('member_allergies').delete().eq('member_id', id)
      if (body.allergy_ids.length > 0) {
        const { error: insertError } = await db.from('member_allergies').insert(
          body.allergy_ids.map((aid: string) => ({ member_id: id, allergy_option_id: aid }))
        )
        if (insertError) console.error('Admin member allergy insert error:', insertError)
      }
    })())
  }
  await Promise.all(replacements)

  // Audit trail — record which fields the admin actually changed.
  const beforeRow = (before ?? {}) as Record<string, unknown>
  const changed = Object.keys(updates).filter((k) => norm(beforeRow[k]) !== norm(updates[k]))
  const beforeEthIds = (beforeEth ?? []).map((r: { ethnicity_option_id: string }) => r.ethnicity_option_id)
  const beforeAllergyIds = (beforeAllergy ?? []).map((r: { allergy_option_id: string }) => r.allergy_option_id)
  if ('ethnicity_ids' in body && Array.isArray(body.ethnicity_ids) && !sameSet(beforeEthIds, body.ethnicity_ids)) {
    changed.push('ethnicity')
  }
  if ('allergy_ids' in body && Array.isArray(body.allergy_ids) && !sameSet(beforeAllergyIds, body.allergy_ids)) {
    changed.push('dietary')
  }
  if (changed.length > 0) {
    const actor = await actorFromAuth()
    await logActivity({
      memberId: id,
      category: 'profile',
      action: 'profile_updated',
      summary: `Updated profile (${humanizeFields(changed)})`,
      metadata: { fields: changed },
      ...actor,
    })
  }

  return NextResponse.json({ member: data })
}

// Soft-delete
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const db = supabaseServer()

  const { error } = await db
    .from('members')
    .update({ is_active: false, deleted_at: new Date().toISOString(), clerk_user_id: null })
    .eq('id', id)

  if (error) return NextResponse.json({ error: 'Delete failed' }, { status: 500 })

  // Signed agreements are kept 7 years from deactivation (V2.3). A failure
  // here leaves them with no end date, the safe side, so it is logged only.
  await startRetentionClock(db, id).catch((err) => console.error('[members] retention clock failed:', err))

  const actor = await actorFromAuth()
  await logActivity({
    memberId: id,
    category: 'account',
    action: 'account_deactivated',
    summary: 'Account deactivated',
    ...actor,
  })

  return NextResponse.json({ success: true })
}
