// The dev canary tenant's 'flow' seed (S5 wave 7, slice K3; owner decision W7-4).
//
// scripts/seed-two-tenants.ts --profile flow writes a fictitious US tenant,
// 'dev-canary', so the canary runner (K8) can register, consent and check in
// end to end on dev. Unlike the honeytoken profile (lib/testing/two-tenant-seed.ts,
// Canary Academy, never meant to be served), this tenant is meant to work:
//
//   tenants             dev-canary: US/USD, America/Denver, minimum age 14, and
//                       branding.reply_to set to the shared role inbox, so its
//                       mail has a sender (lib/event-emails/tenant-mail.ts) and
//                       every reply lands with staff
//   tenant_domains      canary.<zone> mapped to it; nobody.<zone> left unmapped,
//                       for the "unknown host answers 404" probe (K6)
//   events              one mirror row with a fixed sanity_id and slug, at least
//                       3 weeks out, so the publish in K7b updates it in place
//   Clerk (--clerk)     canary-manager: the event_manager role and an assignment
//                       on the canary event, written after the mirror row exists
//                       and synced through lib/authz/role-sync.ts; canary-admin:
//                       dev-canary's tenant_admin, no Clerk role; stellr-probe-admin:
//                       a Stellr admin, for the cross-tenant probes
//
// --check reads the rows back and prints readiness reasons only: no ids of
// people, no emails, no secrets. --remove tears the tenant down through the
// deletion registry (lib/deletion), scoped by the canary's own id and slug, and
// only once the canary event's Sanity document is gone (a sync would otherwise
// re-create the mirror row under the default tenant).
// Nothing in this file names Stellr's tenant id: a teardown that cannot name it
// cannot delete it.
//
// Pure apart from the functions that take a client: the script does the env,
// Clerk and module loading, and lib/testing/canary-flow-seed.test.ts runs every
// path against an in-memory database. Assignments are read through
// lib/authz/role-sync.ts's loaders, as the role sync itself reads them.
// Synthetic data only: the people are `+clerk_test` addresses on the reserved
// example.test domain, with no password.
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAssignmentTenantId, loadEventAssignees, type RoleSyncResult } from '../authz/role-sync'
import { toEventRow, type EventFetcher, type EventRow } from '../events/sync'
import { localDate } from '../survey/timezone'
import { isInProductionTenantZone } from '../tenancy/host-pure'
import { isAllowedE2eSupabase } from './e2e-supabase-target'
import { assertSeedTarget } from './two-tenant-seed'

/**
 * The organisation's shared role inbox: the fallback of DEFAULT_REPLY_TO and
 * DEV_EMAIL_SAFELIST in lib/email.ts. Owner decision W7-4: every canary mail
 * goes there. A role address, not a person's.
 */
export const CANARY_ROLE_INBOX = 'hello@stellreducation.org'

/** The canary tenant. Its id sits in a block no generator produces, apart from the honeytoken ids. */
export const CANARY_FLOW_TENANT = {
  id: '00000000-0000-4000-8000-00000ca4f10e',
  slug: 'dev-canary',
  legal_name: 'Dev Canary (synthetic test tenant)',
  display_name: 'Dev Canary',
  country: 'US',
  payment_region: 'US',
  currency: 'usd',
  time_zone: 'America/Denver',
  min_participant_age: 14,
} as const

/** The canary event. K7b publishes a Sanity document with this _id and slug into the dev dataset. */
export const CANARY_FLOW_EVENT = {
  slug: 'dev-canary-flow-event',
  sanity_id: 'dev-canary-flow-event',
  title: 'Dev Canary Flow Event',
  // Colorado, so eventTimeZone gives America/Denver, as the published document will.
  state: 'CO',
} as const

/** How far ahead the seeded event starts, and the least --check accepts (the plan's "at least 3 weeks out"). */
export const CANARY_EVENT_LEAD_DAYS = 28
export const CANARY_EVENT_MIN_LEAD_DAYS = 21

/** raw.fixture on the mirror row the seed writes. The K7b publish replaces raw, so a row that still has it is the seed's own. */
export const CANARY_EVENT_FIXTURE = 'canary-flow'

/** Whole days from `now` until `startsAt`; null when there is no start. */
export function daysUntil(startsAt: string | null | undefined, now: Date): number | null {
  if (!startsAt) return null
  const at = Date.parse(startsAt)
  return Number.isNaN(at) ? null : Math.floor((at - now.getTime()) / 86_400_000)
}

/** An assignment lasts until the event's end plus this, like a default grant (lib/event-manager.ts). */
export const CANARY_ASSIGNMENT_GRACE_DAYS = 30

/** event_manager_assignments.granted_by_label for the seeded assignment. */
export const CANARY_SEED_LABEL = 'seed-two-tenants --profile flow'

/** The prefix of every host the flow profile maps, and of the probe host it leaves unmapped. */
export const CANARY_HOST_LABEL = 'canary'
export const CANARY_PROBE_HOST_LABEL = 'nobody'

export type CanaryPersonaHandle = 'canary-manager' | 'canary-admin' | 'stellr-probe-admin'

