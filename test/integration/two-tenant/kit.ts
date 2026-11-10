// The two-tenant kit (multi-tenancy plan S5, C12): a seed and helpers for a
// converted area's integration test, on a real database, to prove the area
// returns only its own tenant's rows on BOTH paths, the service read it keeps
// and the tenantDb read it gains, and that the two paths agree.
//
// Built from the pgTAP matrix's fixtures (scripts/gen-tenant-isolation-pgtap.mjs):
// the same two tenants (Stellr, and the matrix's canary tenant), the same
// events, and one FIXTURES row per tenant for each table a test asks for. Run
// by CI's tenant-db job only (vitest.integration.config.mts), with the two
// connection strings that job provides:
//
//   TENANT_DB_TEST_URL        as tenant_app_login: what tenantDb uses
//   TENANT_DB_TEST_ADMIN_URL  as the local owner: fixtures, cleanup, and the
//                             service path, which runs as service_role
//                             (SET LOCAL ROLE), the role the app's
//                             service-role client has
//
// Both must point at this machine; openTwoTenantKit refuses anything else
// before it writes.
//
// The service path here is SQL, not supabase-js: the job runs Postgres
// without PostgREST. A test writes it to the filter its area's supabase-js
// query uses, so it proves what that filter returns as service_role; the
// area's own unit tests prove the supabase-js query has that filter.
//
// Usage, in test/integration/two-tenant/<area>.int.test.ts:
//
//   const kit = await openTwoTenantKit()
//   const seeded = await kit.seed('event_settings', 'event_emails')
//   await expectAreaIsolated(kit, {
//     service: (sql, tenantId) => sql`SELECT … WHERE tenant_id = ${tenantId}`,
//     tenant: (db) => db.sql`SELECT …`,
//     expected: { stellr: seeded.event_emails.stellr, canary: seeded.event_emails.canary },
//   })
//   await kit.cleanup()

import postgres from 'postgres'
import { expect } from 'vitest'
import { compareRows, type CompareOptions } from '@/lib/tenancy/area-switch'
import { tenantDb, TENANT_DB_FLAG, type TenantDb } from '@/lib/tenancy/db'
import { endTenantDrivers, parsePostgresUrl, parseTenantDatabaseUrl } from '@/lib/tenancy/driver'
import { STELLR_ONLY_CHECKS } from '@/lib/tenancy/registry'
import { CANARY_TENANT_ID, FIXTURES, TENANTS } from '../../../scripts/gen-tenant-isolation-pgtap.mjs'

export type KitTag = 'stellr' | 'canary'

export interface KitTenant {
  tag: KitTag
  id: string
  /** The event the seeded rows hang off, and a second one for inserts a test makes. */
  event: { slug: string; sanity: string }
  spare: { slug: string; sanity: string }
}

/** Ids (or, for a table without an id column, null entries) of the rows seed() wrote, per tenant. */
export type Seeded = Record<string, Record<KitTag, (string | null)[]>>

export interface TwoTenantKit {
  stellr: KitTenant
  canary: KitTenant
  /** Owner connection: fixtures and checks. RLS does not bind it. */
  admin: postgres.Sql
  /** Environment that turns tenantDb on against the local login. */
  env: Record<string, string>
  /** tenantDb for one tenant, through the real driver. */
  asTenant(tenantId: string): TenantDb
  /** Run `fn` in a transaction as service_role, the role the app's service-role client has. */
  service<T>(fn: (sql: postgres.TransactionSql) => Promise<T>): Promise<T>
  /** One FIXTURES row per tenant in each table, in the order given (parents first). */
  seed(...tables: string[]): Promise<Seeded>
  /** Delete what the kit wrote, then its events and the canary tenant. Never throws. */
  cleanup(): Promise<void>
}

const MAP: Record<KitTag, 'a' | 'b'> = { stellr: 'a', canary: 'b' }

/**
 * A connection string that points at this machine, read by the driver's own
 * parser (one '@', no host list, no query parameter but sslmode), so the host
 * checked is the host dialled. Throws before anything connects.
 */
export function assertLocalUrl(name: string, raw: string | undefined, check = parsePostgresUrl) {
  if (!raw) throw new Error(`${name} is not set: the two-tenant kit runs in CI's tenant-db job against a local database`)
  const parsed = check(raw, name)
  if (!parsed.local) throw new Error(`${name} must point at this machine`)
  return parsed
}

