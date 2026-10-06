/**
 * Withdraw one response's quote (V2.3 §2): by an admin, or by the member it
 * belongs to. Permanent — the database refuses to reinstate it — and excluded
 * from every later testimonial export. Logged to audit_log.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { writeAudit } from './audit'

export async function withdrawQuote(db: SupabaseClient, responseId: string, actor: string, by: 'admin' | 'member'): Promise<boolean> {
  const { data, error } = await db
    .from('survey_responses')
    .update({ quote_withdrawn_at: new Date().toISOString(), quote_withdrawn_by: `${by}:${actor}` })
    .eq('id', responseId)
    .not('submitted_at', 'is', null)
    .is('quote_withdrawn_at', null)
    .select('id')
  if (error) throw new Error(`Withdrawing the quote failed: ${error.message}`)
  if (!data?.length) return false
  await writeAudit(db, { table: 'survey_quote_withdrawal', recordId: responseId, action: 'UPDATE', actor, data: { by } })
  return true
}
