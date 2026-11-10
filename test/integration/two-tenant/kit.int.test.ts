// The two-tenant kit on a real database (multi-tenancy plan S5, C12). Run by
// CI's tenant-db job only (vitest.integration.config.mts). Proves the kit's
// seed lands per tenant, that each tenant's rows are invisible to the other's
// tenantDb, that expectAreaIsolated passes an area whose paths are scoped and
// FAILS one whose service read is not, and that lib/tenancy/area-switch's
// shadow and tenant modes behave on the real driver.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readAreaWithSeams, TENANT_DB_AREAS_ENV, type ShadowMismatch } from '@/lib/tenancy/area-switch'
import type { TenantDb } from '@/lib/tenancy/db'
import { expectAreaIsolated, openTwoTenantKit, type Seeded, type TwoTenantKit } from './kit'

let kit: TwoTenantKit
let seeded: Seeded
let slugs: string[]

type EmailRow = { id: string; event_slug: string; name: string; status: string }

beforeAll(async () => {
  kit = await openTwoTenantKit()
  seeded = await kit.seed('event_settings', 'event_emails')
  slugs = [kit.stellr.event.slug, kit.stellr.spare.slug, kit.canary.event.slug, kit.canary.spare.slug]
})

afterAll(async () => {
  await kit?.cleanup()
})

const tenantEmails = (db: TenantDb) =>
  db.sql<EmailRow>`
    SELECT id::text AS id, event_slug, name, status FROM public.event_emails
    WHERE event_slug = ANY(${slugs}::text[]) ORDER BY id`

describe('the seed', () => {
  it('writes one row per tenant, each stamped with its own tenant by the derivation trigger', async () => {
    for (const t of [kit.stellr, kit.canary]) {
      const rows = await kit.admin<{ tenant_id: string }[]>`
        SELECT tenant_id::text AS tenant_id FROM public.event_emails WHERE event_slug = ${t.event.slug}`
      expect(rows).toEqual([{ tenant_id: t.id }])
    }
    expect(seeded.event_emails.stellr).toHaveLength(1)
    expect(seeded.event_emails.canary).toHaveLength(1)
    expect(seeded.event_emails.stellr[0]).not.toBe(seeded.event_emails.canary[0])
  })

  it('refuses a table it cannot seed, before writing', async () => {
    await expect(kit.seed('not_a_table')).rejects.toThrow(/no fixture/)
    await expect(kit.seed('community_spaces')).rejects.toThrow(/Stellr's rows only/)
  })

  it("runs the service path as service_role", async () => {
    const [row] = await kit.service((sql) => sql<{ role: string }[]>`SELECT current_user AS role`)
    expect(row.role).toBe('service_role')
  })
})

describe('tenantDb on the kit', () => {
  it("canary rows are invisible to tenantDb(STELLR), and Stellr's to the canary", async () => {
    for (const [me, other] of [
      [kit.stellr, kit.canary],
      [kit.canary, kit.stellr],
    ] as const) {
      const emails = await tenantEmails(kit.asTenant(me.id))
      expect(emails.map((r) => r.id)).toEqual(seeded.event_emails[me.tag])
      expect(emails.map((r) => r.id)).not.toContain(seeded.event_emails[other.tag][0])
      const settings = await kit.asTenant(me.id).sql<{ event_slug: string }>`
        SELECT event_slug FROM public.event_settings WHERE event_slug = ANY(${slugs}::text[])`
      expect(settings.map((r) => r.event_slug)).toEqual([me.event.slug])
    }
  })
})

describe('expectAreaIsolated', () => {
  const area = (scoped: boolean) => ({
    service: (sql: Parameters<Parameters<TwoTenantKit['service']>[0]>[0], tenantId: string) =>
      scoped
        ? sql<EmailRow[]>`
            SELECT id::text AS id, event_slug, name, status FROM public.event_emails
            WHERE tenant_id = ${tenantId} AND event_slug = ANY(${slugs}::text[]) ORDER BY id`
        : sql<EmailRow[]>`
            SELECT id::text AS id, event_slug, name, status FROM public.event_emails
            WHERE event_slug = ANY(${slugs}::text[]) ORDER BY id`,
    tenant: tenantEmails,
    expected: seeded.event_emails,
  })

  it('passes an area whose two paths both keep to the tenant and agree', async () => {
    await expectAreaIsolated(kit, area(true))
  })

  it('fails an area whose service read is missing its tenant filter', async () => {
    await expect(expectAreaIsolated(kit, area(false))).rejects.toThrow(/service path for stellr/)
  })
})

describe('the area switch on the real driver', () => {
  const env = () => ({ ...kit.env, [TENANT_DB_AREAS_ENV]: 'events-config:shadow' })

  async function shadowRead(service: () => Promise<EmailRow[]>) {
    const tasks: (() => Promise<void>)[] = []
    const mismatches: ShadowMismatch[] = []
    const got = await readAreaWithSeams('events-config', {
      tenantId: kit.stellr.id,
      env: env(),
      schedule: (t) => void tasks.push(t),
      onMismatch: (m) => void mismatches.push(m),
      random: () => 0,
      service,
      tenant: tenantEmails,
    })
    for (const t of tasks) await t()
    return { got, mismatches }
  }

  it('shadow: a scoped service read matches the tenant read, and nothing is recorded', async () => {
    const service = () =>
      kit.service((sql) => sql<EmailRow[]>`
        SELECT id::text AS id, event_slug, name, status FROM public.event_emails
        WHERE tenant_id = ${kit.stellr.id} AND event_slug = ANY(${slugs}::text[]) ORDER BY id`).then((r) => [...r])
    const { got, mismatches } = await shadowRead(service)
    expect(got.map((r) => r.id)).toEqual(seeded.event_emails.stellr)
    expect(mismatches).toEqual([])
  })

  it("shadow: an unscoped service read still answers, and the canary row it returned is recorded by id only", async () => {
    const service = () =>
      kit.service((sql) => sql<EmailRow[]>`
        SELECT id::text AS id, event_slug, name, status FROM public.event_emails
        WHERE event_slug = ANY(${slugs}::text[]) ORDER BY id`).then((r) => [...r])
    const { got, mismatches } = await shadowRead(service)
    expect(got).toHaveLength(2)
    expect(mismatches).toEqual([
      expect.objectContaining({ reason: 'count', serviceCount: 2, tenantCount: 1, onlyService: seeded.event_emails.canary, onlyTenant: [] }),
    ])
    expect(JSON.stringify(mismatches)).not.toContain('iso')
  })

  it('tenant: answers from tenantDb for the tenant given', async () => {
    const got = await readAreaWithSeams('events-config', {
      tenantId: kit.canary.id,
      env: { ...kit.env, [TENANT_DB_AREAS_ENV]: 'events-config:tenant' },
      service: async () => {
        throw new Error('the service read must not run in tenant mode')
      },
      tenant: tenantEmails,
    })
    expect(got.map((r) => r.id)).toEqual(seeded.event_emails.canary)
  })
})
