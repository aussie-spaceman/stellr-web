// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  applyCanaryFlowSeed,
  assertCanaryFlowTarget,
  canaryClerkCreateUserBody,
  canaryClerkMetadata,
  canaryHosts,
  canaryReadiness,
  CANARY_EVENT_MIN_LEAD_DAYS,
  CANARY_FLOW_EVENT,
  CANARY_FLOW_TENANT,
  CANARY_PERSONAS,
  CANARY_REMOVAL_STEPS,
  CANARY_ROLE_INBOX,
  describeCanaryFlowPlan,
  formatReadiness,
  normaliseZone,
  planCanaryFlowSeed,
  readCanaryFacts,
  removeCanaryFlow,
  TENANT_HOST_RE,
  TENANT_SLUG_RE,
  TENANT_TIME_ZONE_RE,
  tenantRowProblems,
  type ApplyDeps,
  type CanaryFlowPlan,
  type RemoveDeps,
} from './canary-flow-seed'
import { CANARY_TENANT, HONEYTOKEN_VALUES, isCanaryId } from './honeytokens'
import { PRODUCTION_SUPABASE_REF, planTwoTenantSeed } from './two-tenant-seed'
import { DEV_SUPABASE_REF } from './e2e-supabase-target'
import { STELLR_TENANT_ID } from '../tenancy/constants'
import { tenantEventSender } from '../event-emails/tenant-mail'
import { syncEventManagerAssigned, syncEventManagerUnassigned, syncTenantAdminGranted } from '../authz/role-sync'
import { getEntityDef } from '../deletion/registry'
import { fakeSupabase, type FakeDb } from '../../test/fake-supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

const NOW = new Date('2026-11-19T17:00:00.000Z')
const ZONE = 'canary-zone.example.test'
const DEV_URL = `https://${DEV_SUPABASE_REF}.supabase.co`
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/

const plan = () => planCanaryFlowSeed({ zone: ZONE, now: NOW })
const MIGRATION = readFileSync('supabase/migrations/20261104100000_tenancy_core.sql', 'utf8')

describe('honeytoken profile', () => {
  it('its plan is byte-identical to the committed fixture', () => {
    const fixture = readFileSync('test/fixtures/two-tenant-seed-plan.json', 'utf8')
    expect(`${JSON.stringify(planTwoTenantSeed(), null, 2)}\n`).toBe(fixture)
    expect(planTwoTenantSeed()).toEqual(JSON.parse(fixture))
  })
})