export interface CanaryPersona {
  handle: CanaryPersonaHandle
  email: string
  firstName: string
  lastName: string
  /** public_metadata.role in Clerk. null clears it: the persona holds no Clerk role. */
  clerkRole: 'event_manager' | 'admin' | null
  /** What the seed grants once Clerk has given the persona an id. */
  grant: 'canary_event_manager' | 'canary_tenant_admin' | 'stellr_tenant_admin'
}

export const CANARY_PERSONAS: readonly CanaryPersona[] = [
  {
    handle: 'canary-manager',
    email: 'canary-manager+clerk_test@example.test',
    firstName: 'Canary',
    lastName: 'Manager',
    clerkRole: 'event_manager',
    grant: 'canary_event_manager',
  },
  {
    handle: 'canary-admin',
    email: 'canary-admin+clerk_test@example.test',
    firstName: 'Canary',
    lastName: 'Admin',
    clerkRole: null,
    grant: 'canary_tenant_admin',
  },
  {
    handle: 'stellr-probe-admin',
    email: 'stellr-probe-admin+clerk_test@example.test',
    firstName: 'Probe',
    lastName: 'StellrAdmin',
    clerkRole: 'admin',
    grant: 'stellr_tenant_admin',
  },
]

// ── The tenants CHECKs (supabase/migrations/20261104100000_tenancy_core.sql) ──

/** tenants.slug CHECK. */
export const TENANT_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
/** tenants.time_zone CHECK (or 'UTC'). */
export const TENANT_TIME_ZONE_RE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/
/** tenant_domains.host CHECK (and host = lower(host)). */
export const TENANT_HOST_RE = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/

const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** Every tenants CHECK a row would fail, as readable reasons. Empty when it passes them all. */
export function tenantRowProblems(row: Record<string, unknown>): string[] {
  const out: string[] = []
  const str = (k: string) => (typeof row[k] === 'string' ? (row[k] as string) : null)
  const slug = str('slug')
  if (!slug || !TENANT_SLUG_RE.test(slug)) out.push('slug fails its CHECK')
  const legal = str('legal_name')
  if (!legal || legal.length < 1 || legal.length > 200) out.push('legal_name must be 1 to 200 characters')
  const display = str('display_name')
  if (!display || display.length < 1 || display.length > 120) out.push('display_name must be 1 to 120 characters')
  if (!['US', 'AU'].includes(str('country') ?? '')) out.push("country must be 'US' or 'AU'")
  const region = str('payment_region')
  const currency = str('currency')
  if (!['US', 'AU'].includes(region ?? '')) out.push("payment_region must be 'US' or 'AU'")
  if (!['usd', 'aud'].includes(currency ?? '')) out.push("currency must be 'usd' or 'aud'")
  if (!((region === 'US' && currency === 'usd') || (region === 'AU' && currency === 'aud'))) out.push('payment_region and currency disagree')
  if (row.ein != null && !/^[0-9]{2}-[0-9]{7}$/.test(String(row.ein))) out.push('ein fails its CHECK')
  if (row.abn != null && !/^[0-9]{11}$/.test(String(row.abn))) out.push('abn fails its CHECK')
  const branding = row.branding
  if (branding !== undefined && (branding === null || typeof branding !== 'object' || Array.isArray(branding))) out.push('branding must be a JSON object')
  const tz = str('time_zone')
  if (!tz || !(tz === 'UTC' || TENANT_TIME_ZONE_RE.test(tz))) out.push('time_zone fails its CHECK')
  const min = row.min_participant_age
  const owner = row.is_platform_owner === true
  if (typeof min !== 'number' || !Number.isInteger(min) || min < 0 || (min < 14 && !owner)) {
    out.push('min_participant_age must be 14 or more for a tenant that is not the platform owner')
  }
  if (!['provisioning', 'active', 'suspended', 'archived'].includes(str('status') ?? 'active')) out.push('status fails its CHECK')
  return out
}

// ── Target guards ───────────────────────────────────────────────────────────

export interface FlowTargetEnv {
  supabaseUrl?: string
  clerkSecretKey?: string
  /** --clerk: the seed writes Clerk users. */
  useClerk: boolean
  appEnv?: string
  publicAppEnv?: string
  vercelEnv?: string
}

export function flowTargetEnvFrom(env: Record<string, string | undefined>, useClerk: boolean): FlowTargetEnv {
  return {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    clerkSecretKey: env.CLERK_SECRET_KEY,
    useClerk,
    appEnv: env.APP_ENV,
    publicAppEnv: env.NEXT_PUBLIC_APP_ENV,
    vercelEnv: env.VERCEL_ENV,
  }
}

const REFUSED_APP_ENVS = ['prod', 'production', 'preview']

/**
 * The honeytoken profile's guard (assertSeedTarget: never the production
 * project, never a live Clerk key with --clerk), and more, because this profile
 * writes rows meant to be served: a live Clerk key is refused even without
 * --clerk, APP_ENV prod or preview is refused, and the database must be the dev
 * project or a stack on this machine (an allowlist, so production is refused
 * because it is not listed). No override flag.
 */
