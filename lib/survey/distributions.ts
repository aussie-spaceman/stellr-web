/**
 * Distribution lifecycle: create one per event, keep it in step with the
 * event date, open it, invite people, close it. Every step is idempotent so
 * the cron, the Sanity webhook and the admin buttons can all call it.
 */
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliseDefinition, type SurveyDefinition } from './definition'
import { autoOpensAt, checkManualOpensAt, effectiveStatus, reconcileWithEvent, type ScheduleState } from './schedule'
import { localDate } from './timezone'
import type { SurveyEvent } from './events'
import { buildRecipientPlan, type Audience, type RecipientPlan } from './recipients'
import { hashToken, surveyToken } from './tokens'
import { writeAudit } from './audit'
import { isProd } from '@/lib/env'

export const SURVEY_KEY = 'post_event'

export interface DistributionRow extends ScheduleState {
  id: string
  definition_id: string
  event_slug: string
  event_title: string | null
  audiences: Audience[]
  opened_by: string | null
  opened_by_label: string | null
  opens_at_set_at: string | null
  opened_at: string | null
  paused_at: string | null
  closed_at: string | null
  closed_by: string | null
  gate_certificate: boolean
  last_run_at: string | null
  created_at: string
}

export interface DefinitionRow {
  id: string
  key: string
  version: number
  title: string
  definition: unknown
  status: 'draft' | 'published' | 'archived'
}

export async function latestPublishedDefinition(db: SupabaseClient, key = SURVEY_KEY): Promise<DefinitionRow | null> {
  const { data, error } = await db
    .from('survey_definitions')
    .select('id, key, version, title, definition, status')
    .eq('key', key)
    .eq('status', 'published')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Reading survey definitions failed: ${error.message}`)
  return (data as DefinitionRow | null) ?? null
}

/**
 * The definition new surveys use: the latest published one. Outside production
 * (APP_ENV=dev) the latest draft stands in when nothing is published, so the
 * flow can be tested before the wording is signed off and frozen.
 */
export async function usableDefinition(db: SupabaseClient, key = SURVEY_KEY): Promise<DefinitionRow | null> {
  const published = await latestPublishedDefinition(db, key)
  if (published || isProd()) return published
  const { data } = await db
    .from('survey_definitions')
    .select('id, key, version, title, definition, status')
    .eq('key', key)
    .eq('status', 'draft')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as DefinitionRow | null) ?? null
}

const defCache = new Map<string, SurveyDefinition>()
export async function loadDefinition(db: SupabaseClient, id: string): Promise<{ row: DefinitionRow; def: SurveyDefinition }> {
  const { data, error } = await db.from('survey_definitions').select('id, key, version, title, definition, status').eq('id', id).single()
  if (error || !data) throw new Error(`Survey definition ${id} not found`)
  const row = data as DefinitionRow
  // Published definitions never change, so caching by id is safe; drafts are re-read.
  let def = row.status !== 'draft' ? defCache.get(id) : undefined
  if (!def) {
    def = normaliseDefinition(row.definition)
    if (row.status !== 'draft') defCache.set(id, def)
  }
  return { row, def }
}

/** The event's post-event distribution, whichever definition version it uses. */
export async function distributionForEvent(db: SupabaseClient, slug: string): Promise<DistributionRow | null> {
  const { data, error } = await db
    .from('survey_distributions')
    .select('*, survey_definitions!inner(key)')
    .eq('event_slug', slug)
    .eq('survey_definitions.key', SURVEY_KEY)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Reading survey distribution failed: ${error.message}`)
  if (!data) return null
  const { survey_definitions: _d, ...row } = data as DistributionRow & { survey_definitions: unknown }
  return row as DistributionRow
}

export async function getDistribution(db: SupabaseClient, id: string): Promise<DistributionRow | null> {
  const { data, error } = await db.from('survey_distributions').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`Reading survey distribution failed: ${error.message}`)
  return (data as DistributionRow | null) ?? null
}

export type EnsureResult =
  | { action: 'created' | 'rescheduled' | 'flagged' | 'unchanged'; distribution: DistributionRow }
  | { action: 'skipped'; reason: string }