describe('the flow plan', () => {
  it('is dev-canary: US/USD, America/Denver, minimum age 14, replies to the shared role inbox', () => {
    const p = plan()
    expect(p.tenant).toMatchObject({
      id: CANARY_FLOW_TENANT.id,
      slug: 'dev-canary',
      country: 'US',
      payment_region: 'US',
      currency: 'usd',
      time_zone: 'America/Denver',
      min_participant_age: 14,
      is_platform_owner: false,
      status: 'active',
    })
    expect((p.tenant.branding as Record<string, unknown>).reply_to).toBe(CANARY_ROLE_INBOX)
  })

  it('the role inbox is the one lib/email.ts falls back to', () => {
    const src = readFileSync('lib/email.ts', 'utf8')
    expect(src).toContain(`process.env.TRANSACTIONAL_REPLY_TO ?? '${CANARY_ROLE_INBOX}'`)
    expect(src).toContain(`process.env.DEV_EMAIL_SAFELIST ?? '${CANARY_ROLE_INBOX}'`)
  })

  it('gives the tenant a usable sender that replies to the role inbox', () => {
    const p = plan()
    const sender = tenantEventSender({ display_name: String(p.tenant.display_name), branding: p.tenant.branding })
    expect(sender).toEqual({ from: '"Dev Canary via Stellr" <no-reply@mail.stellreducation.org>', replyTo: CANARY_ROLE_INBOX })
  })

  it('maps canary.<zone> as the primary host and leaves nobody.<zone> unmapped', () => {
    const p = plan()
    expect(p.tenantDomains).toEqual([{ host: `canary.${ZONE}`, tenant_id: CANARY_FLOW_TENANT.id, is_primary: true }])
    expect(p.unmappedHost).toBe(`nobody.${ZONE}`)
    for (const h of [...p.tenantDomains.map((d) => d.host), p.unmappedHost]) expect(h).toMatch(TENANT_HOST_RE)
  })

  it('has one mirror row with a fixed sanity_id and slug, at least 3 weeks out, owned by dev-canary', () => {
    const e = plan().event
    expect(e).toMatchObject({
      tenant_id: CANARY_FLOW_TENANT.id,
      slug: CANARY_FLOW_EVENT.slug,
      sanity_id: CANARY_FLOW_EVENT.sanity_id,
      activity_type: 'live_event',
      time_zone: 'America/Denver',
      country: 'US',
      currency: 'usd',
      grade_system: 'us_grades',
      min_participant_age: 14,
    })
    expect(e.sanity_id).not.toMatch(/^drafts\./)
    const days = (Date.parse(e.starts_at as string) - NOW.getTime()) / 86_400_000
    expect(days).toBeGreaterThanOrEqual(CANARY_EVENT_MIN_LEAD_DAYS)
    // local midnight in Denver, and an exclusive end after a two-day event
    expect(e.starts_at).toBe('2026-12-17T07:00:00.000Z')
    expect(e.ends_at).toBe('2026-12-19T07:00:00.000Z')
    expect(Date.parse(e.ends_at as string)).toBeGreaterThan(Date.parse(e.starts_at as string))
  })

  it('is deterministic for a given day', () => {
    const a = planCanaryFlowSeed({ zone: ZONE, now: NOW })
    const b = planCanaryFlowSeed({ zone: ZONE, now: NOW })
    expect(a).toEqual(b)
  })

  it('shares no value with the honeytoken tenant, so the IDOR scans stay meaningful', () => {
    const text = JSON.stringify(plan())
    for (const v of HONEYTOKEN_VALUES) expect(text).not.toContain(v)
    expect(isCanaryId(CANARY_FLOW_TENANT.id)).toBe(false)
    expect(CANARY_FLOW_TENANT.id).not.toBe(CANARY_TENANT.id)
    expect(CANARY_FLOW_TENANT.id).not.toBe(STELLR_TENANT_ID)
  })

  it('a dry run describes hosts, slugs and handles, never an email', () => {
    const out = describeCanaryFlowPlan(plan()).join('\n')
    expect(out).toContain(`canary.${ZONE}`)
    expect(out).toContain('canary-manager')
    expect(out).not.toMatch(EMAIL)
  })
})

describe('the tenants CHECKs', () => {
  it('the validator uses the migration\'s own patterns', () => {
    expect(MIGRATION).toContain(`slug ~ '${TENANT_SLUG_RE.source}'`)
    expect(MIGRATION).toContain(`time_zone ~ '${TENANT_TIME_ZONE_RE.source.replace('\\/', '/')}'`)
    expect(MIGRATION).toContain(`host ~ '${TENANT_HOST_RE.source}'`)
    expect(MIGRATION).toContain("country IN ('US', 'AU')")
    expect(MIGRATION).toContain('min_participant_age >= 14 OR is_platform_owner')
    expect(MIGRATION).toContain("(payment_region = 'US' AND currency = 'usd') OR (payment_region = 'AU' AND currency = 'aud')")
  })

  it('the canary row passes every one', () => {
    expect(tenantRowProblems(plan().tenant)).toEqual([])
  })

  it('so do both honeytoken rows (the validator agrees with rows the CHECKs already accept)', () => {
    for (const t of planTwoTenantSeed().tenants) expect(tenantRowProblems(t)).toEqual([])
  })

  it('catches each kind of violation', () => {
    const ok = plan().tenant
    expect(tenantRowProblems({ ...ok, slug: 'Dev_Canary' })).toHaveLength(1)
    expect(tenantRowProblems({ ...ok, min_participant_age: 13 })).toHaveLength(1)
    expect(tenantRowProblems({ ...ok, min_participant_age: 0, is_platform_owner: true })).toEqual([])
    expect(tenantRowProblems({ ...ok, currency: 'aud' })).toEqual(['payment_region and currency disagree'])
    expect(tenantRowProblems({ ...ok, country: 'NZ' })).toHaveLength(1)
    expect(tenantRowProblems({ ...ok, time_zone: 'Denver' })).toHaveLength(1)
    expect(tenantRowProblems({ ...ok, ein: '123' })).toHaveLength(1)
    expect(tenantRowProblems({ ...ok, branding: [] })).toHaveLength(1)
    expect(tenantRowProblems({ ...ok, display_name: '' })).toHaveLength(1)
    expect(tenantRowProblems({ ...ok, status: 'gone' })).toHaveLength(1)
  })
})

