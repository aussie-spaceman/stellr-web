// Email campaign engine (Layer 3). Resolves a campaign's audience from a
// structured filter, renders the stored template per recipient, sends via the
// existing Resend wrapper, and records every recipient in an idempotency ledger
// so re-runs (cron retries, manual replays) never double-send.
//
// NB: lib/campaigns.ts is unrelated (Fall/Spring program registration windows).

import { supabaseServer } from '@/lib/supabase'
import { sendEmail, MARKETING_FROM } from '@/lib/email'
import { renderCampaignEmail } from '@/lib/email-render'
import { memberMergeVars, type CampaignMember } from '@/lib/email-vars'

const MINOR_AGE_BRACKET = 'high_school' // school students are minors — never marketed to

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.stellreducation.org'
}

export function unsubscribeUrl(token: string): string {
  return `${appUrl()}/api/email/unsubscribe?token=${token}`
}

// ─── Audience ───────────────────────────────────────────────────────────────

export interface Audience {
  activeOnly?: boolean
  excludeMinors?: boolean
  /** Restrict to members whose current tier is in this set. null/empty = all tiers. */
  tierIds?: string[] | null
}

interface AudienceMember extends CampaignMember {
  marketing_unsubscribe_token: string
}

/**
 * Resolve an audience to a list of mailable members. Marketing-consent
 * suppression is ALWAYS applied on top of the filter — a campaign can never
 * widen its reach past members who have opted out.
 */
export async function resolveAudience(
  audience: Audience,
  opts?: { memberIds?: string[] },
): Promise<AudienceMember[]> {
  const db = supabaseServer()

  let q = db
    .from('members')
    .select('id, first_name, last_name, email, membership_id, age_bracket, marketing_unsubscribe_token')
    .eq('marketing_consent', true)
    .not('email', 'is', null)

  // Scope to specific members (event hooks pass a single id — avoids loading the
  // whole base just to check one recipient).
  if (opts?.memberIds) {
    if (opts.memberIds.length === 0) return []
    q = q.in('id', opts.memberIds)
  }

  if (audience.activeOnly) q = q.eq('is_active', true)
  if (audience.excludeMinors) q = q.neq('age_bracket', MINOR_AGE_BRACKET) // also drops null age (conservative)

  const { data: members, error } = await q
  if (error) throw new Error(`resolveAudience: ${error.message}`)
  if (!members?.length) return []

  // Attach current tier name (best-effort — tolerate membership schema drift).
  const tierByMember = await loadTierNames(members.map((m) => m.id))

  let rows: AudienceMember[] = members.map((m) => ({
    id: m.id,
    first_name: m.first_name,
    last_name: m.last_name,
    email: m.email,
    membership_id: m.membership_id,
    marketing_unsubscribe_token: m.marketing_unsubscribe_token,
    tier_name: tierByMember.get(m.id)?.name ?? null,
  }))

  const tierIds = audience.tierIds?.filter(Boolean)
  if (tierIds && tierIds.length) {
    rows = rows.filter((m) => {
      const tid = tierByMember.get(m.id)?.tierId
      return tid != null && tierIds.includes(tid)
    })
  }

  return rows
}

async function loadTierNames(memberIds: string[]): Promise<Map<string, { tierId: string; name: string | null }>> {
  const map = new Map<string, { tierId: string; name: string | null }>()
  if (!memberIds.length) return map
  const db = supabaseServer()
  const { data, error } = await db
    .from('member_memberships')
    .select('member_id, tier_id, membership_tiers(name)')
    .in('member_id', memberIds)
  if (error || !data) return map // schema drift / no memberships — tier stays null
  for (const row of data as Array<{ member_id: string; tier_id: string; membership_tiers: { name: string } | { name: string }[] | null }>) {
    if (map.has(row.member_id)) continue // first wins; good enough for tier display/filter
    const t = Array.isArray(row.membership_tiers) ? row.membership_tiers[0] : row.membership_tiers
    map.set(row.member_id, { tierId: row.tier_id, name: t?.name ?? null })
  }
  return map
}

// ─── Sending ────────────────────────────────────────────────────────────────

interface Template {
  name: string
  subject: string
  body_json: unknown
}

export interface SendResult {
  sent: number
  failed: number
  skipped: number // already in the ledger for this (campaign, dedupKey)
}

/**
 * Send `template` to `members` for `campaignId`, recording each in the ledger.
 * Idempotent: members already present for (campaignId, dedupKey) are skipped.
 */