/**
 * Create the event's scheduled distribution if it has none (future events
 * only), or bring an existing one into step with the event (date moved,
 * cancelled). Called by the Sanity webhook, the cron sweep and the admin tab.
 */
export async function ensureDistribution(db: SupabaseClient, event: SurveyEvent, now = new Date()): Promise<EnsureResult> {
  if (event.isCampaign) return { action: 'skipped', reason: 'campaign' }
  const existing = await distributionForEvent(db, event.slug)

  if (existing) {
    const patch = reconcileWithEvent(existing, { lastDay: event.lastDay, timeZone: event.timeZone, cancelled: event.cancelled })
    if (event.title && event.title !== existing.event_title) (patch as Record<string, unknown>).event_title = event.title
    if (!Object.keys(patch).length) return { action: 'unchanged', distribution: existing }
    const { data, error } = await db.from('survey_distributions').update(patch).eq('id', existing.id).select('*').single()
    if (error) throw new Error(`Updating survey distribution failed: ${error.message}`)
    const action = patch.opens_at ? 'rescheduled' : patch.schedule_flag ? 'flagged' : 'unchanged'
    if (patch.opens_at || patch.schedule_flag) {
      await writeAudit(db, {
        table: 'survey_distributions',
        recordId: existing.id,
        action: 'UPDATE',
        actor: 'system:event-sync',
        data: { event: 'event_changed', before: { opens_at: existing.opens_at, event_date: existing.event_date }, after: patch },
      })
    }
    return { action, distribution: data as DistributionRow }
  }

  if (!event.lastDay) return { action: 'skipped', reason: 'no date' }
  if (event.cancelled) return { action: 'skipped', reason: 'cancelled' }
  // Backfill and creation cover events still to come (event-local today counts).
  if (event.lastDay < localDate(now, event.timeZone)) return { action: 'skipped', reason: 'past event' }
  const def = await usableDefinition(db)
  if (!def) return { action: 'skipped', reason: 'no published survey definition' }

  const opensAt = autoOpensAt(event.lastDay, event.timeZone)
  const { data, error } = await db
    .from('survey_distributions')
    .upsert(
      {
        definition_id: def.id,
        event_slug: event.slug,
        event_title: event.title,
        event_date: event.lastDay,
        event_time_zone: event.timeZone,
        opens_at: opensAt.toISOString(),
        closes_at: opensAt.toISOString(), // replaced by the trigger: opens_at + 30 days
        opens_at_source: 'auto',
        status: 'scheduled',
      },
      { onConflict: 'event_slug,definition_id', ignoreDuplicates: true },
    )
    .select('*')
  if (error) throw new Error(`Creating survey distribution failed: ${error.message}`)
  const row = (data?.[0] as DistributionRow | undefined) ?? (await distributionForEvent(db, event.slug))
  if (!row) throw new Error('Survey distribution vanished after create')
  return { action: 'created', distribution: row }
}

// ── Admin / event-manager actions ────────────────────────────────────────────

export interface Actor {
  memberId: string | null
  label: string // Clerk user id or email, for audit
}

type ActionResult = { ok: true; distribution: DistributionRow } | { ok: false; status: number; error: string }

async function patchDistribution(
  db: SupabaseClient,
  d: DistributionRow,
  patch: Record<string, unknown>,
  actor: Actor,
  event: string,
  onlyIfStatus?: DistributionRow['status'][],
): Promise<ActionResult> {
  let q = db.from('survey_distributions').update(patch).eq('id', d.id)
  if (onlyIfStatus) q = q.in('status', onlyIfStatus)
  const { data, error } = await q.select('*')
  if (error) return { ok: false, status: 500, error: error.message }
  if (!data?.length) return { ok: false, status: 409, error: 'The survey changed while you were looking at it. Reload and try again.' }
  await writeAudit(db, {
    table: 'survey_distributions',
    recordId: d.id,
    action: 'UPDATE',
    actor: actor.label,
    data: { event, event_slug: d.event_slug, before: { status: d.status, opens_at: d.opens_at, audiences: d.audiences }, after: patch },
  })
  return { ok: true, distribution: data[0] as DistributionRow }
}

/**
 * Bring go-live forward (or open now). Never later than the event date;
 * closes_at follows (trigger). Recorded as a manual override.
 */
