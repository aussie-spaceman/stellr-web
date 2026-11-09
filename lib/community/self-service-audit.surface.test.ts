// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tenantSurfaceDecision } from '@/lib/tenancy/tenant-surface'

// docs/TENANCY-S5.md, B16: a member or community route that leaves its audit tenant to
// selfServiceEvent's default writes to Stellr's chain. That is right only while the route
// never answers on a tenant host. When a route under app/api/members moves from pending
// to allow (lib/tenancy/tenant-surface), its audit chain has to be settled in the same
// change: this test fails until the route names its tenant itself.

function routeFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...routeFiles(path))
    else if (name === 'route.ts') out.push(path)
  }
  return out
}

const audited = ['app/api/members', 'app/api/community']
  .flatMap(routeFiles)
  .filter((file) => readFileSync(file, 'utf8').includes("from '@/lib/community/self-service-audit'"))

/** Routes that leave the audit tenant to the Stellr default while a tenant host can reach them. */
function defaultChainOnTenantHost(files: string[], decide = tenantSurfaceDecision): string[] {
  return files.filter((file) => {
    const decision = decide(file)
    if (decision !== 'allow' && decision !== 'bypass') return false
    return !/\btenant:\s*\{/.test(readFileSync(file, 'utf8'))
  })
}

describe('the Stellr default chain for member and community audit rows', () => {
  it('finds the audited routes', () => {
    expect(audited.length).toBeGreaterThan(40)
  })

  it('applies to no route a tenant host can reach', () => {
    expect(defaultChainOnTenantHost(audited)).toEqual([])
  })

  it('flags a route as soon as it is allowed on a tenant host', () => {
    const file = 'app/api/members/me/route.ts'
    expect(audited).toContain(file)
    expect(defaultChainOnTenantHost([file], () => 'allow')).toEqual([file])
    expect(defaultChainOnTenantHost([file], () => 'pending')).toEqual([])
  })
})
