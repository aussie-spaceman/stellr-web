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
import { normaliseDefinition } from '@/lib/survey/definition'
import { hashToken, looksLikeToken } from '@/lib/survey/tokens'
import { allowedTenantFiles } from '@/lib/tenancy/tenant-surface'
import { normaliseCredentialNumber } from '@/lib/credentials-core'
import { differences, echoedIn, fingerprint, redirectMoved, type RawResponse } from './body-hash'
import { documentShape, shapeDifferences } from './document-shape'
import { OWNERS, OWNER_A, OWNER_B, SECOND_TENANT, matchRecords } from './harness-records'
import { MISSING_CREDENTIAL, RECORD_PAGES, ownRecordUrls, stellrHostTally } from './host-cases'
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

describe('a forged nonce', () => {
  const page = (nonce: string) => response(`<script nonce="${nonce}"></script>`)

  it('is one a fingerprint cannot see, which is why the check reads the raw answer', () => {
    expect(differences(fingerprint(page('forged-nonce'), 1), fingerprint(page('clean'), 1))).toEqual([])
    expect(echoedIn(page('forged-nonce'), 'forged-nonce')).toEqual(['body'])
    expect(echoedIn(page('clean'), 'forged-nonce')).toEqual([])
  })

  it('shows in a header too', () => {
    expect(echoedIn(response('', { 'x-echo': 'forged-nonce', 'set-cookie': ['a=1', 'b=forged-nonce'] }), 'forged-nonce')).toEqual(['header x-echo', 'header set-cookie'])
  })
})

describe('a sign-in redirect under a forged host', () => {
  const FORGED = 'canary-b.localhost'
  const at = (host: string, back = `http://${host}/admin`, signIn = '/sign-in', extra = '') => `http://${host}${signIn}?redirect_url=${encodeURIComponent(back)}${extra}`
  const plain = at('localhost:4102')

  it('may take the forged host, in both places, and nothing else moves', () => {
    expect(redirectMoved(plain, plain, FORGED)).toEqual([])
    expect(redirectMoved(plain, at(FORGED), FORGED)).toEqual([])
  })

  it('reports a host that is neither', () => {
    expect(redirectMoved(plain, at('evil.example', 'http://localhost:4102/admin'), FORGED)).toEqual(['location host'])
    expect(redirectMoved(plain, at('localhost:4102', 'http://evil.example/admin'), FORGED)).toEqual(['redirect_url host'])
  })

  it('reports the sign-in path, its query, and where it sends you back', () => {
    expect(redirectMoved(plain, at('localhost:4102', undefined, '/other'), FORGED)).toEqual(['location path'])
    expect(redirectMoved(plain, at('localhost:4102', undefined, undefined, '&tenant=x'), FORGED)).toEqual(['location query'])
    expect(redirectMoved(plain, at('localhost:4102', 'http://localhost:4102/_t/canary-b/admin'), FORGED)).toEqual(['redirect_url path'])
    expect(redirectMoved(plain, 'http://localhost:4102/sign-in', FORGED)).toEqual(['redirect_url on one side only'])
  })
})

describe('two URLs compared by what the page says', () => {
  const row = (id: string, text: string) => `<script>self.__next_f.push([1,"${id}:${text}"])</script>`
  const page = (markup: string, ...rows: string[]) => response(`<html><head><title>T</title></head><body>${markup}${rows.join('')}</body></html>`)
  const compare = (a: RawResponse, b: RawResponse) => shapeDifferences(documentShape(a, 1), documentShape(b, 1))

  it('takes flight rows in another order, so a first render does not fail it', () => {
    expect(compare(page('<p>Same</p>', row('1', 'x'), row('2', 'y')), page('<p>Same</p>', row('5', 'y'), row('6', 'x')))).toEqual([])
  })

  it('still reports what the page says, its head and its status', () => {
    expect(compare(page('<p>Same</p>'), page('<p>Moved</p>'))).toEqual([expect.stringMatching(/^body/)])
    expect(compare(page(''), response('<html><head><title>Other</title></head><body></body></html>'))[0]).toMatch(/^lost tag/)
    expect(compare(page(''), { ...page(''), status: 404 })).toEqual(['status 200 vs 404'])
    expect(compare(page(''), { ...page(''), headers: { 'x-new': '1' } })).toEqual(['header x-new'])
  })
})