export async function sendToMembers(
  campaignId: string,
  template: Template,
  members: AudienceMember[],
  dedupKey = '',
): Promise<SendResult> {
  const db = supabaseServer()

  const { data: already } = await db
    .from('email_campaign_sends')
    .select('member_id')
    .eq('campaign_id', campaignId)
    .eq('dedup_key', dedupKey)
  const done = new Set((already ?? []).map((r) => r.member_id))

  const result: SendResult = { sent: 0, failed: 0, skipped: 0 }

  for (const m of members) {
    if (done.has(m.id)) { result.skipped++; continue }
    if (!m.email) { result.skipped++; continue }

    const unsub = unsubscribeUrl(m.marketing_unsubscribe_token)
    const vars = memberMergeVars(m, unsub)
    let status: 'sent' | 'failed' = 'sent'
    let error: string | null = null
    try {
      const { subject, html, text } = renderCampaignEmail(template, vars, unsub)
      await sendEmail({ to: m.email, from: MARKETING_FROM, subject, html, text })
      result.sent++
    } catch (e) {
      status = 'failed'
      error = e instanceof Error ? e.message : String(e)
      result.failed++
      console.error('[email-campaigns] send failed for', m.email, '—', error)
    }

    // Ledger insert; UNIQUE guards against races (parallel cron runs).
    const { error: ledgerErr } = await db
      .from('email_campaign_sends')
      .insert({ campaign_id: campaignId, member_id: m.id, dedup_key: dedupKey, status, error })
    if (ledgerErr && !ledgerErr.message.toLowerCase().includes('duplicate')) {
      console.error('[email-campaigns] ledger insert error:', ledgerErr.message)
    }
  }

  return result
}

// ─── Scheduled dispatch (cron) ──────────────────────────────────────────────

/**
 * Find every one-time campaign whose send time has arrived and run it. Called
 * by /api/cron/campaigns. Each campaign is claimed (status→sending) before
 * sending so overlapping cron ticks don't both process it.
 */
export async function dispatchDueCampaigns(): Promise<{ processed: number; results: Record<string, SendResult> }> {
  const db = supabaseServer()
  const now = new Date().toISOString()

  const { data: due } = await db
    .from('email_campaigns')
    .select('id, template_id, audience')
    .eq('trigger_type', 'scheduled')
    .eq('status', 'scheduled')
    .lte('scheduled_at', now)

  const results: Record<string, SendResult> = {}
  if (!due?.length) return { processed: 0, results }

  for (const c of due) {
    // Claim: only proceed if we flip scheduled→sending (atomic guard).
    const { data: claimed } = await db
      .from('email_campaigns')
      .update({ status: 'sending', updated_at: now })
      .eq('id', c.id)
      .eq('status', 'scheduled')
      .select('id')
      .maybeSingle()
    if (!claimed) continue // another tick took it

    const template = await loadTemplate(c.template_id)
    if (!template) {
      await db.from('email_campaigns').update({ status: 'draft' }).eq('id', c.id)
      continue
    }

    const members = await resolveAudience((c.audience ?? {}) as Audience)
    results[c.id] = await sendToMembers(c.id, template, members)

    await db
      .from('email_campaigns')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', c.id)
  }

  return { processed: Object.keys(results).length, results }
}

// ─── Event trigger ──────────────────────────────────────────────────────────

/**
 * Fire any active event-campaigns bound to `eventKey` at a single member.
 * Call from app code at lifecycle points, e.g.
 *   fireCampaignEvent('member.created', member.id)
 *   fireCampaignEvent('membership.renewal_7d', member.id, `renewal-${year}`)
 * `dedupKey` lets a recurring event (yearly renewal) legitimately re-send while
 * still being idempotent within a given occurrence.
 */