export function assertCanaryFlowTarget(env: FlowTargetEnv): void {
  assertSeedTarget({ supabaseUrl: env.supabaseUrl, clerkSecretKey: env.clerkSecretKey, useClerk: env.useClerk })
  if ((env.clerkSecretKey ?? '').trim().startsWith('sk_live_')) {
    throw new Error('refusing: CLERK_SECRET_KEY is a production (sk_live_) key')
  }
  for (const [name, value] of [
    ['APP_ENV', env.appEnv],
    ['NEXT_PUBLIC_APP_ENV', env.publicAppEnv],
  ] as const) {
    const v = (value ?? '').trim().toLowerCase()
    if (REFUSED_APP_ENVS.includes(v)) throw new Error(`refusing: ${name} is ${v}; the flow profile runs on dev only`)
  }
  if ((env.vercelEnv ?? '').trim().toLowerCase() === 'preview') {
    throw new Error('refusing: VERCEL_ENV is preview; the flow profile runs on dev only')
  }
  if (!isAllowedE2eSupabase(env.supabaseUrl)) {
    throw new Error('refusing: the flow profile writes only to the dev Supabase project or a stack on this machine')
  }
}

// ── The plan ────────────────────────────────────────────────────────────────

/** A DNS zone the canary hosts can sit under, lower-cased. Throws when it is missing or not a hostname. */
export function normaliseZone(raw: string | undefined | null): string {
  const zone = (raw ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '')
  if (!zone) throw new Error('--zone is required for the flow profile (for example --zone localhost for a local run)')
  if (!zone.split('.').every((label) => DNS_LABEL_RE.test(label))) throw new Error('--zone must be a DNS name: letters, digits, hyphens and dots')
  // W7-27: the canary never maps a host in the production tenant zone, its apex included.
  if (isInProductionTenantZone(zone)) throw new Error('refusing: --zone is in the production tenant zone (W7-27); use a dev zone such as devzone.stellreducation.org or localhost')
  for (const label of [CANARY_HOST_LABEL, CANARY_PROBE_HOST_LABEL]) {
    const host = `${label}.${zone}`
    if (host.length > 253 || !TENANT_HOST_RE.test(host)) throw new Error('--zone is too long for a tenant host')
  }
  return zone
}

