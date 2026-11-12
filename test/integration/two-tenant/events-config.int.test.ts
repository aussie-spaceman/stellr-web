// The 'events-config' area on a real database (multi-tenancy plan S5, C18). Run by CI's
// tenant-db job only (vitest.integration.config.mts), on the two-tenant kit. Proves, through
// the real driver and the tenant row level security policies:
//
//   - the companies read returns only its own tenant's rows on both paths (the service
//     path's filter, as service_role, and the tenantDb read lib/events/admin-config.ts runs),
//     and the two paths agree by the comparison the shadow mode uses;
//   - the read and the writes, called through the area switch in tenant mode exactly as the
//     route calls them, keep to the caller's tenant: another tenant's event reads as empty,
//     a write naming it is refused and lands nothing, and an update naming its company
//     changes nothing;
//   - the same writes on the tenant's own event land, stamped with that tenant.

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  loadEventCompanies,
  renameEventCompany,
  setEventCompanyCount,
  tenantEventCompanies,
  tenantSetCompanyCount,
  tenantSetSettingsCompanyCount,
  type EventCompanyRow,
} from '@/lib/events/admin-config'
import { expectAreaIsolated, openTwoTenantKit, type KitTenant, type Seeded, type TwoTenantKit } from './kit'

let kit: TwoTenantKit
let seeded: Seeded

beforeAll(async () => {
  kit = await openTwoTenantKit()
  seeded = await kit.seed('event_companies', 'event_settings')
})