/** Far enough ahead that the eligibility checks pass an adult on either tenant's event (as the matrix does). */
const EVENT_STARTS_AT = '2040-06-01T00:00:00Z'

const qualified = (table: string) => (table.includes('.') ? table : `public.${table}`)

/**
 * Seed both tenants' events and return the kit. The canary tenant is the
 * matrix's (`iso-canary`); Stellr's row comes from the migrations and is
 * never written.
 */
export async function openTwoTenantKit(): Promise<TwoTenantKit> {
  const loginUrl = assertLocalUrl('TENANT_DB_TEST_URL', process.env.TENANT_DB_TEST_URL, parseTenantDatabaseUrl).url
  const owner = assertLocalUrl('TENANT_DB_TEST_ADMIN_URL', process.env.TENANT_DB_TEST_ADMIN_URL)
  // The checked parts, never the string (see lib/tenancy/driver.ts).
  const admin = postgres({
    host: owner.host,
    port: owner.port,
    user: owner.user,
    pass: owner.password,
    database: owner.database,
    ssl: false,
    max: 1,
    onnotice: () => {},
  })
  const env = { [TENANT_DB_FLAG]: 'true', TENANT_DATABASE_URL: loginUrl }
  const tenant = (tag: KitTag): KitTenant => {
    const t = TENANTS[MAP[tag]]
    return { tag, id: t.id, event: t.primary, spare: t.secondary }
  }
  const stellr = tenant('stellr')
  const canary = tenant('canary')
  const seededTables: string[] = []
  const seededIds = new Map<string, string[]>()

  const [{ n }] = await admin<{ n: number }[]>`SELECT count(*)::int AS n FROM public.tenants WHERE id = ${stellr.id}`
  if (n !== 1) throw new Error("Stellr's tenant row is missing: the database was not built from the migrations")
  await admin`
    INSERT INTO public.tenants (id, slug, legal_name, display_name, country, payment_region, currency, time_zone)
    VALUES (${CANARY_TENANT_ID}, 'iso-canary', 'Iso Canary Pty Ltd', 'Iso Canary', 'AU', 'AU', 'aud', 'Australia/Sydney')
    ON CONFLICT (id) DO NOTHING`
  for (const t of [stellr, canary]) {
    for (const ev of [t.event, t.spare]) {
      await admin`
        INSERT INTO public.events (tenant_id, slug, sanity_id, title, starts_at, time_zone, country, currency, grade_system)
        VALUES (${t.id}, ${ev.slug}, ${ev.sanity}, 'Iso event', ${EVENT_STARTS_AT}::timestamptz, 'UTC', 'US', 'usd', 'us_grades')
        ON CONFLICT DO NOTHING`
      const [row] = await admin<{ tenant_id: string }[]>`SELECT tenant_id::text AS tenant_id FROM public.events WHERE slug = ${ev.slug}`
      if (row?.tenant_id !== t.id) throw new Error(`event ${ev.slug} exists for another tenant: clean the database first`)
    }
  }

  const slugs = [stellr, canary].flatMap((t) => [t.event.slug, t.spare.slug])
  const sanityIds = [stellr, canary].flatMap((t) => [t.event.sanity, t.spare.sanity])

  return {
    stellr,
    canary,
    admin,
    env,
    asTenant: (tenantId) => tenantDb(tenantId, { env }),
    service: (fn) =>
      admin.begin(async (sql) => {
        await sql`SET LOCAL ROLE service_role`
        return fn(sql)
      }) as Promise<never>,

    async seed(...tables) {
      const out: Seeded = {}
      for (const raw of tables) {
        const table = qualified(raw)
        const fixture = (FIXTURES as Record<string, (c: unknown) => Record<string, string>>)[table]
        if (!fixture) throw new Error(`${table}: no fixture in scripts/gen-tenant-isolation-pgtap.mjs (not a tenant table?)`)
        if (STELLR_ONLY_CHECKS.some((c) => c.table === table)) {
          throw new Error(`${table}: holds Stellr's rows only (a CHECK refuses another tenant's), so the kit cannot seed it`)
        }
        out[raw] = { stellr: [], canary: [] }
        for (const t of [stellr, canary]) {
          const tag = MAP[t.tag]
          // The generator's SQL expressions: fixed test literals, never input.
          const cols = fixture({ tag, t: TENANTS[tag], ev: t.event, s: `${tag}-kit`, seed: true })
          const names = Object.keys(cols)
          const text =
            `INSERT INTO ${table} AS r (${names.join(', ')}) VALUES (${names.map((c) => cols[c]).join(', ')}) ` +
            `RETURNING (to_jsonb(r) ->> 'id') AS id, r.tenant_id::text AS tenant_id`
          let rows: { id: string | null; tenant_id: string | null }[]
          try {
            rows = await admin.unsafe(text)
          } catch (err) {
            const code = (err as { code?: string }).code ?? 'unknown'
            throw new Error(`seeding ${table} for ${t.tag} failed (${code}): list its parent tables first`)
          }
          if (rows[0]?.tenant_id !== t.id) throw new Error(`${table}: the ${t.tag} row was stamped with another tenant`)
          out[raw][t.tag].push(rows[0].id)
          if (rows[0].id) seededIds.set(table, [...(seededIds.get(table) ?? []), rows[0].id])
        }
        if (!seededTables.includes(table)) seededTables.push(table)
      }
      return out
    },

    async cleanup() {
      // Children first: the reverse of the order seeded. Each step on its own,
      // so one failure does not leave the rest behind.
      for (const table of [...seededTables].reverse()) {
        const ids = seededIds.get(table) ?? []
        await admin
          .unsafe(
            `DELETE FROM ${table} AS r WHERE (to_jsonb(r) ->> 'id') = ANY($1::text[])
               OR (to_jsonb(r) ->> 'tenant_id') = $2
               OR (to_jsonb(r) ->> 'event_slug') = ANY($3::text[])
               OR (to_jsonb(r) ->> 'event_ref') = ANY($4::text[])
               OR (to_jsonb(r) ->> 'sanity_event_id') = ANY($4::text[])`,
            [ids, CANARY_TENANT_ID, slugs, sanityIds],
          )
          .catch(() => {})
      }
      await admin`DELETE FROM public.events WHERE slug = ANY(${slugs}::text[])`.catch(() => {})
      await admin`DELETE FROM public.tenants WHERE id = ${CANARY_TENANT_ID}`.catch(() => {})
      await endTenantDrivers().catch(() => {})
      await admin.end({ timeout: 5 }).catch(() => {})
    },
  }
}

