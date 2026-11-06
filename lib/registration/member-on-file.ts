import type { SupabaseClient } from '@supabase/supabase-js'

// Is this address already on file? A caller with no session has not proven an
// address is theirs, so the join link, the individual form and the group form's
// organiser are asked to sign in before anything is written.

/** The forms answer this code by asking the person to sign in. */
export const SIGN_IN_REQUIRED = 'sign_in_required'

export type MemberOnFile =
  /** A failed read cannot tell new from existing: the caller refuses, and retries. */
  | { ok: false; error: unknown }
  | {
      ok: true
      onFile: boolean
      /**
       * Matched only as a school address. A login made with that address does not
       * reach the member it belongs to, so a form must not suggest making one.
       */
      schoolAddressOnly: boolean
    }

/**
 * Both addresses count (4 Nov 2026). upsertMember also links by the school address,
 * so a submitted school address naming a member must not read as new. The last read
 * is an address another member holds as their school address, which would otherwise
 * be copied onto a second row.
 */
export async function findMemberOnFile(
  db: SupabaseClient,
  email: string,
  schoolEmail: string | null | undefined,
): Promise<MemberOnFile> {
  const { data: byEmail, error: byEmailError } = await db
    .from('members').select('id').eq('email', email).maybeSingle()
  const { data: bySchool, error: bySchoolError } = await db
    .from('members').select('id').eq('school_email', email).limit(1).maybeSingle()
  const separateSchoolAddress = schoolEmail && schoolEmail !== email ? schoolEmail : null
  const { data: schoolAsPrimary, error: schoolAsPrimaryError } = separateSchoolAddress
    ? await db.from('members').select('id').eq('email', separateSchoolAddress).maybeSingle()
    : { data: null, error: null }
  const { data: schoolHolder, error: schoolHolderError } = separateSchoolAddress
    ? await db.from('members').select('id').eq('school_email', separateSchoolAddress).limit(1).maybeSingle()
    : { data: null, error: null }

  const error = byEmailError ?? bySchoolError ?? schoolAsPrimaryError ?? schoolHolderError
  if (error) return { ok: false, error }
  return {
    ok: true,
    onFile: !!(byEmail || bySchool || schoolAsPrimary || schoolHolder),
    schoolAddressOnly: !byEmail && !schoolAsPrimary,
  }
}
