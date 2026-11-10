// Two tenants through the real tenantDb driver, against a real Postgres
// (multi-tenancy plan S5, C11). Run by CI's tenant-db job only, with
// vitest.integration.config.mts, on a throwaway local Supabase database built
// from the baseline plus every migration. The job creates the login
// (tenant_app_login, granted tenant_app, a password made for the run) and
// passes two connection strings:
//
//   TENANT_DB_TEST_URL        as tenant_app_login: what the app would use
//   TENANT_DB_TEST_ADMIN_URL  as the local owner: fixtures, cleanup, checks
//
// Both must point at this machine; the file refuses anything else before it
// writes, because it creates tenants and revokes a grant for one test.

import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tenantDb, TENANT_DB_FLAG } from '@/lib/tenancy/db'
import {
  createPostgresTenantDriver,
  endTenantDrivers,
  parsePostgresUrl,
  parseTenantDatabaseUrl,
  type PostgresTenantDriver,
} from '@/lib/tenancy/driver'

const LOGIN_URL = process.env.TENANT_DB_TEST_URL
const ADMIN_URL = process.env.TENANT_DB_TEST_ADMIN_URL

// Read with the driver's own parser, so the host checked is the host dialled.
function assertLocal(name: string, raw: string | undefined, check = parsePostgresUrl) {
  if (!raw) throw new Error(`${name} is not set: this test runs in CI's tenant-db job against a local database`)
  const parsed = check(raw, name)
  if (!parsed.local) throw new Error(`${name} must point at this machine`)
  return parsed
}

const run = randomUUID().slice(0, 8)
const A = { id: randomUUID(), slug: `tdb-a-${run}`, event: `tdb-ev-a-${run}`, spare: `tdb-ev-a2-${run}` }
const B = { id: randomUUID(), slug: `tdb-b-${run}`, event: `tdb-ev-b-${run}`, spare: `tdb-ev-b2-${run}` }

let admin: postgres.Sql
let env: Record<string, string>

type Settings = { event_slug: string; company_count: number | null }

const asTenant = (id: string) => tenantDb(id, { env })

async function settingsOf(tenantId: string): Promise<Settings[]> {
  return (await admin<Settings[]>`
    SELECT event_slug, company_count FROM public.event_settings WHERE tenant_id = ${tenantId} ORDER BY event_slug`).map(
    (r) => ({ ...r }),
  )
}

beforeAll(async () => {
  const loginUrl = assertLocal('TENANT_DB_TEST_URL', LOGIN_URL, parseTenantDatabaseUrl).url
  const owner = assertLocal('TENANT_DB_TEST_ADMIN_URL', ADMIN_URL)
  // The checked parts, never the string (see lib/tenancy/driver.ts).
  admin = postgres({
    host: owner.host,
    port: owner.port,
    user: owner.user,
    pass: owner.password,
    database: owner.database,
    ssl: false,
    max: 1,
    onnotice: () => {},
  })
  env = { [TENANT_DB_FLAG]: 'true', TENANT_DATABASE_URL: loginUrl }

  for (const t of [A, B]) {
    await admin`
      INSERT INTO public.tenants (id, slug, legal_name, display_name, country, payment_region, currency, time_zone)
      VALUES (${t.id}, ${t.slug}, ${`Tenant DB test ${t.slug}`}, ${t.slug}, 'US', 'US', 'usd', 'UTC')`
    for (const ev of [t.event, t.spare]) {
      await admin`
        INSERT INTO public.events (tenant_id, slug, sanity_id, title, time_zone, country, currency, grade_system)
        VALUES (${t.id}, ${ev}, ${`sanity-${ev}`}, 'Tenant DB test', 'UTC', 'US', 'usd', 'us_grades')`
    }
    await admin`INSERT INTO public.event_settings (event_slug, tenant_id, company_count) VALUES (${t.event}, ${t.id}, 2)`
  }
})

