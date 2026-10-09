// The ONE place a background-check row's status is written from a vendor
// outcome. Both the inbound webhook (app/api/webhooks/background) and the
// polling sync below call applyCheckOutcome, so a row reached by either path
// ends up identical: same columns, same expiry rule, same audit entry.
//
// WHY the sync exists: Checkr delivers each webhook once and does not replay.
// In June 2026 the endpoint was registered against a misspelled domain and six
// completed reports were never reflected here — the rows sat at 'invited' with
// no signal that anything was wrong, because nothing ever looked again. The
// daily cron (app/api/cron/background-sync) and the admin "Sync now" button
// (app/api/admin/compliance/sync) both run syncStaleChecks.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BackgroundProvider, BackgroundWebhookResult, MappedStatus } from '@/lib/background-provider'
import { BC_VALIDITY_YEARS } from '@/lib/compliance'
import { logActivity } from '@/lib/activity-log'
import { notifyCommunityAdmins } from '@/lib/notify'
import { escapeHtml } from '@/lib/email-layout'

export interface CheckRowRef {
  id: string
  member_id: string
  status: string
}

export type CheckOutcome = BackgroundWebhookResult & { status: MappedStatus }

const TERMINAL_AUDIT: Record<string, { action: string; summary: string }> = {
  passed: { action: 'background_check_passed', summary: 'Background check completed — cleared' },
  referred: { action: 'background_check_referred', summary: 'Background check completed — flagged for review' },
  cancelled: { action: 'background_check_cancelled', summary: 'Background check canceled before completion' },
  expired: { action: 'background_check_expired', summary: 'Background check invitation expired without completion' },
}

/**
 * Apply a vendor outcome to our row. Idempotent: re-applying the same outcome
 * rewrites the same values, and the audit entry is written only when the
 * status actually changes (webhooks can be delivered more than once).
 */
export async function applyCheckOutcome(
  db: SupabaseClient,
  row: CheckRowRef,
  outcome: CheckOutcome,
  source: 'webhook' | 'sync',
): Promise<{ changed: boolean }> {
  const now = new Date().toISOString()
  const update: Record<string, unknown> = {
    status: outcome.status,
    result: outcome.result,
    updated_at: now,
  }
  if (outcome.reportRef) update.provider_report_ref = outcome.reportRef
  if (outcome.assessment != null) update.assessment = outcome.assessment
  if (outcome.includesCanceled != null) update.includes_canceled = outcome.includesCanceled

  // passed/referred/cancelled are a finished report; expired = invite never used.
  const reportCompleted = outcome.status === 'passed' || outcome.status === 'referred' || outcome.status === 'cancelled'
  if (reportCompleted) {
    update.completed_at = now
    if (outcome.status === 'passed') {
      const expires = new Date()
      expires.setFullYear(expires.getFullYear() + BC_VALIDITY_YEARS)
      update.expires_at = expires.toISOString()
    }
  }

  // Reconcile with a prior Stellr adjudication (deep review BG-3). A later vendor
  // event must not leave a stale human decision standing. If this check was
  // adjudicated and the incoming vendor outcome flags it again ('referred') or
  // disagrees with the recorded decision (adverse action after a 'cleared', or a
  // 'passed' on a row an adjudicator marked not_cleared), clear the adjudication
  // so the row returns to "needs review" instead of silently staying cleared.
  // deriveCompliance already makes an explicit not_cleared dominant; this stops a
  // dead 'cleared' decision outliving new adverse facts.
  let adjudicationReset = false
  if (outcome.status === 'referred' || outcome.status === 'passed') {
    const { data: cur } = await db
      .from('member_background_checks')
      .select('adjudication_outcome, adjudicated_at')
      .eq('id', row.id)
      .maybeSingle()
    if (cur?.adjudicated_at) {
      const decisionWasCleared = cur.adjudication_outcome === 'cleared'
      const vendorSaysCleared = outcome.status === 'passed'
      if (outcome.status === 'referred' || decisionWasCleared !== vendorSaysCleared) {
        update.adjudicated_at = null
        update.adjudication_outcome = null
        update.adjudicated_label = null
        update.expires_at = null // a cleared adjudication's expiry no longer applies
        adjudicationReset = true
      }
    }
  }

  await db.from('member_background_checks').update(update).eq('id', row.id)

  const changed = row.status !== outcome.status

  // A prior human decision was just invalidated by a conflicting vendor event:
  // announce it so an adjudicator re-reviews, rather than trusting a cleared pill
  // that no longer reflects the report (deep review BG-3).
  if (adjudicationReset) {
    try {
      const { data: member } = await db
        .from('members').select('first_name, last_name, email').eq('id', row.member_id).maybeSingle()
      const who = [member?.first_name, member?.last_name].filter(Boolean).join(' ') || member?.email || 'A member'
      const body =
        `Checkr sent a new background-check outcome for ${who} that conflicts with the decision an ` +
        `adjudicator had already recorded. The prior decision has been cleared; they are NOT cleared ` +
        `until the report is re-reviewed and a fresh decision is recorded in Stellr.`
      await notifyCommunityAdmins({
        type: 'action',
        body,
        referenceType: 'member',
        referenceId: row.member_id,
        email: {
          subject: `Background check needs re-review — ${who}`,
          html: `<p>${escapeHtml(body)}</p><p><a href="${escapeHtml(process.env.NEXT_PUBLIC_AUTH_APP_URL ?? '')}/admin/members/${encodeURIComponent(row.member_id)}">Open their compliance panel</a></p>`,
          text: body,
        },
      })
    } catch (err) {
      console.error('[background-sync] adjudication-reset notification failed:', err)
    }
  }

  // A flagged report is the one outcome that CANNOT resolve itself: somebody has
  // to look at what was found and decide. Until 22 Sept 2026 nothing announced
  // it — the only trace was an activity-log row and a red pill on a page nobody
  // had reason to open, so a person waiting on clearance could sit unnoticed.
  if (changed && outcome.status === 'referred' && !adjudicationReset) {
    try {
      const { data: member } = await db
        .from('members')
        .select('first_name, last_name, email')
        .eq('id', row.member_id)
        .maybeSingle()
      const who =
        [member?.first_name, member?.last_name].filter(Boolean).join(' ') || member?.email || 'A member'
      const body =
        `${who}'s background check came back flagged for review (result: ${outcome.result ?? 'consider'}). ` +
        `They are NOT cleared to take part until the adjudicator reviews the report in the provider dashboard ` +
        `and records the decision in Stellr.`
      await notifyCommunityAdmins({
        type: 'action',
        body,
        referenceType: 'member',
        referenceId: row.member_id,
        email: {
          subject: `Background check needs review — ${who}`,
          html: `<p>${body}</p><p><a href="${process.env.NEXT_PUBLIC_AUTH_APP_URL ?? ''}/admin/members/${row.member_id}">Open their compliance panel</a></p>`,
          text: body,
        },
      })
    } catch (err) {
      // Never let a notification failure lose the outcome we just wrote.
      console.error('[background-sync] referred notification failed:', err)
    }
  }

  const audit = TERMINAL_AUDIT[outcome.status]
  if (changed && audit) {
    await logActivity(
      {
        memberId: row.member_id,
        category: 'compliance',
        action: audit.action,
        summary: outcome.includesCanceled ? `${audit.summary} (includes canceled screenings)` : audit.summary,
        metadata: {
          result: outcome.result,
          assessment: outcome.assessment ?? null,
          includesCanceled: outcome.includesCanceled ?? false,
          reportRef: outcome.reportRef,
          source,
        },
        actorType: 'system',
      },
      db,
    )
  }
  return { changed }
}