describe('personas', () => {
  it('are synthetic: +clerk_test addresses on the reserved example.test domain, no password', () => {
    expect(CANARY_PERSONAS.map((p) => p.handle)).toEqual(['canary-manager', 'canary-admin', 'stellr-probe-admin'])
    for (const p of CANARY_PERSONAS) {
      expect(p.email).toMatch(/^[a-z-]+\+clerk_test@example\.test$/)
      const body = canaryClerkCreateUserBody(p)
      expect(body).not.toHaveProperty('password')
      expect(body.skip_password_requirement).toBe(true)
      expect(body.email_address).toEqual([p.email])
    }
  })

  it('canary-manager is an event manager, canary-admin holds no Clerk role, stellr-probe-admin is a Stellr admin', () => {
    const by = Object.fromEntries(CANARY_PERSONAS.map((p) => [p.handle, p]))
    expect(canaryClerkMetadata(by['canary-manager'])).toEqual({ fixture: 'canary-flow', role: 'event_manager' })
    // null clears a role on a Clerk metadata merge, so canary-admin can never be a Stellr admin
    expect(canaryClerkMetadata(by['canary-admin'])).toEqual({ fixture: 'canary-flow', role: null })
    expect(canaryClerkCreateUserBody(by['canary-admin']).public_metadata).toEqual({ fixture: 'canary-flow' })
    expect(canaryClerkMetadata(by['stellr-probe-admin'])).toEqual({ fixture: 'canary-flow', role: 'admin' })
  })
})

describe('zones', () => {
  it('normalises a zone and refuses anything that is not a hostname', () => {
    expect(normaliseZone(' Canary-Zone.Example.TEST. ')).toBe(ZONE)
    expect(canaryHosts('localhost')).toEqual({ mapped: 'canary.localhost', unmapped: 'nobody.localhost' })
    expect(() => normaliseZone(undefined)).toThrow(/--zone is required/)
    expect(() => normaliseZone('')).toThrow(/--zone is required/)
    for (const bad of ['a..b', 'bad_zone.test', '-x.test', 'x.test/path', 'x y.test', `${'a'.repeat(64)}.test`]) {
      expect(() => normaliseZone(bad)).toThrow()
    }
  })
})

describe('assertCanaryFlowTarget', () => {
  const base = { supabaseUrl: DEV_URL, useClerk: false }

  it('allows the dev project and a stack on this machine', () => {
    expect(() => assertCanaryFlowTarget(base)).not.toThrow()
    expect(() => assertCanaryFlowTarget({ ...base, supabaseUrl: 'http://127.0.0.1:54321' })).not.toThrow()
    expect(() => assertCanaryFlowTarget({ ...base, clerkSecretKey: 'sk_test_x', useClerk: true, publicAppEnv: 'dev', vercelEnv: 'development' })).not.toThrow()
  })

  it('refuses the production project, through the honeytoken guard it reuses', () => {
    expect(() => assertCanaryFlowTarget({ ...base, supabaseUrl: `https://${PRODUCTION_SUPABASE_REF}.supabase.co` })).toThrow(/PRODUCTION/)
    expect(() => assertCanaryFlowTarget({ ...base, supabaseUrl: undefined })).toThrow(/not set/)
  })

  it('refuses any other project: an allowlist, not a blocklist', () => {
    expect(() => assertCanaryFlowTarget({ ...base, supabaseUrl: 'https://someotherref.supabase.co' })).toThrow(/dev Supabase project/)
    expect(() => assertCanaryFlowTarget({ ...base, supabaseUrl: `https://evil.example/?x=${DEV_SUPABASE_REF}` })).toThrow(/dev Supabase project/)
  })

  it('refuses an sk_live_ key, with or without --clerk', () => {
    expect(() => assertCanaryFlowTarget({ ...base, clerkSecretKey: 'sk_live_x', useClerk: true })).toThrow(/sk_live_/)
    expect(() => assertCanaryFlowTarget({ ...base, clerkSecretKey: 'sk_live_x', useClerk: false })).toThrow(/sk_live_/)
    expect(() => assertCanaryFlowTarget({ ...base, useClerk: true })).toThrow(/CLERK_SECRET_KEY/)
    expect(() => assertCanaryFlowTarget({ ...base, clerkSecretKey: 'whatever', useClerk: true })).toThrow(/sk_test_/)
  })

  it('refuses APP_ENV prod or preview, and a Vercel preview', () => {
    for (const v of ['prod', 'production', 'preview', ' PROD ']) {
      expect(() => assertCanaryFlowTarget({ ...base, appEnv: v })).toThrow(/APP_ENV/)
      expect(() => assertCanaryFlowTarget({ ...base, publicAppEnv: v })).toThrow(/NEXT_PUBLIC_APP_ENV/)
    }
    expect(() => assertCanaryFlowTarget({ ...base, vercelEnv: 'preview' })).toThrow(/VERCEL_ENV/)
  })
})