export function canaryHosts(zone: string): { mapped: string; unmapped: string } {
  const z = normaliseZone(zone)
  return { mapped: `${CANARY_HOST_LABEL}.${z}`, unmapped: `${CANARY_PROBE_HOST_LABEL}.${z}` }
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * The mirror row, built by the same toEventRow the event webhook uses, from the
 * document K7b will publish: a two-day live event in Colorado, starting
 * CANARY_EVENT_LEAD_DAYS after `now` (Denver's date). Its minimum age is set,
 * which the sync keeps for a tenant's row (K4).
 */
export function canaryEventRow(now: Date): EventRow {
  const first = addDays(localDate(now, CANARY_FLOW_TENANT.time_zone), CANARY_EVENT_LEAD_DAYS)
  const row = toEventRow(
    {
      _id: CANARY_FLOW_EVENT.sanity_id,
      slug: CANARY_FLOW_EVENT.slug,
      title: CANARY_FLOW_EVENT.title,
      activityType: 'live_event',
      date: first,
      endDate: addDays(first, 1),
      state: CANARY_FLOW_EVENT.state,
      country: 'US',
      status: 'scheduled',
    },
    { tenantId: CANARY_FLOW_TENANT.id, currency: CANARY_FLOW_TENANT.currency },
    now,
  )
  if (!row) throw new Error('canary event row could not be built')
  return { ...row, min_participant_age: CANARY_FLOW_TENANT.min_participant_age, raw: { ...row.raw, fixture: CANARY_EVENT_FIXTURE } }
}

export interface CanaryFlowPlan {
  tenant: Record<string, unknown>
  tenantDomains: { host: string; tenant_id: string; is_primary: boolean }[]
  /** Must have no tenant_domains row. */
  unmappedHost: string
  event: EventRow
  personas: readonly CanaryPersona[]
}

export function planCanaryFlowSeed(opts: { zone: string; now?: Date }): CanaryFlowPlan {
  const hosts = canaryHosts(opts.zone)
  const t = CANARY_FLOW_TENANT
  return {
    tenant: {
      id: t.id,
      slug: t.slug,
      legal_name: t.legal_name,
      display_name: t.display_name,
      country: t.country,
      payment_region: t.payment_region,
      currency: t.currency,
      ein: null,
      abn: null,
      gst_registered: false,
      time_zone: t.time_zone,
      is_platform_owner: false,
      min_participant_age: t.min_participant_age,
      status: 'active',
      branding: { reply_to: CANARY_ROLE_INBOX, note: 'dev canary tenant: synthetic data only (S5 wave 7)' },
    },
    tenantDomains: [{ host: hosts.mapped, tenant_id: t.id, is_primary: true }],
    unmappedHost: hosts.unmapped,
    event: canaryEventRow(opts.now ?? new Date()),
    personas: CANARY_PERSONAS,
  }
}

/** public_metadata for a persona. `role: null` removes a role a merge would otherwise keep. */
export function canaryClerkMetadata(p: CanaryPersona): Record<string, unknown> {
  return { fixture: 'canary-flow', role: p.clerkRole }
}

/** The Clerk Backend API body for a persona (POST /v1/users). No password: sign in with a testing token. */
export function canaryClerkCreateUserBody(p: CanaryPersona): Record<string, unknown> {
  return {
    email_address: [p.email],
    first_name: p.firstName,
    last_name: p.lastName,
    skip_password_requirement: true,
    public_metadata: p.clerkRole ? { fixture: 'canary-flow', role: p.clerkRole } : { fixture: 'canary-flow' },
  }
}

/** What a dry run prints: hosts, slugs and handles. No emails. */
export function describeCanaryFlowPlan(plan: CanaryFlowPlan): string[] {
  return [
    `  tenant:         ${String(plan.tenant.slug)} (${String(plan.tenant.country)}/${String(plan.tenant.currency).toUpperCase()}, ${String(plan.tenant.time_zone)}, minimum age ${String(plan.tenant.min_participant_age)})`,
    `  tenant_domains: ${plan.tenantDomains.map((d) => d.host).join(', ')} (left unmapped: ${plan.unmappedHost})`,
    `  events:         ${plan.event.slug}, starts ${plan.event.starts_at?.slice(0, 10) ?? '-'}`,
    `  personas:       ${plan.personas.map((p) => p.handle).join(', ')}`,
  ]
}

// ── Database errors ─────────────────────────────────────────────────────────

interface DbError {
  code?: string
  message?: string
}

/** Fails with the table and step only: a database message can echo values. */
function check(step: string, error: DbError | null | undefined): void {
  if (error) throw new Error(`${step} failed${error.code ? ` (${error.code})` : ''}`)
}

function isForeignKeyRefusal(error: DbError): boolean {
  return error.code === '23503' || /foreign key/i.test(error.message ?? '')
}

function requireSynced(what: string, result: RoleSyncResult): void {
  if (!result.ok) throw new Error(`role sync for ${what} failed at ${result.step} (${result.code})`)
}

// ── --apply ─────────────────────────────────────────────────────────────────

export interface ApplyDeps {
  db: SupabaseClient
  /** With --clerk: the persona's Clerk user id, created if missing, with canaryClerkMetadata set. */
  ensureClerkUser?: (persona: CanaryPersona) => Promise<string>
  /** lib/authz/role-sync.ts. */
  syncEventManagerAssigned: (db: SupabaseClient, clerkUserId: string, eventSlug: string, authorisedTenantId: string) => Promise<RoleSyncResult>
  syncTenantAdminGranted: (db: SupabaseClient, clerkUserId: string) => Promise<RoleSyncResult>
  log: (line: string) => void
}

/**
 * Writes the plan. Idempotent: the tenant row is upserted on its id; a host or
 * the mirror row is inserted when missing and kept when it already belongs to
 * dev-canary (so a re-run after K7b leaves the published event alone). The
 * seed's own mirror row (raw.fixture still CANARY_EVENT_FIXTURE) is moved to the
 * plan's dates when it starts fewer than CANARY_EVENT_MIN_LEAD_DAYS out, so a
 * re-run keeps it at least 3 weeks away; a published row is left for a
 * republish, and --check reports it. Refuses, before writing anything it would
 * move, a tenant row under the canary id that is not dev-canary, a slug, host or
 * event that belongs to another tenant, and a probe host that is mapped.
 */
export async function applyCanaryFlowSeed(plan: CanaryFlowPlan, deps: ApplyDeps): Promise<void> {
  const { db, log } = deps
  const tenantId = String(plan.tenant.id)
  const problems = tenantRowProblems(plan.tenant)
  if (problems.length) throw new Error(`the canary tenant row fails the tenants CHECKs: ${problems.join('; ')}`)

  // Refuse everything that would take something from another tenant, before any write.
  const idOwner = await db.from('tenants').select('id, slug, is_platform_owner').eq('id', tenantId).maybeSingle()
  check('tenants read', idOwner.error)
  const idRow = idOwner.data as { slug: string; is_platform_owner: boolean } | null
  if (idRow && (idRow.is_platform_owner || idRow.slug !== plan.tenant.slug)) throw new Error('refusing: the row under the canary id is not dev-canary')

  const slugOwner = await db.from('tenants').select('id').eq('slug', String(plan.tenant.slug)).maybeSingle()
  check('tenants read', slugOwner.error)
  if (slugOwner.data && (slugOwner.data as { id: string }).id !== tenantId) throw new Error(`the slug ${String(plan.tenant.slug)} belongs to another tenant`)

  const hostNames = [...plan.tenantDomains.map((d) => d.host), plan.unmappedHost]
  const hostRows = await db.from('tenant_domains').select('host, tenant_id').in('host', hostNames)
  check('tenant_domains read', hostRows.error)
  const mapped = new Map(((hostRows.data ?? []) as { host: string; tenant_id: string }[]).map((r) => [r.host, r.tenant_id]))
  if (mapped.has(plan.unmappedHost)) throw new Error(`${plan.unmappedHost} is mapped; the probe host must stay unmapped`)
  for (const d of plan.tenantDomains) {
    if (mapped.has(d.host) && mapped.get(d.host) !== tenantId) throw new Error(`${d.host} is mapped to another tenant`)
  }

  const eventRows = await db.from('events').select('slug, sanity_id, tenant_id, starts_at, ends_at, raw').in('slug', [plan.event.slug])
  check('events read', eventRows.error)
  const bySanity = await db.from('events').select('slug, sanity_id, tenant_id, starts_at, ends_at, raw').in('sanity_id', [plan.event.sanity_id])
  check('events read', bySanity.error)
  const existingEvents = [...((eventRows.data ?? []) as EventFacts[]), ...((bySanity.data ?? []) as EventFacts[])]
  if (existingEvents.some((e) => e.tenant_id !== tenantId)) throw new Error(`the event ${plan.event.slug} belongs to another tenant`)
  const kept = existingEvents.find((e) => e.slug === plan.event.slug && e.sanity_id === plan.event.sanity_id)
  if (existingEvents.length && !kept) throw new Error('the event slug or sanity_id is already used by a different dev-canary row')

  // Writes.
  const tenant = await db.from('tenants').upsert(plan.tenant, { onConflict: 'id' })
  check('tenants upsert', tenant.error)
  log(`  ✓ tenants: ${String(plan.tenant.slug)}`)

  for (const d of plan.tenantDomains) {
    if (mapped.has(d.host)) {
      log(`  ✓ tenant_domains: ${d.host} (kept)`)
      continue
    }
    const ins = await db.from('tenant_domains').insert(d)
    check('tenant_domains insert', ins.error)
    log(`  ✓ tenant_domains: ${d.host}`)
  }
  log(`  ✓ left unmapped: ${plan.unmappedHost}`)

  let eventEnd = plan.event.ends_at
  // The plan's own clock: canaryEventRow stamps synced_at with it.
  const days = kept ? daysUntil(kept.starts_at, new Date(plan.event.synced_at)) : null
  const tooSoon = days === null || days < CANARY_EVENT_MIN_LEAD_DAYS
  if (kept && tooSoon && isSeedEventRow(kept)) {
    const move = await db
      .from('events')
      .update({ starts_at: plan.event.starts_at, ends_at: plan.event.ends_at, raw: plan.event.raw, synced_at: plan.event.synced_at })
      .eq('slug', plan.event.slug)
      .eq('sanity_id', plan.event.sanity_id)
      .eq('tenant_id', tenantId)
    check('events update', move.error)
    log(`  ✓ events: ${plan.event.slug} (kept, moved to start ${plan.event.starts_at?.slice(0, 10) ?? '-'})`)
  } else if (kept) {
    eventEnd = kept.ends_at ?? eventEnd
    log(`  ✓ events: ${plan.event.slug} (kept)`)
    if (tooSoon) log(`  ! events: the published event starts fewer than ${CANARY_EVENT_MIN_LEAD_DAYS} days out; republish it with a later date`)
  } else {
    const ins = await db.from('events').insert(plan.event)
    check('events insert', ins.error)
    log(`  ✓ events: ${plan.event.slug}`)
  }

  if (!deps.ensureClerkUser) {
    log(`  personas:       skipped (pass --clerk)`)
    return
  }

  for (const persona of plan.personas) {
    const clerkUserId = await deps.ensureClerkUser(persona)
    if (persona.grant === 'canary_tenant_admin') {
      const existing = await db.from('tenant_memberships').select('id').eq('tenant_id', tenantId).eq('clerk_user_id', clerkUserId).eq('role', 'tenant_admin').limit(1)
      check('tenant_memberships read', existing.error)
      if (!(existing.data ?? []).length) {
        const ins = await db.from('tenant_memberships').insert({ tenant_id: tenantId, clerk_user_id: clerkUserId, role: 'tenant_admin', source: 'admin' })
        check('tenant_memberships insert', ins.error)
      }
    } else if (persona.grant === 'canary_event_manager') {
      // The mirror row exists by now, so the derivation trigger stamps the
      // assignment with dev-canary. tenant_id is read back, not supplied.
      const expires = eventEnd ? new Date(Date.parse(eventEnd) + CANARY_ASSIGNMENT_GRACE_DAYS * 86_400_000).toISOString() : null
      const up = await db.from('event_manager_assignments').upsert(
        { clerk_user_id: clerkUserId, event_slug: plan.event.slug, expires_at: expires, granted_by_label: CANARY_SEED_LABEL, updated_at: new Date().toISOString() },
        { onConflict: 'clerk_user_id,event_slug' },
      )
      check('event_manager_assignments upsert', up.error)
      if ((await loadAssignmentTenantId(db, clerkUserId, plan.event.slug)) !== tenantId) {
        throw new Error('the assignment was not stamped with dev-canary (or could not be read back); is the mirror row present?')
      }
      requireSynced(persona.handle, await deps.syncEventManagerAssigned(db, clerkUserId, plan.event.slug, tenantId))
    } else {
      requireSynced(persona.handle, await deps.syncTenantAdminGranted(db, clerkUserId))
    }
    log(`  ✓ persona ${persona.handle}`)
  }
}

interface EventFacts {
  slug: string
  sanity_id: string
  tenant_id: string
  starts_at: string | null
  ends_at: string | null
  raw: unknown
}

function isSeedEventRow(e: EventFacts): boolean {
  return typeof e.raw === 'object' && e.raw !== null && (e.raw as Record<string, unknown>).fixture === CANARY_EVENT_FIXTURE
}

// ── --check ─────────────────────────────────────────────────────────────────

export interface CanaryFacts {
  tenant: {
    slug: string
    status: string
    display_name: string | null
    branding: unknown
    is_platform_owner: boolean
    min_participant_age: number
    country: string
    currency: string
    time_zone: string
  } | null
  hosts: { host: string; tenant_id: string }[]
  event: { tenant_id: string; starts_at: string | null; min_participant_age: number | null } | null
  membershipRoles: string[]
  assignments: number
}

/** The rows --check judges. Read-only; throws on a failed read, so a failure never reads as "not seeded". */
export async function readCanaryFacts(db: SupabaseClient, plan: CanaryFlowPlan): Promise<CanaryFacts> {
  const tenantId = String(plan.tenant.id)
  const [tenant, hosts, event, memberships, assignees] = await Promise.all([
    db.from('tenants').select('slug, status, display_name, branding, is_platform_owner, min_participant_age, country, currency, time_zone').eq('id', tenantId).maybeSingle(),
    db.from('tenant_domains').select('host, tenant_id').in('host', [...plan.tenantDomains.map((d) => d.host), plan.unmappedHost]),
    db.from('events').select('tenant_id, starts_at, min_participant_age').eq('slug', plan.event.slug).maybeSingle(),
    db.from('tenant_memberships').select('role').eq('tenant_id', tenantId),
    loadEventAssignees(db, plan.event.slug),
  ])
  check('tenants read', tenant.error)
  check('tenant_domains read', hosts.error)
  check('events read', event.error)
  check('tenant_memberships read', memberships.error)
  if (assignees === null) throw new Error('event_manager_assignments read failed')
  return {
    tenant: (tenant.data as CanaryFacts['tenant']) ?? null,
    hosts: (hosts.data ?? []) as CanaryFacts['hosts'],
    event: (event.data as CanaryFacts['event']) ?? null,
    membershipRoles: ((memberships.data ?? []) as { role: string }[]).map((m) => m.role),
    assignments: assignees.filter((a) => a.tenantId === tenantId).length,
  }
}

export interface ReadinessLine {
  ok: boolean
  what: 'tenant' | 'sender' | 'host map' | 'probe host' | 'mirror row' | 'roles'
  reason: string
}

/**
 * Readiness reasons, one per thing the canary needs. Says why, never who: no
 * emails (the reply-to is compared, not printed), no ids, no secrets.
 * `senderOf` is tenantEventSender from lib/event-emails/tenant-mail.ts.
 */
export function canaryReadiness(
  plan: CanaryFlowPlan,
  facts: CanaryFacts,
  opts: { senderOf: (t: { display_name: string | null; branding: unknown }) => { replyTo: string } | null; now?: Date },
): ReadinessLine[] {
  const tenantId = String(plan.tenant.id)
  const now = opts.now ?? new Date()
  const lines: ReadinessLine[] = []
  const t = facts.tenant

  if (!t) lines.push({ ok: false, what: 'tenant', reason: 'no dev-canary row; run --apply' })
  else if (t.is_platform_owner || t.slug !== plan.tenant.slug) lines.push({ ok: false, what: 'tenant', reason: 'the row under the canary id is not dev-canary' })
  else if (t.status !== 'active') lines.push({ ok: false, what: 'tenant', reason: `status is ${t.status}, not active` })
  else if (t.min_participant_age < 14) lines.push({ ok: false, what: 'tenant', reason: 'minimum age is below 14' })
  else lines.push({ ok: true, what: 'tenant', reason: `active, ${t.country}/${t.currency.toUpperCase()}, ${t.time_zone}, minimum age ${t.min_participant_age}` })

  const sender = t ? opts.senderOf({ display_name: t.display_name, branding: t.branding }) : null
  if (!t) lines.push({ ok: false, what: 'sender', reason: 'no tenant row' })
  else if (!sender) lines.push({ ok: false, what: 'sender', reason: 'no usable sender: tenants.branding.reply_to is missing or not an address' })
  else if (sender.replyTo.toLowerCase() !== CANARY_ROLE_INBOX) lines.push({ ok: false, what: 'sender', reason: 'reply-to is not the shared role inbox' })
  else lines.push({ ok: true, what: 'sender', reason: '"<display name> via Stellr", replies go to the shared role inbox' })

  for (const d of plan.tenantDomains) {
    const owner = facts.hosts.find((h) => h.host === d.host)?.tenant_id
    if (!owner) lines.push({ ok: false, what: 'host map', reason: `${d.host} is not mapped` })
    else if (owner !== tenantId) lines.push({ ok: false, what: 'host map', reason: `${d.host} is mapped to another tenant` })
    else lines.push({ ok: true, what: 'host map', reason: `${d.host} maps to dev-canary` })
  }
  const probe = facts.hosts.some((h) => h.host === plan.unmappedHost)
  lines.push(probe ? { ok: false, what: 'probe host', reason: `${plan.unmappedHost} is mapped; it must stay unmapped` } : { ok: true, what: 'probe host', reason: `${plan.unmappedHost} is unmapped` })

  const e = facts.event
  if (!e) lines.push({ ok: false, what: 'mirror row', reason: `no events row for ${plan.event.slug}; run --apply` })
  else if (e.tenant_id !== tenantId) lines.push({ ok: false, what: 'mirror row', reason: `${plan.event.slug} belongs to another tenant` })
  else if (e.min_participant_age !== null && e.min_participant_age < 14) lines.push({ ok: false, what: 'mirror row', reason: 'its minimum age is below 14' })
  else {
    const days = daysUntil(e.starts_at, now)
    if (days === null || days < 0) lines.push({ ok: false, what: 'mirror row', reason: 'the event has no start date or has started' })
    else if (days < CANARY_EVENT_MIN_LEAD_DAYS) {
      lines.push({
        ok: false,
        what: 'mirror row',
        reason: `starts in ${days} days; fewer than ${CANARY_EVENT_MIN_LEAD_DAYS}. Re-run --apply (before the publish) or republish it with a later date`,
      })
    } else lines.push({ ok: true, what: 'mirror row', reason: `${plan.event.slug} is dev-canary's, starts in ${days} days` })
  }

  const missing = [
    facts.assignments > 0 ? null : 'a manager assignment',
    facts.membershipRoles.includes('event_manager') ? null : 'an event_manager membership',
    facts.membershipRoles.includes('tenant_admin') ? null : 'a tenant_admin membership',
  ].filter((m): m is string => m !== null)
  lines.push(missing.length ? { ok: false, what: 'roles', reason: `missing ${missing.join(', ')}; run --apply --clerk` } : { ok: true, what: 'roles', reason: 'manager assignment and dev-canary memberships present' })
  return lines
}

export function formatReadiness(lines: ReadinessLine[]): string[] {
  return lines.map((l) => `  ${(l.ok ? 'READY' : 'NOT READY').padEnd(9)}  ${l.what.padEnd(10)}  ${l.reason}`)
}

// ── --remove ────────────────────────────────────────────────────────────────

/** What --remove does, in order. A dry run prints this. */
export const CANARY_REMOVAL_STEPS: readonly string[] = [
  "refuse while the canary event's Sanity document is published, or Sanity cannot be read (a sync would re-create the mirror row under the default tenant)",
  'refuse unless the row under the canary id is dev-canary and not the platform owner',
  "ask the deletion registry what blocks deleting the canary event; stop if anything does (registrations and participation records go through the app's deletion tool first)",
  "refuse unless every row the registry's 'event' entity would delete is stamped with dev-canary",
  "snapshot those rows to deletion_archive, as a registry hard delete does",
  "delete them (event settings, companies, manager assignments), then sync each manager's dev-canary membership away (role-sync)",
  "delete the canary event's mirror row, and dev-canary's memberships and host mappings",
  'with --clerk: delete the canary-manager and canary-admin Clerk users (stellr-probe-admin is left)',
  'delete the tenant row, or archive it when kept rows (audit rows) still name it',
]

/** The parts of a deletion registry entity (lib/deletion/types.ts EntityDef) the teardown follows. */
export interface RegistryEntity {
  type: string
  table: string
  pk: string
  spans?: { table: string; column: string }[]
}

export interface RemoveDeps {
  db: SupabaseClient
  /** Whether the canary event's document is published in Sanity: canaryEventInSanity. A throw counts as published. */
  sanityEventPublished: () => Promise<boolean>
  /** lib/deletion/registry.ts getEntityDef('event'). */
  eventEntity: RegistryEntity
  /** lib/deletion/preflight.ts. */
  deletionPreflight: (entity: string, id: string) => Promise<{ canDelete: boolean; blockers: { table: string; count: number }[] }>
  /** lib/deletion/archive.ts archiveEntity: the snapshot a registry hard delete keeps. Best-effort. */
  archive: (def: RegistryEntity, id: string, deletedBy: null) => Promise<void>
  /** lib/authz/role-sync.ts. */
  syncEventManagerUnassigned: (
    db: SupabaseClient,
    clerkUserId: string,
    eventSlug: string,
    authorisedTenantId: string,
    assignmentTenantId: string | null,
  ) => Promise<RoleSyncResult>
  /** With --clerk: deletes the persona's Clerk user if it exists. */
  deleteClerkUser?: (persona: CanaryPersona) => Promise<'deleted' | 'absent'>
  log: (line: string) => void
}

/** NEXT_PUBLIC_SANITY_PROJECT_ID names a project (lib/sanity.ts treats 'placeholder' as none). */
export function sanityProjectConfigured(projectId: string | undefined): boolean {
  return Boolean(projectId && projectId !== 'placeholder')
}

/**
 * RemoveDeps.sanityEventPublished for the script: the canary document, looked up
 * by its _id and by its slug through the mirror's own fetcher. Throws, so the
 * teardown refuses, when no Sanity project is configured: an unconfigured client
 * reads every document as absent.
 */
export async function canaryEventInSanity(fetcher: EventFetcher, configured: boolean): Promise<boolean> {
  if (!configured) throw new Error('no Sanity project is configured')
  const [byId, bySlug] = await Promise.all([fetcher({ sanityId: CANARY_FLOW_EVENT.sanity_id }), fetcher({ slug: CANARY_FLOW_EVENT.slug })])
  return Boolean(byId || bySlug)
}

export interface RemoveResult {
  tenant: 'deleted' | 'archived' | 'absent'
}

/**
 * Tears the canary down, scoped by dev-canary's own id and slug throughout, and
 * following the deletion registry's 'event' entity: its preflight decides what
 * blocks, and its spans and primary table are what goes, after the snapshot.
 *
 * executeDeletion itself loads only inside the app (it voids envelopes and
 * keeps signed records), so a canary event that still has registrations or
 * participation records stops here: those are removed through the app's
 * deletion tool first, and --remove re-run. Every row about to be deleted is
 * checked to be dev-canary's first, and one that is not stops the teardown
 * before anything is deleted. The tenant row goes last; when rows that are kept
 * still name it (the platform audit chain, owner decision W7-4) it is archived
 * instead, with no host mapped, so nothing can be served from it.
 */
export async function removeCanaryFlow(deps: RemoveDeps): Promise<RemoveResult> {
  const { db, log } = deps
  const tenantId = CANARY_FLOW_TENANT.id
  const slug = CANARY_FLOW_EVENT.slug
  const def = deps.eventEntity

  // First: while the document exists, the event webhook or the mirror backfill
  // re-creates a deleted mirror row as a NEW row, which gets the default tenant.
  let published: boolean
  try {
    published = await deps.sanityEventPublished()
  } catch {
    throw new Error("refusing: Sanity could not be read, so the canary event's document may still exist; nothing was deleted")
  }
  if (published) {
    throw new Error(
      `refusing: the ${CANARY_FLOW_EVENT.sanity_id} event document is still published in Sanity. Unpublish and delete it (and any draft) in the dev dataset first, then re-run; nothing was deleted`,
    )
  }

  const tenant = await db.from('tenants').select('id, slug, is_platform_owner').eq('id', tenantId).maybeSingle()
  check('tenants read', tenant.error)
  const row = tenant.data as { slug: string; is_platform_owner: boolean } | null
  if (row && (row.is_platform_owner || row.slug !== CANARY_FLOW_TENANT.slug)) throw new Error('refusing: the row under the canary id is not dev-canary')

  const pre = await deps.deletionPreflight(def.type, slug)
  if (!pre.canDelete) {
    const what = pre.blockers.map((b) => `${b.table} ${b.count}`).join(', ')
    throw new Error(`the deletion registry finds rows on ${slug} (${what}); remove them through the app's deletion tool, then re-run`)
  }

  // Every row the entity would delete, read before anything changes.
  const targets = [...(def.spans ?? []), { table: def.table, column: def.pk }].filter(
    (t, i, all) => all.findIndex((o) => o.table === t.table && o.column === t.column) === i,
  )
  for (const t of targets) {
    const rows = await db.from(t.table).select('tenant_id').eq(t.column, slug)
    check(`${t.table} read`, rows.error)
    if (((rows.data ?? []) as { tenant_id: string | null }[]).some((r) => r.tenant_id !== tenantId)) {
      throw new Error(`refusing: a ${t.table} row on ${slug} is not stamped with dev-canary; nothing was deleted`)
    }
  }
  const assignees = await loadEventAssignees(db, slug)
  if (assignees === null) throw new Error('event_manager_assignments read failed')

  await deps.archive(def, slug, null)
  for (const t of targets) {
    const del = await db.from(t.table).delete().eq(t.column, slug).eq('tenant_id', tenantId)
    check(`${t.table} delete`, del.error)
  }
  // As an unassign does (lib/event-manager.ts): the row has gone, and the
  // membership follows under dev-canary's own authority.
  for (const clerkUserId of new Set(assignees.map((a) => a.clerkUserId))) {
    requireSynced('a canary manager', await deps.syncEventManagerUnassigned(db, clerkUserId, slug, tenantId, tenantId))
  }
  log(`  ✓ event rows (deletion registry '${def.type}'): ${slug}, ${assignees.length} manager assignment(s)`)

  const ev = await db.from('events').delete().eq('slug', slug).eq('tenant_id', tenantId)
  check('events delete', ev.error)
  log(`  ✓ events mirror row: ${slug}`)

  const mem = await db.from('tenant_memberships').delete().eq('tenant_id', tenantId)
  check('tenant_memberships delete', mem.error)
  const dom = await db.from('tenant_domains').delete().eq('tenant_id', tenantId)
  check('tenant_domains delete', dom.error)
  log('  ✓ dev-canary memberships and host mappings')

  if (deps.deleteClerkUser) {
    for (const p of CANARY_PERSONAS) {
      if (p.grant === 'stellr_tenant_admin') {
        log(`  - ${p.handle}: left (a Stellr persona; remove with scripts/set-admin.ts --revoke)`)
        continue
      }
      log(`  ✓ clerk user ${p.handle}: ${await deps.deleteClerkUser(p)}`)
    }
  }

  if (!row) {
    log('  - tenants: no dev-canary row')
    return { tenant: 'absent' }
  }
  const delTenant = await db.from('tenants').delete().eq('id', tenantId)
  if (!delTenant.error) {
    log('  ✓ tenants: dev-canary deleted')
    return { tenant: 'deleted' }
  }
  if (!isForeignKeyRefusal(delTenant.error)) check('tenants delete', delTenant.error)
  const arch = await db.from('tenants').update({ status: 'archived' }).eq('id', tenantId)
  check('tenants archive', arch.error)
  log('  ✓ tenants: dev-canary archived (rows that are kept, such as audit rows, still name it)')
  return { tenant: 'archived' }
}