export async function fireCampaignEvent(eventKey: string, memberId: string, dedupKey = ''): Promise<void> {
  const db = supabaseServer()
  const { data: campaigns } = await db
    .from('email_campaigns')
    .select('id, template_id, audience, delay_days')
    .eq('trigger_type', 'event')
    .eq('event_key', eventKey)
    .eq('status', 'scheduled')
  if (!campaigns?.length) return

  for (const c of campaigns) {
    const delayDays = (c as { delay_days?: number | null }).delay_days ?? 0

    // Delayed step of a drip: park it for the cron to drain. Deliberately does
    // NOT resolve the audience now — consent and eligibility are re-checked at
    // send time, so a member who unsubscribes in week two of a five-week
    // sequence stops receiving it.
    if (delayDays > 0) {
      const dueAt = new Date(Date.now() + delayDays * 86_400_000).toISOString()
      const { error } = await db
        .from('email_campaign_queue')
        .insert({ campaign_id: c.id, member_id: memberId, due_at: dueAt, dedup_key: dedupKey })
      // The UNIQUE index is the idempotency guard; a duplicate means this
      // occurrence is already queued, which is success, not failure.
      if (error && !error.message.toLowerCase().includes('duplicate')) {
        console.error('[email-campaigns] drip enqueue error:', error.message)
      }
      continue
    }

    const template = await loadTemplate(c.template_id)
    if (!template) continue
    // Resolve just this member through the campaign's audience so consent/minor/
    // tier rules still apply to event sends.
    const [target] = await resolveAudience((c.audience ?? {}) as Audience, { memberIds: [memberId] })
    if (!target) continue
    await sendToMembers(c.id, template, [target], dedupKey)
  }
}

// ─── Drip dispatch (cron) ───────────────────────────────────────────────────

export interface DripResult {
  due: number
  sent: number
  skipped: number
  failed: number
}

/**
 * Drain queued drip steps whose due date has arrived. Called by
 * /api/cron/campaign-drip.
 *
 * Eligibility is re-evaluated here rather than at enqueue time: a member who
 * unsubscribed, went inactive, or dropped out of the campaign's tier filter
 * between the trigger and the due date is skipped, not sent. sendToMembers
 * still writes the send ledger, so the two idempotency layers agree.
 */
export async function dispatchDueDrips(limit = 200): Promise<DripResult> {
  const db = supabaseServer()
  const result: DripResult = { due: 0, sent: 0, skipped: 0, failed: 0 }

  const { data: due } = await db
    .from('email_campaign_queue')
    .select('id, campaign_id, member_id, dedup_key')
    .eq('status', 'pending')
    .lte('due_at', new Date().toISOString())
    .order('due_at', { ascending: true })
    .limit(limit)

  if (!due?.length) return result
  result.due = due.length

  // Campaigns are few relative to queued rows — load each at most once.
  const campaignCache = new Map<string, { template_id: string; audience: unknown; status: string } | null>()

  for (const row of due) {
    // Claim the row before doing any work, so two overlapping cron ticks can't
    // both send it. Only the tick that flips pending→sent proceeds.
    const { data: claimed } = await db
      .from('email_campaign_queue')
      .update({ status: 'sent', processed_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claimed) continue

    // Claiming optimistically marked the row 'sent'; correct it when the step
    // turns out not to have sent.
    const finish = async (status: 'skipped' | 'failed', note: string) => {
      await db.from('email_campaign_queue').update({ status, note }).eq('id', row.id)
      result[status]++
    }

    try {
      if (!campaignCache.has(row.campaign_id)) {
        const { data } = await db
          .from('email_campaigns')
          .select('template_id, audience, status')
          .eq('id', row.campaign_id)
          .maybeSingle()
        campaignCache.set(row.campaign_id, data ?? null)
      }
      const campaign = campaignCache.get(row.campaign_id)

      // A campaign paused or archived mid-drip stops sending its queued steps.
      if (!campaign || campaign.status !== 'scheduled') {
        await finish('skipped', `campaign ${campaign?.status ?? 'missing'}`)
        continue
      }

      const template = await loadTemplate(campaign.template_id)
      if (!template) {
        await finish('skipped', 'template missing or archived')
        continue
      }

      const [target] = await resolveAudience((campaign.audience ?? {}) as Audience, {
        memberIds: [row.member_id],
      })
      if (!target) {
        await finish('skipped', 'no longer in audience')
        continue
      }

      const sendResult = await sendToMembers(row.campaign_id, template, [target], row.dedup_key ?? '')
      if (sendResult.failed > 0) await finish('failed', 'send failed')
      else result.sent++
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[email-campaigns] drip row failed:', row.id, msg)
      await finish('failed', msg.slice(0, 300))
    }
  }

  return result
}

export async function loadTemplate(templateId: string): Promise<Template | null> {
  const db = supabaseServer()
  const { data } = await db
    .from('email_templates')
    .select('name, subject, body_json')
    .eq('id', templateId)
    .eq('is_archived', false)
    .maybeSingle()
  return data ?? null
}