// ── The database paths, against an in-memory database ──────────────────────

const STELLR_EVENT = { id: 'ev-stellr', tenant_id: STELLR_TENANT_ID, slug: 'stellr-real-event', sanity_id: 'stellr-real-event', ends_at: null }

function seedDb(extra: Record<string, object[]> = {}): FakeDb {
  return fakeSupabase({
    tenants: [{ id: STELLR_TENANT_ID, slug: 'stellr', is_platform_owner: true, status: 'active' }],
    events: [STELLR_EVENT],
    tenant_domains: [],
    tenant_memberships: [{ id: 'm-stellr', tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_stellr_staff', member_id: null, role: 'tenant_admin', source: 'admin' }],
    event_manager_assignments: [{ id: 'a-stellr', clerk_user_id: 'user_stellr_staff', event_slug: STELLR_EVENT.slug, tenant_id: STELLR_TENANT_ID }],
    registrations: [{ id: 'r-stellr', event_slug: STELLR_EVENT.slug, tenant_id: STELLR_TENANT_ID }],
    event_participations: [],
    ...extra,
  })
}

/**
 * The fake's client, plus what the derivation trigger does (stamp an
 * assignment with its event's tenant) and a record of every value a query
 * filtered on or wrote.
 */
function wired(db: FakeDb, seen: unknown[] = [], stampAs?: string): SupabaseClient {
  const base = db.client as unknown as { from: (t: string) => Record<string, (...a: unknown[]) => unknown> }
  const client = {
    from(table: string) {
      const chain = base.from(table)
      const wrap = (obj: Record<string, (...a: unknown[]) => unknown>): Record<string, (...a: unknown[]) => unknown> =>
        new Proxy(obj, {
          get(target, prop) {
            const v = (target as Record<string | symbol, unknown>)[prop]
            if (typeof v !== 'function' || prop === 'then') return typeof v === 'function' ? v.bind(target) : v
            return (...args: unknown[]) => {
              seen.push(...args.flatMap((a) => (typeof a === 'object' && a !== null ? Object.values(a as object) : [a])))
              if (table === 'event_manager_assignments' && prop === 'upsert') {
                const row = args[0] as Record<string, unknown>
                const ev = db.table('events').find((e) => e.slug === row.event_slug)
                args[0] = { ...row, tenant_id: stampAs ?? ev?.tenant_id ?? STELLR_TENANT_ID }
              }
              const out = (v as (...a: unknown[]) => unknown).apply(target, args)
              return out === target ? wrap(target) : out
            }
          },
        })
      return wrap(chain)
    },
  }
  return client as unknown as SupabaseClient
}

const CLERK_IDS: Record<string, string> = {
  'canary-manager': 'user_seed_canary_manager',
  'canary-admin': 'user_seed_canary_admin',
  'stellr-probe-admin': 'user_seed_stellr_probe',
}

function applyDeps(db: FakeDb, opts: { clerk?: boolean; log?: string[] } = {}): ApplyDeps {
  return {
    db: wired(db),
    ensureClerkUser: opts.clerk === false ? undefined : async (p) => CLERK_IDS[p.handle],
    syncEventManagerAssigned,
    syncTenantAdminGranted,
    log: (l) => opts.log?.push(l),
  }
}

describe('--apply', () => {
  it('writes the tenant, host, mirror row and personas, the assignment after the mirror row, and leaves Stellr alone', async () => {
    const db = seedDb()
    const stellrBefore = JSON.stringify({ t: db.table('tenants')[0], e: db.table('events')[0], r: db.table('registrations') })
    const log: string[] = []
    await applyCanaryFlowSeed(plan(), applyDeps(db, { log }))

    const canary = db.table('tenants').find((t) => t.id === CANARY_FLOW_TENANT.id)!
    expect(tenantRowProblems(canary)).toEqual([])
    expect(db.table('tenant_domains')).toEqual([expect.objectContaining({ host: `canary.${ZONE}`, tenant_id: CANARY_FLOW_TENANT.id, is_primary: true })])
    expect(db.table('events').find((e) => e.slug === CANARY_FLOW_EVENT.slug)).toMatchObject({ tenant_id: CANARY_FLOW_TENANT.id, min_participant_age: 14 })

    const assignment = db.table('event_manager_assignments').find((a) => a.event_slug === CANARY_FLOW_EVENT.slug)!
    expect(assignment).toMatchObject({ clerk_user_id: CLERK_IDS['canary-manager'], tenant_id: CANARY_FLOW_TENANT.id })
    expect(Date.parse(assignment.expires_at as string)).toBe(Date.parse(plan().event.ends_at as string) + 30 * 86_400_000)

    const memberships = db.table('tenant_memberships').map((m) => [m.tenant_id, m.clerk_user_id, m.role])
    expect(memberships).toEqual(
      expect.arrayContaining([
        [CANARY_FLOW_TENANT.id, CLERK_IDS['canary-manager'], 'event_manager'],
        [CANARY_FLOW_TENANT.id, CLERK_IDS['canary-admin'], 'tenant_admin'],
        [STELLR_TENANT_ID, CLERK_IDS['stellr-probe-admin'], 'tenant_admin'],
      ]),
    )
    // canary-manager holds no Stellr membership; canary-admin none either
    expect(db.table('tenant_memberships').filter((m) => m.tenant_id === STELLR_TENANT_ID).map((m) => m.clerk_user_id).sort()).toEqual(
      [CLERK_IDS['stellr-probe-admin'], 'user_stellr_staff'].sort(),
    )
    expect(JSON.stringify({ t: db.table('tenants')[0], e: db.table('events')[0], r: db.table('registrations') })).toBe(stellrBefore)
    expect(log.join('\n')).not.toMatch(EMAIL)
  })

  it('is idempotent, and keeps a mirror row the publish has since updated', async () => {
    const db = seedDb()
    await applyCanaryFlowSeed(plan(), applyDeps(db))
    db.table('events').find((e) => e.slug === CANARY_FLOW_EVENT.slug)!.title = 'Published title'
    await applyCanaryFlowSeed(planCanaryFlowSeed({ zone: ZONE, now: new Date('2026-12-01T00:00:00Z') }), applyDeps(db))
    expect(db.table('tenants').filter((t) => t.id === CANARY_FLOW_TENANT.id)).toHaveLength(1)
    expect(db.table('tenant_domains')).toHaveLength(1)
    expect(db.table('events').filter((e) => e.slug === CANARY_FLOW_EVENT.slug)).toEqual([expect.objectContaining({ title: 'Published title' })])
    expect(db.table('event_manager_assignments').filter((a) => a.event_slug === CANARY_FLOW_EVENT.slug)).toHaveLength(1)
    expect(db.table('tenant_memberships')).toHaveLength(4)
  })

  it('without --clerk writes the data rows only', async () => {
    const db = seedDb()
    await applyCanaryFlowSeed(plan(), applyDeps(db, { clerk: false }))
    expect(db.table('event_manager_assignments').filter((a) => a.event_slug === CANARY_FLOW_EVENT.slug)).toEqual([])
    expect(db.table('tenant_memberships')).toHaveLength(1)
  })

  it('refuses, before writing, a host or event that belongs to another tenant, or a mapped probe host', async () => {
    const cases: Record<string, object[]>[] = [
      { tenant_domains: [{ host: `canary.${ZONE}`, tenant_id: STELLR_TENANT_ID, is_primary: false }] },
      { tenant_domains: [{ host: `nobody.${ZONE}`, tenant_id: CANARY_FLOW_TENANT.id, is_primary: false }] },
      { events: [STELLR_EVENT, { ...STELLR_EVENT, id: 'ev-x', slug: CANARY_FLOW_EVENT.slug, sanity_id: 'other' }] },
      { events: [STELLR_EVENT, { ...STELLR_EVENT, id: 'ev-y', slug: 'other', sanity_id: CANARY_FLOW_EVENT.sanity_id }] },
      { events: [STELLR_EVENT, { ...STELLR_EVENT, id: 'ev-z', tenant_id: CANARY_FLOW_TENANT.id, sanity_id: 'other', slug: CANARY_FLOW_EVENT.slug }] },
      { tenants: [{ id: STELLR_TENANT_ID, slug: 'stellr', is_platform_owner: true }, { id: 'someone-else', slug: 'dev-canary', is_platform_owner: false }] },
    ]
    for (const extra of cases) {
      const db = seedDb(extra)
      const before = JSON.stringify(db.tables)
      await expect(applyCanaryFlowSeed(plan(), applyDeps(db))).rejects.toThrow()
      expect(JSON.stringify(db.tables)).toBe(before)
    }
  })

  it('refuses a plan whose tenant row would fail the CHECKs', async () => {
    const bad: CanaryFlowPlan = { ...plan(), tenant: { ...plan().tenant, min_participant_age: 12 } }
    await expect(applyCanaryFlowSeed(bad, applyDeps(seedDb()))).rejects.toThrow(/CHECKs/)
  })

  it('stops when the assignment is not stamped with dev-canary, before any role sync', async () => {
    const db = seedDb()
    let synced = 0
    const deps: ApplyDeps = {
      ...applyDeps(db),
      // a database whose trigger stamped the row with another tenant
      db: wired(db, [], STELLR_TENANT_ID),
      syncEventManagerAssigned: async () => {
        synced++
        return { ok: true }
      },
    }
    await expect(applyCanaryFlowSeed(plan(), deps)).rejects.toThrow(/not stamped with dev-canary/)
    expect(synced).toBe(0)
  })

  it('stops when a role sync fails', async () => {
    const db = seedDb()
    const deps: ApplyDeps = { ...applyDeps(db), syncTenantAdminGranted: async () => ({ ok: false, step: 'admin_grant', code: '42501' }) }
    await expect(applyCanaryFlowSeed(plan(), deps)).rejects.toThrow(/stellr-probe-admin failed at admin_grant \(42501\)/)
  })
})

describe('--check', () => {
  const sender = tenantEventSender

  it('is ready after --apply --clerk, and prints reasons without emails or ids', async () => {
    const db = seedDb()
    await applyCanaryFlowSeed(plan(), applyDeps(db))
    const facts = await readCanaryFacts(wired(db), plan())
    const lines = canaryReadiness(plan(), facts, { senderOf: sender, now: NOW })
    expect(lines.map((l) => [l.what, l.ok])).toEqual([
      ['tenant', true],
      ['sender', true],
      ['host map', true],
      ['probe host', true],
      ['mirror row', true],
      ['roles', true],
    ])
    const out = formatReadiness(lines).join('\n')
    expect(out).not.toMatch(EMAIL)
    for (const id of [...Object.values(CLERK_IDS), CANARY_FLOW_TENANT.id, STELLR_TENANT_ID]) expect(out).not.toContain(id)
  })

  it('says what is missing on an empty database', async () => {
    const facts = await readCanaryFacts(wired(seedDb()), plan())
    const lines = canaryReadiness(plan(), facts, { senderOf: sender, now: NOW })
    expect(lines.every((l) => !l.ok || l.what === 'probe host')).toBe(true)
    expect(formatReadiness(lines).join('\n')).toMatch(/NOT READY\s+mirror row/)
  })

  it('catches a reply-to that is not the role inbox, without printing it', async () => {
    const db = seedDb()
    await applyCanaryFlowSeed(plan(), applyDeps(db))
    const t = db.table('tenants').find((r) => r.id === CANARY_FLOW_TENANT.id)!
    t.branding = { reply_to: 'someone@example.com' }
    const lines = canaryReadiness(plan(), await readCanaryFacts(wired(db), plan()), { senderOf: sender, now: NOW })
    expect(lines.find((l) => l.what === 'sender')).toMatchObject({ ok: false, reason: 'reply-to is not the shared role inbox' })
    expect(formatReadiness(lines).join('\n')).not.toMatch(EMAIL)
    t.branding = {}
    const again = canaryReadiness(plan(), await readCanaryFacts(wired(db), plan()), { senderOf: sender, now: NOW })
    expect(again.find((l) => l.what === 'sender')?.ok).toBe(false)
  })

  it('catches a mapped probe host, a stolen host and a started event', async () => {
    const db = seedDb()
    await applyCanaryFlowSeed(plan(), applyDeps(db))
    db.table('tenant_domains').push({ host: `nobody.${ZONE}`, tenant_id: CANARY_FLOW_TENANT.id })
    db.table('tenant_domains').find((d) => d.host === `canary.${ZONE}`)!.tenant_id = STELLR_TENANT_ID
    const later = new Date(Date.parse(plan().event.starts_at as string) + 3_600_000)
    const lines = canaryReadiness(plan(), await readCanaryFacts(wired(db), plan()), { senderOf: sender, now: later })
    expect(lines.filter((l) => !l.ok).map((l) => l.what).sort()).toEqual(['host map', 'mirror row', 'probe host'])
  })

  it('throws on a failed read, so a failure never reads as "not seeded"', async () => {
    const db = fakeSupabase({}, { failOn: (t) => (t === 'tenant_domains' ? 'boom' : null) })
    await expect(readCanaryFacts(wired(db), plan())).rejects.toThrow(/tenant_domains read failed/)
  })
})

describe('--remove', () => {
  const EVENT_ENTITY = getEntityDef('event')!

  function removeDeps(db: FakeDb, seen: unknown[], calls: string[]): RemoveDeps {
    return {
      db: wired(db, seen),
      eventEntity: EVENT_ENTITY,
      // The registry's own count queries, against the same rows.
      deletionPreflight: async (entity, id) => {
        calls.push(`preflight ${entity}`)
        seen.push(entity, id)
        const def = getEntityDef(entity)!
        const blockers = def.dependents
          .map((d) => ({ table: d.table, count: db.table(d.table).filter((r) => r[d.fkColumn] === id).length }))
          .filter((b) => b.count > 0)
        return { canDelete: blockers.length === 0, blockers }
      },
      archive: async (def, id) => {
        calls.push(`archive ${def.type}`)
        seen.push(def.type, id)
      },
      syncEventManagerUnassigned: async (...args) => {
        calls.push('unassign')
        seen.push(...args.slice(1))
        return syncEventManagerUnassigned(...(args as Parameters<typeof syncEventManagerUnassigned>))
      },
      deleteClerkUser: async (p) => {
        calls.push(`clerk ${p.handle}`)
        return 'deleted'
      },
      log: () => {},
    }
  }

  /** The state K7a leaves: the seed applied, plus an event settings row. */
  async function seeded(extra: Record<string, object[]> = {}): Promise<FakeDb> {
    const db = seedDb(extra)
    await applyCanaryFlowSeed(plan(), applyDeps(db))
    db.table('event_settings').push({ event_slug: CANARY_FLOW_EVENT.slug, tenant_id: CANARY_FLOW_TENANT.id })
    db.table('event_settings').push({ event_slug: STELLR_EVENT.slug, tenant_id: STELLR_TENANT_ID })
    return db
  }

  /** The rows, ignoring the empty tables the fake creates when a table is first read. */
  const snapshot = (db: FakeDb) => JSON.stringify(Object.fromEntries(Object.entries(db.tables).filter(([, rows]) => rows.length > 0)))
  const stellrRows = (db: FakeDb) =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(db.tables)
          .map(([k, rows]) => [k, rows.filter((r) => r.tenant_id === STELLR_TENANT_ID || (k === 'tenants' && r.id === STELLR_TENANT_ID))] as const)
          .filter(([, rows]) => rows.length > 0),
      ),
    )

  it('follows the deletion registry\'s event entity and leaves every Stellr row', async () => {
    expect(EVENT_ENTITY.spans?.map((s) => s.table)).toEqual(expect.arrayContaining(['event_settings', 'event_manager_assignments']))
    const db = await seeded()
    const before = stellrRows(db)
    const calls: string[] = []
    const result = await removeCanaryFlow(removeDeps(db, [], calls))
    expect(result).toEqual({ tenant: 'deleted' })
    expect(calls).toEqual(['preflight event', 'archive event', 'unassign', 'clerk canary-manager', 'clerk canary-admin'])
    expect(stellrRows(db)).toBe(before)
    const canaryLeft = Object.values(db.tables)
      .flat()
      .filter((r) => JSON.stringify(r).includes(CANARY_FLOW_TENANT.id) || JSON.stringify(r).includes(CANARY_FLOW_EVENT.slug))
    expect(canaryLeft).toEqual([])
    // the Stellr probe admin's Stellr membership is a Stellr row: left in place
    expect(db.table('tenant_memberships').some((m) => m.clerk_user_id === CLERK_IDS['stellr-probe-admin'])).toBe(true)
  })

  it('never names STELLR_TENANT_ID: not in any filter, write or registry call, and not in its source', async () => {
    const db = await seeded()
    const seen: unknown[] = []
    await removeCanaryFlow(removeDeps(db, seen, []))
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.filter((v) => v === STELLR_TENANT_ID)).toEqual([])

    const src = readFileSync('lib/testing/canary-flow-seed.ts', 'utf8')
    expect(src).not.toMatch(/STELLR_TENANT_ID/)
    expect(src).not.toContain(STELLR_TENANT_ID)
    expect(src).not.toMatch(/tenancy\/constants/)
  })

  it('stops, deleting nothing, while the registry finds registrations or participation records', async () => {
    for (const table of ['registrations', 'event_participations']) {
      const db = await seeded()
      db.table(table).push({ id: `${table}-canary`, event_slug: CANARY_FLOW_EVENT.slug, tenant_id: CANARY_FLOW_TENANT.id })
      const before = snapshot(db)
      const calls: string[] = []
      await expect(removeCanaryFlow(removeDeps(db, [], calls))).rejects.toThrow(new RegExp(`deletion registry finds rows on ${CANARY_FLOW_EVENT.slug} \\(${table} 1\\)`))
      expect(calls).toEqual(['preflight event'])
      expect(snapshot(db)).toBe(before)
    }
  })

  it('refuses, deleting nothing, when a row the entity would delete is not dev-canary\'s', async () => {
    for (const table of ['event_settings', 'event_companies', 'event_manager_assignments']) {
      const db = await seeded()
      db.table(table).push({ id: `${table}-stray`, event_slug: CANARY_FLOW_EVENT.slug, clerk_user_id: 'user_stray', tenant_id: STELLR_TENANT_ID })
      const before = snapshot(db)
      const calls: string[] = []
      await expect(removeCanaryFlow(removeDeps(db, [], calls))).rejects.toThrow(/not stamped with dev-canary/)
      expect(calls).toEqual(['preflight event'])
      expect(snapshot(db)).toBe(before)
    }
  })

  it('refuses when the row under the canary id is not dev-canary', async () => {
    const db = seedDb({ tenants: [{ id: CANARY_FLOW_TENANT.id, slug: 'someone', is_platform_owner: false }] })
    const before = snapshot(db)
    await expect(removeCanaryFlow(removeDeps(db, [], []))).rejects.toThrow(/not dev-canary/)
    expect(snapshot(db)).toBe(before)
  })

  it('archives the tenant when kept rows still name it', async () => {
    const db = await seeded()
    const failing = fakeSupabase(db.tables, {
      failOn: (t, action) => (t === 'tenants' && action === 'delete' ? 'update or delete on table "tenants" violates foreign key constraint' : null),
    })
    const result = await removeCanaryFlow(removeDeps(failing, [], []))
    expect(result).toEqual({ tenant: 'archived' })
    expect(failing.table('tenants').find((t) => t.id === CANARY_FLOW_TENANT.id)).toMatchObject({ status: 'archived' })
    expect(failing.table('tenant_domains')).toEqual([])
  })

  it('is safe to re-run once everything is gone', async () => {
    const db = await seeded()
    await removeCanaryFlow(removeDeps(db, [], []))
    await expect(removeCanaryFlow(removeDeps(db, [], []))).resolves.toEqual({ tenant: 'absent' })
  })

  it('a dry run lists the steps, none of which names Stellr\'s rows', () => {
    const text = CANARY_REMOVAL_STEPS.join('\n')
    expect(text).toMatch(/deletion registry/)
    expect(text).not.toContain(STELLR_TENANT_ID)
  })
})

