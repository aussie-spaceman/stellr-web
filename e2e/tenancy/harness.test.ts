// @vitest-environment node
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadTenantHostMap } from '@/lib/tenancy/host'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { CANARY_TENANT } from '@/lib/testing/honeytokens'
import { ROUTE_MANIFEST } from '@/lib/security/route-manifest'
import { differences, fingerprint, type RawResponse } from './body-hash'
import { createHostMapStub } from './host-map-stub'
import { pageFiles, pagePathForFile } from './page-routes'
import {
  STATS_PATH,
  STUB_URL,
  assertHarnessBuild,
  assertNoEnvFiles,
  harnessServerEnv,
  scrubInheritedSettings,
  writeHarnessMarker,
} from './harness-env.mjs'

function response(body: string, headers: RawResponse['headers'] = {}, status = 200): RawResponse {
  return { status, headers, body }
}

describe('fingerprint', () => {
  it('masks a per-request nonce, in the attribute and in the flight data', () => {
    const page = (nonce: string) =>
      response(`<script nonce="${nonce}"></script><script>self.__next_f.push(["nonce":"${nonce}"])</script>`, {
        'content-security-policy-report-only': `script-src 'nonce-${nonce}'`,
      })
    expect(differences(fingerprint(page('aaaa'), 1), fingerprint(page('bbbb'), 1))).toEqual([])
  })

  it("masks each server's own port, and no other number", () => {
    const at = (port: number, extra = '') => response(`http://localhost:${port}/x${extra}`, { location: `http://localhost:${port}/y` }, 307)
    expect(differences(fingerprint(at(4101), 4101), fingerprint(at(4102), 4102))).toEqual([])
    expect(differences(fingerprint(at(4101), 4101), fingerprint(at(4103), 4102))).not.toEqual([])
  })

  it('reports a different body, even one of the same length', () => {
    expect(differences(fingerprint(response('Stellr'), 1), fingerprint(response('Canary'), 1))).toEqual(['body (6 vs 6 chars)'])
  })

  it('reports a different status', () => {
    const a = fingerprint(response('', {}, 200), 1)
    const b = fingerprint(response('', {}, 404), 1)
    expect(differences(a, b)).toEqual(['status 200 vs 404'])
  })

  it('reports a different redirect target', () => {
    const a = fingerprint(response('', { location: '/one' }, 307), 1)
    const b = fingerprint(response('', { location: '/two' }, 307), 1)
    expect(differences(a, b)).toEqual(['header location'])
  })

  it('reports a header only one side has, so anything routing adds shows', () => {
    const a = fingerprint(response(''), 1)
    const b = fingerprint(response('', { 'x-stellr-tenant-id': 'x' }), 1)
    expect(differences(a, b)).toEqual(['header x-stellr-tenant-id'])
  })

  it('does not mask a nonce the policy did not name', () => {
    const page = (word: string) => response(word, { 'content-security-policy-report-only': "script-src 'nonce-abc'" })
    expect(differences(fingerprint(page('abc'), 1), fingerprint(page('abd'), 1))).not.toEqual([])
  })
})

describe('pagePathForFile', () => {
  it.each([
    ['app/(public)/page.tsx', '/'],
    ['app/(public)/about/page.tsx', '/about'],
    ['app/(flow)/survey/[token]/page.tsx', '/survey/harness-token'],
    ['app/(admin)/admin/academy/coaching/[id]/page.tsx', '/admin/academy/coaching/00000000-0000-4000-8000-00000000b10a'],
    ['app/(auth)/sign-in/[[...sign-in]]/page.tsx', '/sign-in'],
    ['app/%5Ft/[tenant]/[...rest]/page.tsx', '/_t/harness-tenant/harness-rest'],
  ])('%s is %s', (file, path) => {
    expect(pagePathForFile(file)).toBe(path)
  })
})

describe('pageFiles', () => {
  const files = pageFiles()

  // The manifest's own test holds it to the tree, so this holds the walk to both.
  it('finds every page the route manifest lists', () => {
    const listed = Object.keys(ROUTE_MANIFEST).filter((file) => file.endsWith('/page.tsx')).sort()
    expect(files).toEqual(listed)
  })

  it('gives every page its own URL', () => {
    const paths = files.map(pagePathForFile)
    expect(new Set(paths).size).toBe(paths.length)
  })
})

describe('the stub', () => {
  const server = createHostMapStub()
  let url = ''

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', url)
    vi.stubEnv('SUPABASE_SECRET_KEY', 'harness-secret-key')
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    await new Promise((resolve) => server.close(resolve))
  })

  // Through the real loader: if its query or row parsing moves, the harness must too.
  it("serves the seed's hosts in the shape the real loader reads", async () => {
    const map = await loadTenantHostMap()
    expect(map.get(CANARY_TENANT.host)).toEqual({ tenantId: CANARY_TENANT.id, tenantSlug: CANARY_TENANT.slug })
    expect(map.get('stellr.localhost')?.tenantId).toBe(STELLR_TENANT_ID)
    expect(map.get('nobody.localhost')).toBeUndefined()
  })

  it('answers other reads with no rows, and refuses `.single()` as PostgREST does', async () => {
    expect(await (await fetch(`${url}/rest/v1/members?select=id`)).json()).toEqual([])
    const single = await fetch(`${url}/rest/v1/members?select=id`, { headers: { Accept: 'application/vnd.pgrst.object+json' } })
    expect(single.status).toBe(406)
  })

  it('counts a write without its query string', async () => {
    await fetch(`${url}/rest/v1/app_errors?on_conflict=fixture-value`, { method: 'POST', body: '{}' })
    const stats = await (await fetch(`${url}${STATS_PATH}`)).json()
    expect(stats.writes).toContain('POST /rest/v1/app_errors')
    expect(JSON.stringify(stats)).not.toContain('fixture-value')
  })
})

