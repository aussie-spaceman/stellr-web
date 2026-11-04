// Merging two member records into one (4 Nov 2026).
//
// Rules the owner set:
//   1. Additive: a field blank on one record takes the other's value.
//   2. Both filled and different: the record updated most recently wins.
//   3. An admin reviews every field before anything is written.
//   4. The merge is recorded in the remaining record's history.
//   5. The other record is permanently deleted (no snapshot).
// Defaults: the OLDER record survives (its Member ID, login, agreements and
// history), and the two emails are sorted into personal and school by domain.
// The write itself is one transaction: public.merge_members.
//
// Pure: no I/O, shared by the admin API and the review dialog.

import { isLikelySchoolEmail } from '@/lib/member-email'

export interface MergeMember {
  id: string
  membership_id: string | null
  clerk_user_id: string | null
  created_at: string
  updated_at: string
  [column: string]: unknown
}

export interface MergeFieldDef {
  column: string
  label: string
  /** Grouping in the review table. */
  group: 'Identity' | 'Contact' | 'Event' | 'Emergency contact' | 'Account'
  /** Shown but chosen by the system, not the admin. */
  locked?: boolean
}

/** Every column the review shows and a merge may set (mirrors v_allowed in
 *  public.merge_members). Order = display order. */
export const MERGE_FIELDS: MergeFieldDef[] = [
  { column: 'first_name', label: 'First name', group: 'Identity' },
  { column: 'last_name', label: 'Last name', group: 'Identity' },
  { column: 'nickname', label: 'Nickname', group: 'Identity' },
  { column: 'date_of_birth', label: 'Date of birth', group: 'Identity' },
  { column: 'gender', label: 'Gender', group: 'Identity' },
  { column: 'email', label: 'Personal email (primary)', group: 'Contact' },
  { column: 'school_email', label: 'School email', group: 'Contact' },
  { column: 'phone', label: 'Phone', group: 'Contact' },
  { column: 'discord_handle', label: 'Discord', group: 'Contact' },
  { column: 'event_role', label: 'Role', group: 'Event' },
  { column: 'age_bracket', label: 'Age bracket', group: 'Event' },
  { column: 'grade', label: 'Grade', group: 'Event' },
  { column: 'graduation_year', label: 'Graduation year', group: 'Event' },
  { column: 'tshirt_size', label: 'T-shirt size', group: 'Event' },
  { column: 'health_conditions', label: 'Health conditions', group: 'Event' },
  { column: 'ec_first_name', label: 'First name', group: 'Emergency contact' },
  { column: 'ec_last_name', label: 'Last name', group: 'Emergency contact' },
  { column: 'ec_email', label: 'Email', group: 'Emergency contact' },
  { column: 'ec_phone', label: 'Phone', group: 'Emergency contact' },
  { column: 'ec_relationship', label: 'Relationship', group: 'Emergency contact' },
  { column: 'profile_photo_url', label: 'Profile photo', group: 'Account' },
  { column: 'stripe_customer_id', label: 'Stripe customer', group: 'Account' },
  { column: 'clerk_user_id', label: 'Login', group: 'Account', locked: true },
]

export const MERGE_COLUMNS = MERGE_FIELDS.map((f) => f.column)

export type FieldSource = 'keep' | 'drop'

export interface FieldChoice {
  source: FieldSource
  value: unknown
  /** Why this default: shown in the review. */
  reason: 'same' | 'only_keep' | 'only_drop' | 'newer' | 'email_sort' | 'login'
}

export interface MergeProposal {
  keepId: string
  dropId: string
  fields: Record<string, FieldChoice>
}

export function isBlank(v: unknown): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '')
}

function same(a: unknown, b: unknown): boolean {
  if (isBlank(a) && isBlank(b)) return true
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
}

/** Default survivor: the older record (created first). */
export function defaultSurvivor(a: MergeMember, b: MergeMember): { keep: MergeMember; drop: MergeMember } {
  return Date.parse(a.created_at) <= Date.parse(b.created_at) ? { keep: a, drop: b } : { keep: b, drop: a }
}

/**
 * Sort the records' addresses into personal (primary) and school. Every
 * address on either record is a candidate: email and school_email of both.
 * A school-looking address goes to school; personal takes the first
 * non-school one, preferring the newer record's.
 */