export async function setEarlierGoLive(
  db: SupabaseClient,
  d: DistributionRow,
  requested: Date | 'now',
  actor: Actor,
  now = new Date(),
): Promise<ActionResult> {
  if (d.status !== 'scheduled') return { ok: false, status: 409, error: 'Only a scheduled survey can be brought forward.' }
  const auto = autoOpensAt(d.event_date, d.event_time_zone)
  const at = requested === 'now' ? now : requested
  const check = checkManualOpensAt(at, auto, now)
  if (!check.ok) {
    const msg = {
      later_than_event: 'The survey can open early, but not after the event date.',
      in_past: 'Choose a time from now on, or use “Send live now”.',
      invalid: 'That isn’t a valid date and time.',
    }[check.error]
    return { ok: false, status: 400, error: msg }
  }
  const opensNow = requested === 'now' || check.opensAt.getTime() <= now.getTime()
  return patchDistribution(
    db,
    d,
    {
      opens_at: check.opensAt.toISOString(),
      opens_at_source: 'manual',
      opened_by: actor.memberId,
      opened_by_label: actor.label,
      opens_at_set_at: now.toISOString(),
      schedule_flag: null,
      ...(opensNow ? { status: 'open', opened_at: now.toISOString() } : {}),
    },
    actor,
    opensNow ? 'send_live_now' : 'earlier_go_live',
    ['scheduled'],
  )
}

/** Return a manually-set go-live to the automatic one (event date, 00:00 local). */
export async function resetGoLive(db: SupabaseClient, d: DistributionRow, actor: Actor): Promise<ActionResult> {
  if (d.status !== 'scheduled') return { ok: false, status: 409, error: 'Only a scheduled survey can be reset.' }
  return patchDistribution(
    db,
    d,
    { opens_at: autoOpensAt(d.event_date, d.event_time_zone).toISOString(), opens_at_source: 'auto', schedule_flag: null, opened_by: null, opened_by_label: null, opens_at_set_at: null },
    actor,
    'reset_go_live',
    ['scheduled'],
  )
}

export async function setAudiences(db: SupabaseClient, d: DistributionRow, audiences: Audience[], actor: Actor): Promise<ActionResult> {
  if (d.status !== 'scheduled' && d.status !== 'paused') return { ok: false, status: 409, error: 'Audiences can be changed only before go-live.' }
  const clean = [...new Set(audiences)].filter((a) => a === 'student' || a === 'mentor' || a === 'adult')
  if (!clean.length) return { ok: false, status: 400, error: 'Choose at least one audience.' }
  return patchDistribution(db, d, { audiences: clean }, actor, 'set_audiences', ['scheduled', 'paused'])
}

export async function pauseDistribution(db: SupabaseClient, d: DistributionRow, actor: Actor, now = new Date()): Promise<ActionResult> {
  if (d.status !== 'scheduled') return { ok: false, status: 409, error: 'Only a scheduled survey can be paused.' }
  return patchDistribution(db, d, { status: 'paused', paused_at: now.toISOString() }, actor, 'pause', ['scheduled'])
}

export async function resumeDistribution(db: SupabaseClient, d: DistributionRow, actor: Actor): Promise<ActionResult> {
  if (d.status !== 'paused') return { ok: false, status: 409, error: 'This survey isn’t paused.' }
  return patchDistribution(db, d, { status: 'scheduled', paused_at: null, schedule_flag: d.schedule_flag === 'event_cancelled' ? 'event_cancelled' : d.schedule_flag }, actor, 'resume', ['paused'])
}

export async function closeEarly(db: SupabaseClient, d: DistributionRow, actor: Actor, now = new Date()): Promise<ActionResult> {
  if (d.status === 'closed') return { ok: false, status: 409, error: 'This survey is already closed.' }
  return patchDistribution(db, d, { status: 'closed', closed_at: now.toISOString(), closed_by: actor.label }, actor, 'close_early', ['scheduled', 'open', 'paused'])
}

// ── Opening and closing on the clock ─────────────────────────────────────────

