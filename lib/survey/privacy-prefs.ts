/**
 * Students' own quote and photo/media permissions (Minors Agreement V2.3
 * §1.7), shown in account settings to students aged 13 and over.
 *
 *   Quoting and photo/media: on by default (the agreement's opt-out model);
 *   off by default for 13–17-year-olds in NY or CO until they turn it on
 *   (handover §7; privacy runbook Part C).
 * A stored null means "the default" so the default can follow the student
 * (turning 18, moving school) without a migration. A parent's opt-out on the
 * agreement overrides either toggle — that is applied where the permission is
 * used (lib/survey/quotes.ts), not here.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { ageIfKnown } from './minor'
import { defaultAllowQuotes } from './consent'

export interface PrivacyPrefsView {
  eligible: boolean
  allowQuotes: boolean
  allowMedia: boolean
  quotesDefault: boolean
}

async function schoolState(db: SupabaseClient, memberId: string): Promise<string | null> {
  const { data } = await db.from('member_schools').select('is_current, schools(state)').eq('member_id', memberId).order('is_current', { ascending: false }).limit(1)
  return ((data?.[0] as { schools?: { state: string | null } } | undefined)?.schools?.state) ?? null
}

/** Students (school or college) aged 13+ see the toggles. */
export function showsPrivacyToggles(m: { event_role?: string | null; age_bracket?: string | null; date_of_birth?: string | null }): boolean {
  const student = m.event_role === 'participant' || m.age_bracket === 'high_school' || m.age_bracket === 'college'
  const age = ageIfKnown(m.date_of_birth)
  return student && age !== null && age >= 13
}

export async function privacyPrefsFor(
  db: SupabaseClient,
  m: { id: string; event_role?: string | null; age_bracket?: string | null; date_of_birth?: string | null },
): Promise<PrivacyPrefsView> {
  const [{ data }, state] = await Promise.all([
    db.from('member_privacy_prefs').select('allow_quotes, allow_media').eq('member_id', m.id).maybeSingle(),
    schoolState(db, m.id),
  ])
  const quotesDefault = defaultAllowQuotes(ageIfKnown(m.date_of_birth), state)
  return {
    eligible: showsPrivacyToggles(m),
    allowQuotes: (data?.allow_quotes as boolean | null) ?? quotesDefault,
    allowMedia: (data?.allow_media as boolean | null) ?? quotesDefault,
    quotesDefault,
  }
}
