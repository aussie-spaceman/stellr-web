// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { tenantObjectPath, objectTenantId, objectVisibleToTenant } from './storage'
import { STELLR_TENANT_ID } from './constants'

const CANARY = 'c0ffee00-0000-4000-8000-0000000000b2'
const MEMBER = 'c0000000-0000-4000-8000-000000000001'
const TENANTS = [STELLR_TENANT_ID, CANARY]

describe('tenantObjectPath', () => {
  it('puts a new object under the tenant id', () => {
    expect(tenantObjectPath(CANARY, 'event-artwork/nv-2026/badge-1.png')).toBe(`${CANARY}/event-artwork/nv-2026/badge-1.png`)
    expect(tenantObjectPath(CANARY.toUpperCase(), 'a.png')).toBe(`${CANARY}/a.png`)
  })

  it('refuses without a tenant', () => {
    expect(() => tenantObjectPath('', 'a.png')).toThrow(/tenant id/)
    expect(() => tenantObjectPath(undefined as never, 'a.png')).toThrow(/tenant id/)
  })

  it.each(['', '/a.png', 'a/../b.png', 'a//b.png', 'a/%2e%2e/b', 'a\\b', 'a?b', 'a/b/'])('refuses the non-literal path %j', (p) => {
    expect(() => tenantObjectPath(CANARY, p)).toThrow(/literal storage path/)
  })

  it('refuses a path that already starts with an id (no double prefix, no smuggled tenant)', () => {
    expect(() => tenantObjectPath(CANARY, `${STELLR_TENANT_ID}/a.png`)).toThrow(/already starts with an id/)
    expect(() => tenantObjectPath(STELLR_TENANT_ID, `${CANARY}/a.png`)).toThrow(/already starts with an id/)
  })
})

describe('objectTenantId: the same cases the database function is tested on', () => {
  it.each([
    [`${CANARY}/events/badge.png`, CANARY, '{tenant_id}/… belongs to that tenant'],
    [`${STELLR_TENANT_ID}/events/badge.png`, STELLR_TENANT_ID, "Stellr's own prefix"],
    [`${MEMBER}/1700000000000-licence.pdf`, STELLR_TENANT_ID, 'a legacy {member_id}/… path is not a tenant'],
    ['event-artwork/nv-2026/badge.png', STELLR_TENANT_ID, 'a legacy named prefix'],
    [CANARY, STELLR_TENANT_ID, 'a bare id with no object name'],
    [`${CANARY.toUpperCase()}/x.png`, STELLR_TENANT_ID, 'only the canonical lower-case id'],
    [null, STELLR_TENANT_ID, 'null'],
  ] as [string | null, string, string][])('%s -> %s (%s)', (path, want) => {
    expect(objectTenantId(path, TENANTS)).toBe(want)
  })

  it('a tenant prefix for a tenant that does not exist is legacy (Stellr)', () => {
    expect(objectTenantId(`${CANARY}/x.png`, [STELLR_TENANT_ID])).toBe(STELLR_TENANT_ID)
  })

  it('keeps every legacy object Stellr\'s and every tenant object its tenant\'s', () => {
    expect(objectVisibleToTenant(`${MEMBER}/x.pdf`, STELLR_TENANT_ID, TENANTS)).toBe(true)
    expect(objectVisibleToTenant(`${MEMBER}/x.pdf`, CANARY, TENANTS)).toBe(false)
    expect(objectVisibleToTenant(`${CANARY}/x.pdf`, CANARY, TENANTS)).toBe(true)
    expect(objectVisibleToTenant(`${CANARY}/x.pdf`, STELLR_TENANT_ID, TENANTS)).toBe(false)
  })

  it('the pgTAP storage section asserts the same rule against public.storage_object_tenant_id()', () => {
    const sql = readFileSync('supabase/tests/database/tenant_isolation.test.sql', 'utf8')
    expect(sql).toContain("a legacy {member_id}/… path is Stellr''s, not mistaken for a tenant")
    expect(sql).toContain('only the canonical lower-case id counts')
    const migration = readFileSync('supabase/migrations/20261104210000_storage_tenant_prefix.sql', 'utf8')
    expect(migration).toContain(`'${STELLR_TENANT_ID}'::uuid`)
  })
})