/** Flip due scheduled → open and expired open → closed. Returns the open ones. */
export async function applyClock(db: SupabaseClient, now = new Date()): Promise<{ opened: string[]; closed: string[] }> {
  const iso = now.toISOString()
  const { data: toClose, error: e1 } = await db
    .from('survey_distributions')
    .update({ status: 'closed', closed_at: iso, closed_by: 'system:clock' })
    .in('status', ['open', 'scheduled'])
    .lte('closes_at', iso)
    .select('id')
  if (e1) throw new Error(`Closing surveys failed: ${e1.message}`)
  const { data: toOpen, error: e2 } = await db
    .from('survey_distributions')
    .update({ status: 'open', opened_at: iso })
    .eq('status', 'scheduled')
    .lte('opens_at', iso)
    .select('id')
  if (e2) throw new Error(`Opening surveys failed: ${e2.message}`)
  return { opened: (toOpen ?? []).map((r) => r.id as string), closed: (toClose ?? []).map((r) => r.id as string) }
}

/** Status as a viewer should see it now, without waiting for the cron. */
export function statusNow(d: DistributionRow, now = new Date()) {
  return effectiveStatus(d, now)
}

// ── Invitations ──────────────────────────────────────────────────────────────

/**
 * Create invitations for everyone in the plan who has none yet. Safe to run
 * repeatedly: (distribution_id, recipient_key) is unique, so a late
 * participant is added and nobody is added twice.
 */
export async function materialiseInvitations(db: SupabaseClient, d: DistributionRow, plan: RecipientPlan): Promise<number> {
  const { data: existing, error } = await db.from('survey_invitations').select('recipient_key').eq('distribution_id', d.id)
  if (error) throw new Error(`Reading invitations failed: ${error.message}`)
  const have = new Set((existing ?? []).map((r) => r.recipient_key as string))
  const rows = plan.invitable
    .filter((p) => !have.has(p.recipientKey))
    .map((p) => {
      const id = randomUUID()
      return {
        id,
        distribution_id: d.id,
        recipient_key: p.recipientKey,
        participant_id: p.participantId,
        member_id: p.memberId,
        respondent_role: p.role,
        adult_relationship: p.adultRelationship,
        first_name: p.firstName,
        is_minor: p.isMinor,
        email: p.email,
        send_via: p.sendVia,
        token_hash: hashToken(surveyToken(id, 1)),
        token_version: 1,
        status: 'queued',
      }
    })
  if (!rows.length) return 0
  let created = 0
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error: insErr } = await db
      .from('survey_invitations')
      .upsert(rows.slice(i, i + 200), { onConflict: 'distribution_id,recipient_key', ignoreDuplicates: true })
      .select('id')
    if (insErr) throw new Error(`Creating invitations failed: ${insErr.message}`)
    created += data?.length ?? 0
  }
  return created
}

/** Recipient plan for a distribution (the preview and the go-live job share it). */
export function planFor(db: SupabaseClient, d: DistributionRow): Promise<RecipientPlan> {
  return buildRecipientPlan(db, d.event_slug, d.event_date, d.audiences)
}

/** Definition JSON → version row, publishing it if asked (scripts/survey-definition.ts). */
export async function upsertDefinitionDraft(
  db: SupabaseClient,
  raw: { key: string; version: number; title: string },
  sha256: string,
): Promise<{ id: string; status: string }> {
  const { data: found } = await db.from('survey_definitions').select('id, status, definition_sha256').eq('key', raw.key).eq('version', raw.version).maybeSingle()
  if (found) {
    if (found.status !== 'draft') {
      if (found.definition_sha256 !== sha256) throw new Error(`${raw.key} v${raw.version} is published with different content; bump the version.`)
      return { id: found.id as string, status: found.status as string }
    }
    const { error } = await db.from('survey_definitions').update({ title: raw.title, definition: raw, definition_sha256: sha256 }).eq('id', found.id)
    if (error) throw new Error(error.message)
    return { id: found.id as string, status: 'draft' }
  }
  const { data, error } = await db
    .from('survey_definitions')
    .insert({ key: raw.key, version: raw.version, title: raw.title, definition: raw, definition_sha256: sha256 })
    .select('id, status')
    .single()
  if (error) throw new Error(error.message)
  return { id: data.id as string, status: data.status as string }
}