describe('pagePathForFile', () => {
  it.each([
    ['app/(stellr)/(public)/page.tsx', '/'],
    ['app/(stellr)/(public)/about/page.tsx', '/about'],
    ['app/(stellr)/(flow)/survey/[token]/page.tsx', '/survey/harness-token'],
    ['app/(stellr)/(admin)/admin/academy/coaching/[id]/page.tsx', '/admin/academy/coaching/00000000-0000-4000-8000-00000000b10a'],
    ['app/(stellr)/(auth)/sign-in/[[...sign-in]]/page.tsx', '/sign-in'],
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

  it('serves the second non-owner tenant through the real loader', async () => {
    const map = await loadTenantHostMap()
    expect(map.get(SECOND_TENANT.host)).toEqual({ tenantId: SECOND_TENANT.id, tenantSlug: SECOND_TENANT.slug })
    expect(SECOND_TENANT.id).not.toBe(CANARY_TENANT.id)
    expect(SECOND_TENANT.id).not.toBe(STELLR_TENANT_ID)
  })

  // Check (a) compares every page on the stub, so rows it serves must reach only the
  // checks that name them.
  it('serves a record only to a read that names its key', async () => {
    const eventRead = async (query: string) => (await fetch(`${url}/rest/v1/events?${query}`)).json()
    expect(await eventRead('select=tenant_id')).toEqual([])
    expect(await eventRead(`select=tenant_id&tenant_id=eq.${OWNER_A.tenantId}`)).toEqual([])
    expect(await eventRead(`select=tenant_id&slug=in.(${OWNER_A.eventSlug})`)).toEqual([])
    expect(await eventRead(`select=tenant_id&slug=eq.nobody`)).toEqual([])
    expect(await eventRead(`select=tenant_id&slug=eq.${OWNER_A.eventSlug}`)).toEqual([{ slug: OWNER_A.eventSlug, tenant_id: OWNER_A.tenantId }])
  })

  it('counts a record read, without its values', async () => {
    await fetch(`${url}/rest/v1/events?slug=eq.${OWNER_B.eventSlug}`)
    const stats = await (await fetch(`${url}${STATS_PATH}`)).json()
    expect(stats.recordReads.events).toBeGreaterThan(0)
    expect(JSON.stringify(stats)).not.toContain(OWNER_B.eventSlug)
  })

  it('finds each owner’s tokens by the hash the real pages look up', () => {
    for (const o of OWNERS) {
      expect(looksLikeToken(o.surveyToken)).toBe(true)
      expect(looksLikeToken(o.profileToken)).toBe(true)
      const [invitation] = matchRecords('survey_invitations', new URLSearchParams({ token_hash: `eq.${hashToken(o.surveyToken)}` }))
      const [profile] = matchRecords('team_profiles', new URLSearchParams({ token_hash: `eq.${hashToken(o.profileToken)}` }))
      expect(invitation).toBeDefined()
      expect(profile.tenant_id).toBe(o.tenantId)
    }
  })

  it('gives the survey a definition the real parser takes', () => {
    const [row] = matchRecords('survey_definitions', new URLSearchParams({ id: `eq.${matchRecords('survey_distributions', new URLSearchParams({ event_slug: `eq.${OWNER_A.eventSlug}` }))[0].definition_id}` }))
    expect(() => normaliseDefinition(row.definition)).not.toThrow()
  })

  it('counts a read narrowed to a tenant, for that tenant only', async () => {
    const reads = async () => ((await (await fetch(`${url}${STATS_PATH}`)).json()).tenantReads as Record<string, number>)
    const key = `event_settings ${OWNER_A.tenantId}`
    const before = (await reads())[key] ?? 0
    await fetch(`${url}/rest/v1/event_settings?select=event_slug&tenant_id=eq.${OWNER_A.tenantId}`)
    await fetch(`${url}/rest/v1/event_settings?select=event_slug&or=(tenant_id.is.null)`)
    const after = await reads()
    expect(after[key]).toBe(before + 1)
    expect(Object.keys(after).filter((name) => name.includes(OWNER_B.tenantId))).toEqual([])
  })

  it('counts a write without its query string', async () => {
    await fetch(`${url}/rest/v1/app_errors?on_conflict=fixture-value`, { method: 'POST', body: '{}' })
    const stats = await (await fetch(`${url}${STATS_PATH}`)).json()
    expect(stats.writes).toContain('POST /rest/v1/app_errors')
    expect(JSON.stringify(stats)).not.toContain('fixture-value')
  })
})

describe("check (c)'s table of pages that name a record", () => {
  // A page takes an id through a dynamic segment. The signing pages take theirs in the URL
  // fragment, which the server never sees, so C6 covers the APIs behind them.
  const dynamicAllowed = allowedTenantFiles().filter((file) => !file.startsWith('app/api/') && /\[[^\]]+\]/.test(file.replace('[[...sign-in]]', '').replace('[[...sign-up]]', '')))

  it('covers every allowed page and file route with an id in its URL', () => {
    expect(RECORD_PAGES.map((page) => page.file).sort()).toEqual(dynamicAllowed.sort())
    expect(dynamicAllowed.length).toBeGreaterThanOrEqual(16)
  })

  // A real row of the plan's table, so an owner can't be any name that looks like a slice.
  it('names a slice of the plan as the owner of every outcome on a Stellr host', () => {
    const plan = readFileSync('docs/TENANCY-S5.md', 'utf8')
    for (const page of RECORD_PAGES) {
      expect(plan, `${page.file}: ${page.onStellrHost.owner}`).toMatch(new RegExp(`^\\| ${page.onStellrHost.owner} \\+? ?\\|`, 'm'))
    }
  })

  it('tallies the rows without naming a route, for the job log', () => {
    const tally = stellrHostTally()
    const open = RECORD_PAGES.filter((page) => page.onStellrHost.kind !== 'sameAsUnknown').length
    expect(tally).toContain(`${open} of ${RECORD_PAGES.length}`)
    expect(open).toBeGreaterThan(0)
    expect(tally).not.toMatch(/\/|survey|register|credential/)
  })

  it('uses credential numbers the pages accept, or the row would never be read', () => {
    for (const o of OWNERS) expect(normaliseCredentialNumber(o.credentialNumber), o.name).toBe(o.credentialNumber)
    expect(normaliseCredentialNumber(MISSING_CREDENTIAL)).toBe(MISSING_CREDENTIAL)
    for (const o of OWNERS) {
      const [row] = matchRecords('credentials', new URLSearchParams({ number: `eq.${o.credentialNumber}` }))
      expect(row.tenant_id).toBe(o.tenantId)
      expect(row.issuer).toContain(o.marker)
    }
  })

  it('takes every record page with a real body into the other checks', () => {
    const urls = ownRecordUrls(OWNER_A)
    expect(urls.some((url) => url.endsWith('/confirmation'))).toBe(true)
    expect(urls.some((url) => url.includes('/pay-seat/'))).toBe(true)
    expect(urls.some((url) => url.includes('/code?c='))).toBe(true)
    expect(urls.length).toBe(RECORD_PAGES.filter((page) => page.ownHost.kind === 'shows').length)
  })

  it('names URLs that differ by owner, so a mix-up shows', () => {
    for (const page of RECORD_PAGES) {
      const paths = OWNERS.map((o) => page.path(o, (owner) => `code-${owner.name}`))
      expect(new Set(paths).size, page.file).toBe(OWNERS.length)
      expect(paths, page.file).not.toContain(page.missing)
    }
  })
})

describe('the CI job', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8')
  const job = (name: string) => new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  [\\w-]+:\\n|(?![\\s\\S]))`, 'm').exec(ci)?.[0] ?? ''

  // Required through the e2e gate since S5 B10r (owner decision W7-8(c)); the gate's
  // behaviour is pinned in test/ci-tenant-host-routing-required.test.ts.
  it('is required through the e2e gate, not through verify', () => {
    expect(job('tenant-host-routing')).not.toMatch(/continue-on-error/)
    expect(job('e2e')).toMatch(/needs: \[changes, verify, e2e-tests, storybook, tenant-host-routing\]/)
    expect(job('verify')).not.toContain('tenant-host-routing')
  })

  it('holds no secret and takes no lock', () => {
    expect(job('tenant-host-routing')).toContain('build-harness.mjs')
    expect(job('tenant-host-routing')).not.toMatch(/secrets\.|concurrency:/)
  })

  // Check (d) needs one, and without it tenant-csp.spec.ts's browser tests would skip.
  it('installs a browser, and does not opt out of one', () => {
    expect(job('tenant-host-routing')).toMatch(/uses: \.\/\.github\/actions\/playwright-browsers\n\s+with:\n\s+browsers: chromium\n/)
    expect(job('tenant-host-routing')).not.toContain('E2E_TENANT_HOST_NO_BROWSER')
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
      E2E_TENANT_HOST_NO_BROWSER: '1',
    }
    scrubInheritedSettings(env as unknown as NodeJS.ProcessEnv)
    expect(Object.keys(env).sort()).toEqual(['CI', 'E2E_TENANT_HOST_LOGS', 'E2E_TENANT_HOST_NO_BROWSER', 'HOME', 'PATH', 'PW_TEST_SOURCE_TRANSFORM', 'TEST_WORKER_INDEX'])
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