afterAll(async () => {
  await kit?.cleanup()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

/** The route's service client: tenant mode must never reach it. */
const noService = new Proxy(
  {},
  {
    get() {
      throw new Error('the service path ran in tenant mode')
    },
  },
) as unknown as SupabaseClient

/** Turn the area to tenant mode for this process, on the kit's local login. */
function tenantMode() {
  for (const [k, v] of Object.entries(kit.env)) vi.stubEnv(k, v)
  // TENANT_DB_AREAS (lib/tenancy/area-switch.ts), named here so this file stays off its importers.
  vi.stubEnv('TENANT_DB_AREAS', 'events-config:tenant')
}

const tenantOf = (id: string): KitTenant => (id === kit.stellr.id ? kit.stellr : kit.canary)

/** The service path's filter as service_role: today's supabase-js query, by the event's slug. */
const serviceCompanies = (sql: Parameters<Parameters<TwoTenantKit['service']>[0]>[0], slug: string) =>
  sql<EventCompanyRow[]>`
    SELECT c.id::text AS id, c.number, c.name,
      json_build_array(json_build_object('count',
        (SELECT count(*) FROM public.participants p WHERE p.company_id = c.id))) AS participants
    FROM public.event_companies c WHERE c.event_slug = ${slug} ORDER BY c.number`

const companiesAs = async (slug: string) =>
  kit.admin<{ id: string; number: number; name: string | null; tenant_id: string }[]>`
    SELECT id::text AS id, number, name, tenant_id::text AS tenant_id
    FROM public.event_companies WHERE event_slug = ${slug} ORDER BY number`

describe('the companies read', () => {
  it('returns only its own tenant’s rows on both paths, and the paths agree', async () => {
    await expectAreaIsolated(kit, {
      service: (sql, tenantId) => serviceCompanies(sql, tenantOf(tenantId).event.slug),
      tenant: (db) => tenantEventCompanies(db, tenantOf(db.tenantId).event.slug),
      expected: seeded.event_companies,
    })
  })

  it("tenantDb finds nothing on the other tenant's event, in both directions", async () => {
    for (const [me, other] of [
      [kit.stellr, kit.canary],
      [kit.canary, kit.stellr],
    ] as const) {
      expect(await tenantEventCompanies(kit.asTenant(me.id), other.event.slug)).toEqual([])
      expect((await tenantEventCompanies(kit.asTenant(me.id), me.event.slug)).map((r) => r.id)).toEqual(seeded.event_companies[me.tag])
    }
  })

  it('through the area switch in tenant mode, the route’s own call keeps to the caller’s tenant', async () => {
    tenantMode()
    const own = await loadEventCompanies(noService, kit.canary.id, kit.canary.event.slug)
    expect(own).toEqual([{ id: seeded.event_companies.canary[0], number: 1, name: null, participants: [{ count: 0 }] }])
    expect(await loadEventCompanies(noService, kit.canary.id, kit.stellr.event.slug)).toEqual([])
    expect(await loadEventCompanies(noService, kit.stellr.id, kit.canary.event.slug)).toEqual([])
  })
})

describe('the writes, through the area switch in tenant mode', () => {
  it("a count naming the other tenant's event is refused, and nothing lands", async () => {
    tenantMode()
    const before = await companiesAs(kit.stellr.event.slug)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await setEventCompanyCount(noService, kit.canary.id, kit.stellr.event.slug, 2)).toBe(false)
    expect(await setEventCompanyCount(noService, kit.canary.id, kit.stellr.spare.slug, 2)).toBe(false)
    error.mockRestore()
    expect(await companiesAs(kit.stellr.event.slug)).toEqual(before)
    expect(await companiesAs(kit.stellr.spare.slug)).toEqual([])
    await expect(tenantSetCompanyCount(kit.asTenant(kit.stellr.id), kit.canary.spare.slug, 1)).rejects.toThrow()
    expect(await companiesAs(kit.canary.spare.slug)).toEqual([])
  })

  it("the settings count naming the other tenant's event is refused, and its row is unchanged", async () => {
    const [before] = await kit.admin<{ company_count: number | null }[]>`
      SELECT company_count FROM public.event_settings WHERE event_slug = ${kit.stellr.event.slug}`
    await expect(tenantSetSettingsCompanyCount(kit.asTenant(kit.canary.id), kit.stellr.event.slug, 5)).rejects.toThrow()
    const [after] = await kit.admin<{ company_count: number | null }[]>`
      SELECT company_count FROM public.event_settings WHERE event_slug = ${kit.stellr.event.slug}`
    expect(after).toEqual(before)
  })

  it("a rename naming the other tenant's company changes nothing", async () => {
    tenantMode()
    const before = await companiesAs(kit.stellr.event.slug)
    const target = seeded.event_companies.stellr[0] as string
    // As today's update: an id that matches nothing the caller can see is not an error.
    expect(await renameEventCompany(noService, kit.canary.id, kit.stellr.event.slug, target, 'Taken')).toBe(true)
    expect(await renameEventCompany(noService, kit.canary.id, kit.canary.event.slug, target, 'Taken')).toBe(true)
    expect(await companiesAs(kit.stellr.event.slug)).toEqual(before)
  })

  it('on the tenant’s own event the same calls land, stamped with that tenant', async () => {
    tenantMode()
    for (const t of [kit.stellr, kit.canary]) {
      expect(await setEventCompanyCount(noService, t.id, t.spare.slug, 3)).toBe(true)
      let rows = await companiesAs(t.spare.slug)
      expect(rows.map((r) => [r.number, r.tenant_id])).toEqual([
        [1, t.id],
        [2, t.id],
        [3, t.id],
      ])
      const [settings] = await kit.admin<{ company_count: number; tenant_id: string }[]>`
        SELECT company_count, tenant_id::text AS tenant_id FROM public.event_settings WHERE event_slug = ${t.spare.slug}`
      expect(settings).toEqual({ company_count: 3, tenant_id: t.id })

      expect(await renameEventCompany(noService, t.id, t.spare.slug, rows[1].id, 'Apollo')).toBe(true)
      expect(await setEventCompanyCount(noService, t.id, t.spare.slug, 2)).toBe(true)
      rows = await companiesAs(t.spare.slug)
      expect(rows.map((r) => [r.number, r.name])).toEqual([
        [1, null],
        [2, 'Apollo'],
      ])
      // The read the route makes sees the result.
      expect((await loadEventCompanies(noService, t.id, t.spare.slug)).map((r) => r.number)).toEqual([1, 2])
    }
  })
})