describe('the CI job', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8')
  const job = (name: string) => new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  [\\w-]+:\\n|(?![\\s\\S]))`, 'm').exec(ci)?.[0] ?? ''

  it('reports only, until the owner makes it required', () => {
    expect(job('tenant-host-routing')).toMatch(/^ {4}continue-on-error: true$/m)
    expect(job('e2e')).toMatch(/needs: \[changes, verify, e2e-tests, storybook\]/)
    expect(job('verify')).not.toContain('tenant-host-routing')
  })

  it('holds no secret and takes no lock', () => {
    expect(job('tenant-host-routing')).toContain('build-harness.mjs')
    expect(job('tenant-host-routing')).not.toMatch(/secrets\.|concurrency:/)
  })
})

describe('harness safety', () => {
  it('differs between the servers only in the routing settings', () => {
    const off = harnessServerEnv(false)
    const on = harnessServerEnv(true)
    const changed = Object.keys(on).filter((name) => on[name as keyof typeof on] !== off[name as keyof typeof off])
    expect(changed.sort()).toEqual(['TENANT_HOST_SUFFIX', 'TENANT_ROUTING_ENABLED'])
    expect(on.TENANT_ROUTING_ENABLED).toBe('true')
    expect(off.TENANT_ROUTING_ENABLED).not.toBe('true')
  })

  it('points the servers at this machine', () => {
    expect(new URL(harnessServerEnv(true).NEXT_PUBLIC_SUPABASE_URL).hostname).toBe('127.0.0.1')
  })

  it.each(['.env', '.env.local', '.env.production', '.env.production.local', '.env.test', '.env.test.local'])(
    'refuses to run beside %s, which Next would load settings from',
    (name) => {
      expect(() => assertNoEnvFiles((file) => String(file) === name)).toThrow(name)
    },
  )

  it('runs with no env file beside it', () => {
    expect(() => assertNoEnvFiles(() => false)).not.toThrow()
  })

  it('keeps only what the tools need, so a key under a name nobody listed is dropped', () => {
    const env: Record<string, string> = {
      NEXT_PUBLIC_SUPABASE_URL: 'x',
      TENANT_ROUTING_ENABLED: 'true',
      SANITY_API_TOKEN: 'x',
      HUBSPOT_ACCESS_TOKEN: 'x',
      CRON_SECRET: 'x',
      GITHUB_TOKEN: 'x',
      npm_config__authToken: 'x',
      A_SERVICE_NOBODY_HAS_HEARD_OF_KEY: 'x',
      NODE_ENV: 'test',
      PATH: '/bin',
      HOME: '/home',
      CI: 'true',
      TEST_WORKER_INDEX: '0',
      PW_TEST_SOURCE_TRANSFORM: 'x',
      E2E_TENANT_HOST_LOGS: '1',
    }
    scrubInheritedSettings(env as unknown as NodeJS.ProcessEnv)
    expect(Object.keys(env).sort()).toEqual(['CI', 'E2E_TENANT_HOST_LOGS', 'HOME', 'PATH', 'PW_TEST_SOURCE_TRANSFORM', 'TEST_WORKER_INDEX'])
  })

  describe('the build refusal', () => {
    let dir = ''
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'tenant-harness-'))
      writeFileSync(join(dir, 'BUILD_ID'), 'build-one\n')
    })
    afterEach(() => rmSync(dir, { recursive: true, force: true }))

    const writeMarker = (marker: unknown) => writeFileSync(join(dir, 'tenant-host-harness.json'), JSON.stringify(marker))

    it('accepts the build it marked', () => {
      writeHarnessMarker(dir)
      expect(() => assertHarnessBuild(dir)).not.toThrow()
    })

    it('refuses a build with no marker', () => {
      expect(() => assertHarnessBuild(dir)).toThrow(/not the tenant-host harness's build/)
    })

    it('refuses when there is no build at all', () => {
      expect(() => assertHarnessBuild(join(dir, 'missing'))).toThrow(/not the tenant-host harness's build/)
    })

    it('refuses a marker left over from another build', () => {
      writeMarker({ buildId: 'build-two', supabaseUrl: STUB_URL })
      expect(() => assertHarnessBuild(dir)).toThrow(/does not match/)
    })

    it('refuses a marker naming another database', () => {
      writeMarker({ buildId: 'build-one', supabaseUrl: 'https://elsewhere.example' })
      expect(() => assertHarnessBuild(dir)).toThrow(/does not match/)
    })
  })
})

// The servers differ at run time only. On a Vercel project the flag is also set
// at build, so code that read it while prerendering would change a live page with
// check (a) still green. These hold the readers to where that cannot happen.
describe('who reads the routing flag', () => {
  const FLAG = /TENANT_ROUTING_ENABLED|TENANT_HOST_SUFFIX|tenantRoutingConfig/

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full)
      return /\.tsx?$/.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name) ? [full] : []
    })
  }
  const readers = (dir: string) => sourceFiles(dir).filter((file) => FLAG.test(readFileSync(file, 'utf8')))

  it('no page, layout or component of Stellr reads it', () => {
    const app = readers('app').filter((file) => !file.startsWith(join('app', '%5Ft')) && !file.startsWith(join('app', 'api')))
    expect([...app, ...readers('components'), ...readers('packages')]).toEqual([])
  })

  it('in lib, only the tenancy edge reads it', () => {
    expect(readers('lib').filter((file) => !file.startsWith(join('lib', 'tenancy')))).toEqual([])
  })
})
