// @vitest-environment node
//
// The IDOR harness's tenantDb transport (test/idor/tenant-db-fake.ts): first on
// its own, then through the harness, over handlers that read and write through
// lib/tenancy/area-switch in tenant mode. A handler that pins the tenant it
// should is not failed; one that pins the record's tenant is, as a leak or a
// honey write, so a converted area cannot slip out of the IDOR suite.
import './mocks'
import { createClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { currentTenantId } from '@/lib/authz/tenant'
import { readArea, TENANT_DB_AREAS_ENV, writeArea } from '@/lib/tenancy/area-switch'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { tenantDb, TENANT_DB_FLAG } from '@/lib/tenancy/db'
import { CANARY_TENANT, HONEYTOKENS } from '@/lib/testing/honeytokens'
import { ASSIGNED_EVENT_SLUG, FAILING_OUTCOMES, installNetworkGuard, runIdorCase, TENANT_A_PARTICIPANT } from './harness'
import { newHoneyDbState } from './honey-db'
import { honeyTenantDriver, type FakeStatement } from './tenant-db-fake'

installNetworkGuard()

describe('the fake on its own', () => {
  const setup = (opts: { honeyTenantId?: string; honeyAbsent?: boolean; scoping?: string[] } = {}) => {
    const db = newHoneyDbState({}, { honeyTenantId: opts.honeyTenantId, honeyAbsent: opts.honeyAbsent })
    const log: FakeStatement[] = []
    const driver = honeyTenantDriver(() => ({ db, scopingValues: opts.scoping ?? [TENANT_A_PARTICIPANT.memberId] }), log)
    return { db, log, as: (tenantId: string) => tenantDb(tenantId, { driver }) }
  }

  it('hides the honey row from a transaction pinned to another tenant, as RLS does', async () => {
    const { db, as } = setup()
    expect(await as(STELLR_TENANT_ID).sql`SELECT * FROM public.event_settings WHERE event_slug = ${HONEYTOKENS.eventSlug}`).toEqual([])
    expect(await as(STELLR_TENANT_ID).sql`UPDATE public.event_settings SET company_count = 1 WHERE event_slug = ${HONEYTOKENS.eventSlug}`).toEqual([])
    expect(db).toMatchObject({ honeyReads: [], writes: [], touched: true })
  })

  it("shows it to a transaction pinned to the honey row's tenant, and records the read", async () => {
    const { db, as } = setup()
    const rows = await as(CANARY_TENANT.id).sql<Record<string, unknown>>`SELECT * FROM public.event_settings`
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows)).toContain(HONEYTOKENS.text)
    expect(db.honeyReads).toEqual(['public.event_settings'])
  })

  it("records a write pinned to the honey row's tenant as a honey write", async () => {
    const { db, as } = setup()
    await as(CANARY_TENANT.id).sql`DELETE FROM public.event_emails WHERE id = ${HONEYTOKENS.id}`
    expect(db.writes).toEqual([expect.objectContaining({ table: 'public.event_emails', op: 'tenantdb' })])
  })

  it("refuses an insert that names the other tenant's record, as the tenant policies do", async () => {
    const { db, as } = setup()
    await expect(
      as(STELLR_TENANT_ID).sql`INSERT INTO public.event_settings (event_slug) VALUES (${HONEYTOKENS.eventSlug})`,
    ).rejects.toMatchObject({ code: '42501' })
    expect(db.writes).toEqual([])
    // An address the caller typed is stored, not refused.
    await expect(as(STELLR_TENANT_ID).sql`INSERT INTO public.contacts (email) VALUES (${HONEYTOKENS.email})`).resolves.toEqual([])
  })

  it('in one tenant (an event manager), a statement scoped to the caller misses the honey row and an unscoped one finds it', async () => {
    const { db, as } = setup({ honeyTenantId: STELLR_TENANT_ID, scoping: [ASSIGNED_EVENT_SLUG] })
    expect(await as(STELLR_TENANT_ID).sql`SELECT * FROM public.event_settings WHERE event_slug = ${ASSIGNED_EVENT_SLUG}`).toEqual([])
    expect(await as(STELLR_TENANT_ID).sql`SELECT * FROM public.event_settings WHERE id = ${HONEYTOKENS.id}`).toHaveLength(1)
    expect(db.honeyReads).toHaveLength(1)
  })

  it('returns nothing on the differential run with the honey row absent', async () => {
    const { db, as } = setup({ honeyAbsent: true })
    expect(await as(CANARY_TENANT.id).sql`SELECT * FROM public.event_settings`).toEqual([])
    expect(db.honeyReads).toEqual([])
  })

  it('runs tenantDb unchanged: every caller statement is pinned, and a bare statement is refused', async () => {
    const { log, as } = setup()
    await as(STELLR_TENANT_ID).transaction(async (q) => {
      await q.sql`SELECT 1 FROM public.event_settings`
      await q.sql`SELECT 2 FROM public.event_emails`
    })
    expect(log.map((s) => s.tenant)).toEqual([STELLR_TENANT_ID, STELLR_TENANT_ID])
    const db = newHoneyDbState()
    const driver = honeyTenantDriver(() => ({ db, scopingValues: [] }))
    await expect(driver.transaction((tx) => tx.query('SELECT 1 FROM public.event_settings'))).rejects.toMatchObject({ code: '42501' })
  })
})