export interface SyncOptions {
  /** Skip rows touched more recently than this — leaves room for an in-flight webhook. */
  minAgeMinutes?: number
  /** Cap per run; each row costs one or two vendor GETs. */
  limit?: number
}

export interface SyncResult {
  scanned: number
  updated: number
  unchanged: number
  errors: { id: string; error: string }[]
}

/**
 * Re-poll every open (invited / in_progress) row for this provider and apply
 * whatever the vendor now says. Safe to run repeatedly.
 */
export async function syncStaleChecks(
  db: SupabaseClient,
  provider: BackgroundProvider,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const { minAgeMinutes = 0, limit = 100 } = opts
  const cutoff = new Date(Date.now() - minAgeMinutes * 60_000).toISOString()

  const { data, error } = await db
    .from('member_background_checks')
    .select('id, member_id, status, provider_candidate_ref, provider_invitation_ref, provider_report_ref')
    .eq('provider', provider.name)
    .in('status', ['invited', 'in_progress'])
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`background-sync: could not load open checks: ${error.message}`)

  const result: SyncResult = { scanned: 0, updated: 0, unchanged: 0, errors: [] }

  for (const row of data ?? []) {
    result.scanned++
    try {
      const outcome = await provider.fetchStatus({
        candidateRef: row.provider_candidate_ref,
        invitationRef: row.provider_invitation_ref,
        reportRef: row.provider_report_ref,
      })
      if (!outcome || !outcome.status) {
        result.unchanged++
        continue
      }
      const { changed } = await applyCheckOutcome(
        db,
        { id: row.id, member_id: row.member_id, status: row.status },
        outcome as CheckOutcome,
        'sync',
      )
      if (changed) result.updated++
      else result.unchanged++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[background-sync] row', row.id, message)
      result.errors.push({ id: row.id, error: message })
    }
  }

  return result
}