afterAll(async () => {
  await endTenantDrivers()
  if (!admin) return
  const ids = [A.id, B.id]
  // In order, each on its own, so one failure does not leave the rest behind.
  const cleanup = [
    () => admin`DELETE FROM public.event_settings WHERE tenant_id = ANY(${ids}::uuid[])`,
    () => admin`DELETE FROM public.refund_policies WHERE tenant_id = ANY(${ids}::uuid[])`,
    () => admin`DELETE FROM public.events WHERE tenant_id = ANY(${ids}::uuid[])`,
    () => admin`DELETE FROM public.tenants WHERE id = ANY(${ids}::uuid[])`,
  ]
  for (const step of cleanup) await step().catch(() => {})
  await admin.end({ timeout: 5 })
})

describe('tenantDb on a real database: two tenants', () => {
  it('fixtures: as the owner, each tenant has its own settings row', async () => {
    expect(await settingsOf(A.id)).toEqual([{ event_slug: A.event, company_count: 2 }])
    expect(await settingsOf(B.id)).toEqual([{ event_slug: B.event, company_count: 2 }])
  })

  it('each tenant sees only its own rows', async () => {
    for (const [me, other] of [
      [A, B],
      [B, A],
    ]) {
      const settings = await asTenant(me.id).sql<{ event_slug: string }>`
        SELECT event_slug FROM public.event_settings WHERE event_slug = ANY(${[A.event, B.event]}::text[])`
      expect(settings.map((r) => r.event_slug)).toEqual([me.event])
      const events = await asTenant(me.id).sql<{ slug: string }>`
        SELECT slug FROM public.events WHERE slug = ANY(${[A.event, A.spare, B.event, B.spare]}::text[]) ORDER BY slug`
      expect(events.map((r) => r.slug)).toEqual([me.event, me.spare].sort())
      const tenants = await asTenant(me.id).sql<{ id: string }>`SELECT id::text AS id FROM public.tenants`
      expect(tenants.map((r) => r.id)).toEqual([me.id])
      const leaked = await asTenant(me.id).sql`SELECT 1 FROM public.event_settings WHERE event_slug = ${other.event}`
      expect(leaked).toEqual([])
    }
  })

  it('a tenant can write its own rows', async () => {
    const updated = await asTenant(A.id).sql<{ event_slug: string }>`
      UPDATE public.event_settings SET company_count = 3 WHERE event_slug = ${A.event} RETURNING event_slug`
    expect(updated).toEqual([{ event_slug: A.event }])
    const inserted = await asTenant(A.id).sql<{ tenant_id: string }>`
      INSERT INTO public.refund_policies (scope, tiers, tenant_id) VALUES ('event', '[]'::jsonb, ${A.id})
      RETURNING tenant_id::text AS tenant_id`
    expect(inserted).toEqual([{ tenant_id: A.id }])
    expect(await settingsOf(A.id)).toEqual([{ event_slug: A.event, company_count: 3 }])
  })

  it("UPDATE and DELETE of the other tenant's row touch nothing", async () => {
    const updated = await asTenant(A.id).sql`
      UPDATE public.event_settings SET company_count = 9 WHERE event_slug = ${B.event} RETURNING event_slug`
    const deleted = await asTenant(A.id).sql`DELETE FROM public.event_settings WHERE event_slug = ${B.event} RETURNING event_slug`
    expect(updated).toEqual([])
    expect(deleted).toEqual([])
    expect(await settingsOf(B.id)).toEqual([{ event_slug: B.event, company_count: 2 }])
  })

  it('a write naming the other tenant is refused, and nothing lands', async () => {
    // A row for the other tenant's event.
    await expect(
      asTenant(A.id).sql`INSERT INTO public.event_settings (event_slug) VALUES (${B.spare})`,
    ).rejects.toMatchObject({ code: '42501' })
    // A row that names the other tenant outright.
    await expect(
      asTenant(A.id).sql`
        INSERT INTO public.refund_policies (scope, tiers, tenant_id) VALUES ('event', '[]'::jsonb, ${B.id})`,
    ).rejects.toMatchObject({ code: '42501' })
    // Moving its own row to the other tenant.
    await expect(
      asTenant(A.id).sql`UPDATE public.refund_policies SET tenant_id = ${B.id} WHERE tenant_id = ${A.id}`,
    ).rejects.toMatchObject({ code: '42501' })
    const [{ n }] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM public.event_settings WHERE event_slug = ${B.spare}`
    expect(n).toBe(0)
    const policies = await admin<{ tenant_id: string }[]>`
      SELECT tenant_id::text AS tenant_id FROM public.refund_policies WHERE tenant_id = ANY(${[A.id, B.id]}::uuid[])`
    expect(policies.map((r) => r.tenant_id)).toEqual([A.id])
  })

  it('a throw rolls the whole transaction back', async () => {
    await expect(
      asTenant(B.id).transaction(async (q) => {
        await q.sql`UPDATE public.event_settings SET company_count = 7 WHERE event_slug = ${B.event}`
        throw new Error('caller failed')
      }),
    ).rejects.toThrow('caller failed')
    expect(await settingsOf(B.id)).toEqual([{ event_slug: B.event, company_count: 2 }])
  })

  it('a missing tenant id is refused before any connection is used', () => {
    expect(() => tenantDb('', { env })).toThrow(/needs a tenant id/)
  })
})

describe('tenantDb on a real database: one connection, used by both tenants in turn', () => {
  let driver: PostgresTenantDriver

  beforeAll(() => {
    driver = createPostgresTenantDriver(env.TENANT_DATABASE_URL, { max: 1 })
  })
  afterAll(async () => {
    await driver?.end()
  })

  it('leaks neither role nor tenant into the next transaction', async () => {
    const pids = new Set<number>()
    for (const me of [A, B, A, B]) {
      const rows = await tenantDb(me.id, { driver }).sql<{ event_slug: string; pid: number }>`
        SELECT event_slug, pg_backend_pid() AS pid FROM public.event_settings`
      expect(rows.map((r) => r.event_slug)).toEqual([me.event])
      for (const r of rows) pids.add(r.pid)
      // The same connection, straight after: back to the bare login, nothing pinned.
      const after = await driver.transaction((tx) =>
        tx.query<{ role: string; tenant: string | null; pid: number }>(
          "SELECT current_user AS role, nullif(current_setting('stellr.tenant_id', true), '') AS tenant, pg_backend_pid() AS pid",
        ),
      )
      expect(after.rows[0]).toMatchObject({ role: 'tenant_app_login', tenant: null })
      pids.add(after.rows[0].pid)
    }
    expect(pids.size).toBe(1)
  })

  it('the bare login reads no tenant table', async () => {
    await expect(
      driver.transaction((tx) => tx.query('SELECT 1 FROM public.event_settings LIMIT 1')),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('the server refuses text holding two statements, with or without values', async () => {
    // 42601: "cannot insert multiple commands into a prepared statement".
    await expect(driver.transaction((tx) => tx.query('SELECT 1; SELECT 2'))).rejects.toMatchObject({ code: '42601' })
    await expect(driver.transaction((tx) => tx.query('SELECT $1::int; SELECT 2', [1]))).rejects.toMatchObject({
      code: '42601',
    })
  })

  it('concurrent calls on a one-connection pool still see only their own tenant', async () => {
    const results = await Promise.all(
      [A, B, A, B, A, B].map(async (me) => ({
        me: me.event,
        seen: (await tenantDb(me.id, { driver }).sql<{ event_slug: string }>`SELECT event_slug FROM public.event_settings`).map(
          (r) => r.event_slug,
        ),
      })),
    )
    for (const r of results) expect(r.seen).toEqual([r.me])
  })
})

describe('tenantDb on a real database: the role taken away', () => {
  it('fails closed when the login may no longer become tenant_app', async () => {
    await admin`REVOKE tenant_app FROM tenant_app_login`
    try {
      await expect(asTenant(A.id).sql`SELECT event_slug FROM public.event_settings`).rejects.toMatchObject({
        code: '42501',
      })
    } finally {
      await admin`GRANT tenant_app TO tenant_app_login`
    }
    expect(await asTenant(A.id).sql`SELECT 1 FROM public.event_settings WHERE event_slug = ${A.event}`).toHaveLength(1)
  })
})
