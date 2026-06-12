import type { SupabaseClient } from '@supabase/supabase-js'

export interface MemberOptionSelections {
  memberId: string
  /** Registration-form display strings, e.g. 'White (Caucasian)'. */
  ethnicity?: string[]
  /** Registration-form display strings, e.g. 'Gluten Free'. */
  dietary?: string[]
}

const norm = (s: string) => s.trim().toLowerCase()

// Replace members' ethnicity / dietary selections (member_ethnicities and
// member_allergies join rows — the canonical representation, shared with the
// account page and admin member editor) from the registration form's display
// strings. The option tables' names ARE the form's display strings, so matching
// is a trimmed case-insensitive name lookup. Unknown names are skipped — the
// option tables decide what's selectable; registration must not invent options.
// A member whose submitted array is empty or resolves to nothing keeps their
// existing selections (never wipe on missing data). Non-fatal throughout — a
// registration must never fail because of profile syncing.
export async function syncMemberOptionSelections(
  db: SupabaseClient,
  selections: (MemberOptionSelections | null | undefined)[]
): Promise<void> {
  try {
    const entries = selections.filter((s): s is MemberOptionSelections => Boolean(s?.memberId))
    const wantsEthnicity = entries.some((s) => (s.ethnicity?.length ?? 0) > 0)
    const wantsDietary = entries.some((s) => (s.dietary?.length ?? 0) > 0)
    if (!wantsEthnicity && !wantsDietary) return

    const [{ data: ethnicityOptions, error: ethErr }, { data: allergyOptions, error: alErr }] =
      await Promise.all([
        db.from('ethnicity_options').select('id, name'),
        db.from('allergy_options').select('id, name'),
      ])
    if (ethErr || alErr) {
      console.error('[member-options] Option lookup error:', ethErr ?? alErr)
      return
    }

    await Promise.all([
      replaceSelections(
        db, 'member_ethnicities', 'ethnicity_option_id',
        new Map((ethnicityOptions ?? []).map((o) => [norm(o.name), o.id])),
        entries.map((s) => ({ memberId: s.memberId, names: s.ethnicity ?? [] })),
      ),
      replaceSelections(
        db, 'member_allergies', 'allergy_option_id',
        new Map((allergyOptions ?? []).map((o) => [norm(o.name), o.id])),
        entries.map((s) => ({ memberId: s.memberId, names: s.dietary ?? [] })),
      ),
    ])
  } catch (e) {
    console.error('[member-options] Selection sync failed (non-fatal):', e)
  }
}

async function replaceSelections(
  db: SupabaseClient,
  table: 'member_ethnicities' | 'member_allergies',
  optionColumn: 'ethnicity_option_id' | 'allergy_option_id',
  idByName: Map<string, string>,
  entries: { memberId: string; names: string[] }[],
): Promise<void> {
  const rows: { member_id: string; [key: string]: string }[] = []
  const memberIds: string[] = []
  for (const { memberId, names } of entries) {
    const optionIds = new Set(
      names.map((n) => idByName.get(norm(n))).filter((id): id is string => Boolean(id))
    )
    if (optionIds.size === 0) continue
    memberIds.push(memberId)
    for (const id of optionIds) rows.push({ member_id: memberId, [optionColumn]: id })
  }
  if (memberIds.length === 0) return

  const { error: deleteError } = await db.from(table).delete().in('member_id', memberIds)
  if (deleteError) {
    console.error(`[member-options] ${table} delete error:`, deleteError)
    return
  }
  const { error: insertError } = await db.from(table).insert(rows)
  if (insertError) {
    console.error(`[member-options] ${table} insert error:`, insertError)
  }
}