describe('scripts/seed-two-tenants.ts --profile flow', () => {
  const src = readFileSync('scripts/seed-two-tenants.ts', 'utf8')
  const flow = src.slice(src.indexOf('async function mainFlow()'))

  it('keeps honeytoken as the default profile', () => {
    expect(src).toMatch(/const PROFILE = flagValue\('--profile'\) \?\? 'honeytoken'/)
    expect(src).toMatch(/if \(PROFILE === 'flow'\) return mainFlow\(\)/)
  })

  it('guards before it loads any client, on every flow path', () => {
    const guard = flow.indexOf('assertCanaryFlowTarget(')
    expect(guard).toBeGreaterThan(-1)
    for (const mod of ['../lib/supabase', '../lib/deletion/registry', '../lib/deletion/preflight', '../lib/deletion/archive', '../lib/authz/role-sync', '../lib/event-emails/tenant-mail']) {
      const at = flow.indexOf(`await import('${mod}')`)
      expect(at, mod).toBeGreaterThan(guard)
    }
    expect(src).not.toMatch(/^import .*lib\/(supabase|deletion|authz)/m)
    // server-only: it cannot load in a Node script
    expect(src).not.toMatch(/import\('..\/lib\/deletion\/execute'\)/)
  })

  it('is dry-run by default for the seed and the teardown, and --check writes nothing', () => {
    expect(flow).toMatch(/if \(REMOVE\) \{[\s\S]*?if \(!APPLY\) \{[\s\S]*?return/)
    const check = flow.slice(flow.indexOf('if (CHECK) {'), flow.indexOf("console.log(`Canary flow seed"))
    expect(check).not.toMatch(/applyCanaryFlowSeed|removeCanaryFlow|\.insert\(|\.upsert\(|\.delete\(/)
  })

  it('reads the env the guard checks', () => {
    expect(flow).toContain('assertCanaryFlowTarget(flowTargetEnvFrom(process.env, CLERK))')
  })

})