export function proposeEmails(keep: MergeMember, drop: MergeMember): {
  email: FieldChoice
  school_email: FieldChoice
} {
  const newerIsDrop = Date.parse(drop.updated_at) > Date.parse(keep.updated_at)
  const ordered: { source: FieldSource; value: string }[] = []
  const push = (source: FieldSource, v: unknown) => {
    if (typeof v === 'string' && v.trim() && !ordered.some((o) => same(o.value, v))) {
      ordered.push({ source, value: v.trim().toLowerCase() })
    }
  }
  const first = newerIsDrop ? drop : keep
  const second = newerIsDrop ? keep : drop
  const src = (m: MergeMember): FieldSource => (m === keep ? 'keep' : 'drop')
  push(src(first), first.email)
  push(src(second), second.email)
  push(src(first), first.school_email)
  push(src(second), second.school_email)

  const personal = ordered.find((o) => !isLikelySchoolEmail(o.value))
  // No personal-looking address: the first school one is the primary, as on a
  // form, and a second school address (if any) is kept as school_email.
  const primary = personal ?? ordered[0] ?? { source: 'keep' as FieldSource, value: String(keep.email ?? '') }
  const school = ordered.find((o) => isLikelySchoolEmail(o.value) && o !== primary)

  return {
    email: { source: primary.source, value: primary.value, reason: 'email_sort' },
    school_email: school
      ? { source: school.source, value: school.value, reason: 'email_sort' }
      : { source: 'keep', value: keep.school_email ?? null, reason: 'email_sort' },
  }
}

/** The default choice for every field, before the admin reviews it. */
export function proposeMerge(keep: MergeMember, drop: MergeMember): MergeProposal {
  const newerIsDrop = Date.parse(drop.updated_at) > Date.parse(keep.updated_at)
  const fields: Record<string, FieldChoice> = {}

  for (const { column } of MERGE_FIELDS) {
    if (column === 'email' || column === 'school_email') continue
    const k = keep[column]
    const d = drop[column]
    if (column === 'clerk_user_id') {
      // The survivor keeps its own login; it inherits the other's only when it
      // has none (the other login would otherwise be deleted).
      fields[column] = isBlank(k) && !isBlank(d)
        ? { source: 'drop', value: d, reason: 'login' }
        : { source: 'keep', value: k ?? null, reason: 'login' }
      continue
    }
    if (same(k, d)) fields[column] = { source: 'keep', value: k ?? null, reason: 'same' }
    else if (isBlank(d)) fields[column] = { source: 'keep', value: k, reason: 'only_keep' }
    else if (isBlank(k)) fields[column] = { source: 'drop', value: d, reason: 'only_drop' }
    else fields[column] = newerIsDrop
      ? { source: 'drop', value: d, reason: 'newer' }
      : { source: 'keep', value: k, reason: 'newer' }
  }

  const emails = proposeEmails(keep, drop)
  fields.email = emails.email
  fields.school_email = emails.school_email

  return { keepId: keep.id, dropId: drop.id, fields }
}

/**
 * The columns to write to the survivor: only those whose chosen value differs
 * from what it already holds. Personal and school must not be the same address.
 */
export function fieldsToWrite(
  keep: MergeMember,
  chosen: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const column of MERGE_COLUMNS) {
    if (!(column in chosen)) continue
    let v = chosen[column]
    if (typeof v === 'string') v = v.trim() === '' ? null : v.trim()
    if (column === 'email' || column === 'school_email' || column === 'ec_email') {
      v = typeof v === 'string' ? v.toLowerCase() : v
    }
    if (!same(v, keep[column])) out[column] = v
  }
  if (typeof out.school_email === 'string' && same(out.school_email, out.email ?? keep.email)) {
    out.school_email = null
  }
  return out
}

export interface MergeValidation {
  ok: boolean
  error?: string
}

/** Checked by the API before the transaction runs. */
export function validateMergeChoice(chosen: Record<string, unknown>, keep: MergeMember): MergeValidation {
  const email = (chosen.email ?? keep.email) as unknown
  if (isBlank(email)) return { ok: false, error: 'The kept record needs an email address.' }
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return { ok: false, error: 'The personal email is not a valid address.' }
  }
  const school = chosen.school_email
  if (!isBlank(school) && (typeof school !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(school.trim()))) {
    return { ok: false, error: 'The school email is not a valid address.' }
  }
  if (isBlank(chosen.first_name ?? keep.first_name) || isBlank(chosen.last_name ?? keep.last_name)) {
    return { ok: false, error: 'The kept record needs a first and last name.' }
  }
  if (isBlank(chosen.date_of_birth ?? keep.date_of_birth)) {
    return { ok: false, error: 'The kept record needs a date of birth.' }
  }
  for (const key of Object.keys(chosen)) {
    if (!MERGE_COLUMNS.includes(key)) return { ok: false, error: `${key} cannot be set by a merge.` }
  }
  return { ok: true }
}
