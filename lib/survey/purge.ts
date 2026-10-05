/**
 * Deletion requests (handover §14.3): a person's survey responses and answers
 * are deleted outright — nothing de-identified is kept; published aggregates
 * are unaffected. survey_purge_person() (definer) removes responses, answers,
 * invitations and privacy prefs, and writes a content-free audit_log row.
 *
 * Called by lib/deletion/execute.ts on a hard delete of a member, participant
 * or registration, before any row goes (a member's participant rows survive a
 * member delete, so the FK cascades alone would miss their responses).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export async function purgeSurveyDataFor(
  db: SupabaseClient,
  kind: 'member' | 'participant' | 'registration',
  id: string,
  actor: string,
): Promise<{ responses: number; invitations: number }> {
  let memberId: string | null = null
  let participantIds: string[] = []
  const emails: string[] = []

  if (kind === 'member') {
    memberId = id
    const [{ data: m }, { data: parts }] = await Promise.all([
      db.from('members').select('email').eq('id', id).maybeSingle(),
      db.from('participants').select('id').eq('member_id', id),
    ])
    if (m?.email) emails.push(m.email as string)
    participantIds = (parts ?? []).map((p) => p.id as string)
  } else if (kind === 'participant') {
    const { data: p } = await db.from('participants').select('id, email').eq('id', id).maybeSingle()
    participantIds = [id]
    if (p?.email) emails.push(p.email as string)
  } else {
    const { data: parts } = await db.from('participants').select('id').eq('registration_id', id)
    participantIds = (parts ?? []).map((p) => p.id as string)
  }

  const { data, error } = await db.rpc('survey_purge_person', {
    p_member_id: memberId,
    p_participant_ids: participantIds,
    p_emails: emails,
    p_actor: actor,
  })
  if (error) throw new Error(`Survey data purge failed: ${error.message}`)
  return data as { responses: number; invitations: number }
}