export interface AreaUnderTest<R> extends CompareOptions<R> {
  /** The service read, as service_role, for one tenant: the filter the area's supabase-js query uses. */
  service: (sql: postgres.TransactionSql, tenantId: string) => Promise<readonly R[]>
  /** The tenantDb read the area adds (the tenant is pinned by tenantDb). */
  tenant: (db: TenantDb) => Promise<R[]>
  /** The ids each tenant owns among the rows these reads can return. */
  expected: Record<KitTag, readonly (string | null)[]>
}

const idOf = <R>(opts: CompareOptions<R>, row: R): unknown =>
  opts.key ? opts.key(row) : (row as Record<string, unknown> | null)?.id

/**
 * For each tenant: both paths return exactly that tenant's expected ids, none
 * of the other tenant's, and the same rows as each other (by the comparison
 * the shadow mode uses). Fails the running test otherwise.
 */
export async function expectAreaIsolated<R>(kit: TwoTenantKit, area: AreaUnderTest<R>): Promise<void> {
  const ids = (rows: readonly R[]) => rows.map((r) => String(idOf(area, r))).sort()
  for (const [me, other] of [
    [kit.stellr, kit.canary],
    [kit.canary, kit.stellr],
  ] as const) {
    const own = area.expected[me.tag].map(String).sort()
    const theirs = area.expected[other.tag].map(String)
    expect(own.length, `the kit seeded no ${me.tag} rows for this area`).toBeGreaterThan(0)

    const viaService = [...(await kit.service((sql) => area.service(sql, me.id)))]
    const viaTenant = await area.tenant(kit.asTenant(me.id))

    expect(ids(viaService), `service path for ${me.tag}`).toEqual(own)
    expect(ids(viaTenant), `tenantDb path for ${me.tag}`).toEqual(own)
    for (const id of theirs) {
      expect(ids(viaService), `service path for ${me.tag} returned a ${other.tag} row`).not.toContain(id)
      expect(ids(viaTenant), `tenantDb path for ${me.tag} returned a ${other.tag} row`).not.toContain(id)
    }
    expect(
      compareRows(viaService, viaTenant, { key: area.key, normalise: area.normalise, showIds: area.showIds }),
      `paths disagree for ${me.tag}`,
    ).toBeNull()
  }
}