describe('through the harness: a converted area in tenant mode', () => {
  const input = { segments: ['slug'], query: [], body: [], urlPattern: '/api/fixture/[slug]' }
  const ctx = async (c: { params: Promise<Record<string, string | string[]>> }) => String((await c.params).slug)
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of [TENANT_DB_FLAG, TENANT_DB_AREAS_ENV]) saved[k] = process.env[k]
    process.env[TENANT_DB_FLAG] = 'true'
    process.env[TENANT_DB_AREAS_ENV] = 'events-config:tenant'
  })
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  /** The tenant of the event the URL names, read by global slug: the mistake under test. */
  async function recordTenant(slug: string): Promise<string> {
    const { data } = await (createClient('http://localhost', 'k') as unknown as {
      from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { tenant_id: string } | null }> } } }
    })
      .from('events')
      .select('tenant_id')
      .eq('slug', slug)
      .maybeSingle()
    return data?.tenant_id ?? STELLR_TENANT_ID
  }

  const read = (tenantOf: (slug: string) => Promise<string>) => ({
    GET: async (_req: Request, c: { params: Promise<Record<string, string | string[]>> }) => {
      const slug = await ctx(c)
      const rows = await readArea('events-config', {
        tenantId: await tenantOf(slug),
        service: async () => [],
        tenant: (db) => db.sql`SELECT * FROM public.event_settings WHERE event_slug = ${slug}`,
      })
      return Response.json({ rows })
    },
  })

  const write = (tenantOf: (slug: string) => Promise<string>) => ({
    POST: async (_req: Request, c: { params: Promise<Record<string, string | string[]>> }) => {
      const slug = await ctx(c)
      await writeArea('events-config', {
        tenantId: await tenantOf(slug),
        service: async () => [],
        tenant: (db) => db.sql`UPDATE public.event_settings SET company_count = 1 WHERE event_slug = ${slug}`,
      })
      return Response.json({ ok: true })
    },
  })

  it("passes a read pinned to the caller's own tenant", async () => {
    const r = await runIdorCase(read(async () => currentTenantId()), input, 'GET')
    expect(FAILING_OUTCOMES).not.toContain(r.outcome)
  })

  it("fails a read pinned to the record's tenant as a leak", async () => {
    const r = await runIdorCase(read(recordTenant), input, 'GET')
    expect(r.outcome).toBe('leak')
  })

  it("passes a write pinned to the caller's own tenant, and fails one pinned to the record's as a honey write", async () => {
    const good = await runIdorCase(write(async () => currentTenantId()), input, 'POST')
    expect(FAILING_OUTCOMES).not.toContain(good.outcome)
    const bad = await runIdorCase(write(recordTenant), input, 'POST')
    expect(bad.outcome).toBe('honey_write')
  })

  it('with tenantDb off (every case today) the area reads through its service path and the fake is not reached', async () => {
    process.env[TENANT_DB_FLAG] = 'false'
    let tenantRan = false
    const mod = {
      GET: async () => {
        const rows = await readArea('events-config', {
          tenantId: CANARY_TENANT.id,
          service: async () => [],
          tenant: async () => {
            tenantRan = true
            return []
          },
        })
        return Response.json({ rows })
      },
    }
    const r = await runIdorCase(mod, { ...input, segments: [] , urlPattern: '/api/fixture' }, 'GET')
    expect(tenantRan).toBe(false)
    expect(FAILING_OUTCOMES).not.toContain(r.outcome)
  })
})
