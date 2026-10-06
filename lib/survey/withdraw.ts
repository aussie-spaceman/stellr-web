/**
 * Withdraw one response's quote (V2.3 §2): by an admin, or by the member it
 * belongs to. Permanent — the database refuses to reinstate it — and excluded
 * from every later testimonial export. Logged to audit_log, and to the
 * member's activity history when the response is linked to an account.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { logActivity, type Actor } from '@/lib/activity-log'
import { writeAudit } from './audit'

export async function withdrawQuote(
  db: SupabaseClient,
  responseId: string,
  actor: string,
  by: 'admin' | 'member',
  activityActor?: Actor,
): Promise<boolean> {
  const { data, error } = await db
    .from('survey_responses')
    .update({ quote_withdrawn_at: new Date().toISOString(), quote_withdrawn_by: `${by}:${actor}` })
    .eq('id', responseId)
    .not('submitted_at', 'is', null)
    .is('quote_withdrawn_at', null)
    .select('id, member_id, distribution_id, event_slug')
  if (error) throw new Error(`Withdrawing the quote failed: ${error.message}`)
  if (!data?.length) return false
  await writeAudit(db, { table: 'survey_quote_withdrawal', recordId: responseId, action: 'UPDATE', actor, data: { by } })

  const r = data[0] as { member_id: string | null; distribution_id: string | null; event_slug: string | null }
  if (r.member_id) {
    const { data: dist } = r.distribution_id
      ? await db.from('survey_distributions').select('event_title').eq('id', r.distribution_id).maybeSingle()
      : { data: null }
    const event = (dist?.event_title as string | null | undefined) ?? r.event_slug ?? 'event'
    await logActivity(
      {
        memberId: r.member_id,
        ...(activityActor ?? { actorType: by }),
        category: 'survey',
        action: 'survey_quote_withdrawn',
        summary: `Withdrew permission to quote the ${event} survey answers`,
        metadata: { response_id: responseId, event_slug: r.event_slug, by },
      },
      db,
    )
  }
  return true
}
