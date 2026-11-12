// @vitest-environment node
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  bypassHeadersFor,
  canaryHostFor,
  connectAddress,
  DEV_DEPLOYMENT_HOST,
  ENFORCING,
  FIXED_PATHS,
  FIXED_POLICY,
  fixedHeaderProblems,
  headerBases,
  NONCE_PATHS,
  noncePageProblems,
  originOf,
  policies,
  PRODUCTION_HOSTS,
  rawRequest,
  REPORT_ONLY,
  runHeaderChecks,
  stellrControlProblems,
} from './tenant-host-headers.mjs'
import { DEV_DEPLOYMENT_HOST as SCENARIO_DEV_DEPLOYMENT_HOST, PRODUCTION_HOSTS as SCENARIO_PRODUCTION_HOSTS } from '../../lib/testing/canary-flow-scenarios'
import { canaryHosts } from '../../lib/testing/canary-flow-seed'

type Res = { status: number; headers: Record<string, string | string[] | undefined>; body: string }

const NONCE_POLICY = "script-src 'nonce-placeholderNonce1' 'strict-dynamic'; object-src 'none'; frame-ancestors 'none'"
const page = (headers: Res['headers'], body = '<script nonce="placeholderNonce1"></script><script nonce="placeholderNonce1" src="/a.js"></script>'): Res => ({
  status: 200,
  headers,
  body,
})

describe('the checks', () => {
  it("hold the fixed header to next.config.mjs's, and the production hosts to the runner's", () => {
    expect(readFileSync('next.config.mjs', 'utf8')).toContain(`value: "${FIXED_POLICY}"`)
    expect(PRODUCTION_HOSTS).toEqual(SCENARIO_PRODUCTION_HOSTS)
    expect(DEV_DEPLOYMENT_HOST.source).toBe(SCENARIO_DEV_DEPLOYMENT_HOST.source)
    for (const zone of ['localhost', 'dev-zone.example', ' Dev-Zone.Example. ']) expect(canaryHostFor(zone), zone).toBe(canaryHosts(zone).mapped)
    expect(NONCE_PATHS).toEqual(['/sign', '/survey/x'])
    expect(FIXED_PATHS.map((p) => p.split('/')[1] + (p.startsWith('/api') ? `/${p.split('/')[2]}` : ''))).toEqual(['_next', 'api/img', 'api/csp-report'])
  })

  it('count the policies a header carries, joined or repeated', () => {
    expect(policies(undefined)).toEqual([])
    expect(policies(NONCE_POLICY)).toHaveLength(1)
    expect(policies(`${NONCE_POLICY}, ${FIXED_POLICY}`)).toHaveLength(2)
    expect(policies([NONCE_POLICY, FIXED_POLICY])).toHaveLength(2)
  })

  it('pass a nonce page with one enforcing policy and every script carrying its nonce', () => {
    expect(noncePageProblems(page({ [ENFORCING]: NONCE_POLICY }))).toEqual([])
  })

  it('fail a nonce page with no policy, two, the wrong start, a report-only policy, or a bare script', () => {
    expect(noncePageProblems(page({}))).toEqual(['0 enforcing policies, not exactly one'])
    expect(noncePageProblems(page({ [ENFORCING]: [NONCE_POLICY, NONCE_POLICY] }))).toEqual(['2 enforcing policies, not exactly one'])
    expect(noncePageProblems(page({ [ENFORCING]: "default-src 'self'" }))[0]).toMatch(/does not start with script-src/)
    expect(noncePageProblems(page({ [ENFORCING]: NONCE_POLICY, [REPORT_ONLY]: NONCE_POLICY }))).toEqual(['a report-only policy is set as well'])
    expect(noncePageProblems(page({ [ENFORCING]: NONCE_POLICY }, '<script nonce="placeholderNonce1"></script><script src="/x.js"></script>'))).toEqual([
      "1 script tag(s) without the policy's nonce",
    ])
  })

  it('pass only the fixed header on what skips the proxy, and never on Stellr', () => {
    expect(fixedHeaderProblems(page({ [ENFORCING]: FIXED_POLICY }))).toEqual([])
    expect(fixedHeaderProblems(page({}))).toEqual(['0 enforcing policies, not exactly one'])
    expect(fixedHeaderProblems(page({ [ENFORCING]: NONCE_POLICY }))).toEqual(['the enforcing policy is not the fixed one'])
    expect(fixedHeaderProblems(page({ [ENFORCING]: [FIXED_POLICY, FIXED_POLICY] }))).toHaveLength(1)
    expect(stellrControlProblems(page({}))).toEqual([])
    expect(stellrControlProblems(page({ [ENFORCING]: FIXED_POLICY }))).toHaveLength(1)
  })

  it("refuse Stellr's production hosts", () => {
    for (const host of PRODUCTION_HOSTS) expect(() => originOf(`https://${host}`, '--base')).toThrow(/production host/)
    expect(originOf('https://canary.dev-zone.example/x?y=1', '--base').href).toBe('https://canary.dev-zone.example/')
    expect(() => originOf(undefined, '--base')).toThrow(/required/)
    expect(() => originOf('ftp://x', '--base')).toThrow(/http or https/)
  })

  it("take the canary host under --zone, and as the control this machine or the dev deployment only, as the runner's", () => {
    const local = headerBases({ base: 'http://canary.localhost:3000', stellrBase: 'http://localhost:3000', zone: 'localhost' })
    expect([local.tenant.origin, local.stellr?.origin]).toEqual(['http://canary.localhost:3000', 'http://localhost:3000'])
    const hosted = headerBases({ base: 'https://canary.dev-zone.example', stellrBase: 'https://stellr-web-dev-git-dev-team.vercel.app', zone: 'dev-zone.example' })
    expect(hosted.stellr?.hostname).toBe('stellr-web-dev-git-dev-team.vercel.app')
    expect(headerBases({ base: 'https://canary.dev-zone.example', zone: 'dev-zone.example' }).stellr).toBeNull()
    // A host outside the zone, a typo, or the zone missing.
    expect(() => headerBases({ base: 'https://canary.stellr-dev.example', zone: 'dev-zone.example' })).toThrow(/canary host for --zone/)
    expect(() => headerBases({ base: 'https://nobody.dev-zone.example', zone: 'dev-zone.example' })).toThrow(/canary host for --zone/)
    expect(() => headerBases({ base: 'https://canary.dev-zone.example' })).toThrow(/--zone is required/)
    expect(() => headerBases({ base: 'https://canary.dev-zone.example', zone: 'bad zone' })).toThrow(/DNS name/)
    // Production, the production project's own vercel.app aliases, and anything else.
    for (const stellrBase of ['https://stellr-web.vercel.app', 'https://stellr-web-git-main-team.vercel.app', 'https://elsewhere.example', 'https://www.stellreducation.org']) {
      expect(() => headerBases({ base: 'https://canary.dev-zone.example', stellrBase, zone: 'dev-zone.example' }), stellrBase).toThrow(/refusing/)
    }
    expect(() => headerBases({ base: 'https://www.stellreducation.org', zone: 'stellreducation.org' })).toThrow(/production host/)
  })

  it('connect only to this machine', () => {
    expect(connectAddress(undefined)).toBeUndefined()
    expect(connectAddress('')).toBeUndefined()
    expect(connectAddress('127.0.0.1')).toBe('127.0.0.1')
    expect(connectAddress('[::1]')).toBe('::1')
    expect(connectAddress('localhost')).toBe('localhost')
    for (const a of ['76.76.21.21', '10.0.0.5', 'stellr-web-dev.vercel.app', 'canary.dev-zone.example']) expect(() => connectAddress(a), a).toThrow(/this machine/)
  })

  it('send the bypass header only to a stellr-web-dev deployment, and only when it is set', () => {
    const env = { VERCEL_AUTOMATION_BYPASS_SECRET: 'placeholder-bypass' }
    expect(bypassHeadersFor('https://stellr-web-dev.vercel.app/sign', env)).toEqual({ 'x-vercel-protection-bypass': 'placeholder-bypass' })
    expect(bypassHeadersFor('https://stellr-web-dev-git-dev-team.vercel.app/', env)).toEqual({ 'x-vercel-protection-bypass': 'placeholder-bypass' })
    expect(bypassHeadersFor('https://stellr-web-dev.vercel.app/sign', {})).toEqual({})
    for (const url of ['https://canary.dev-zone.example/sign', 'http://canary.localhost:3000/sign', 'http://localhost:3000/', 'https://stellr-web.vercel.app/', 'https://www.stellreducation.org/']) {
      expect(bypassHeadersFor(url, env), url).toEqual({})
    }
  })
})

describe('a run', () => {
  const answers = (over: Record<string, Res> = {}) => async ({ url }: { url: string | URL }): Promise<Res> => {
    const u = new URL(url)
    const key = `${u.hostname}${u.pathname}`
    if (over[key]) return over[key]
    if (u.hostname === 'localhost') return page({})
    return u.pathname === '/sign' || u.pathname === '/survey/x' ? page({ [ENFORCING]: NONCE_POLICY }) : { status: 404, headers: { [ENFORCING]: FIXED_POLICY }, body: '' }
  }
  const tenant = new URL('http://canary.localhost:3000')
  const stellr = new URL('http://localhost:3000')

  it('passes, printing paths and statuses only', async () => {
    const { ok, lines } = await runHeaderChecks({ tenant, stellr, request: answers() })
    expect(ok).toBe(true)
    expect(lines).toHaveLength(NONCE_PATHS.length + FIXED_PATHS.length * 2 + 1)
    expect(lines.join('\n')).not.toContain('placeholderNonce1')
    expect(lines.at(-1)).toBe('  Result: pass')
  })

  it('fails when one path is wrong, or does not answer', async () => {
    const wrong = await runHeaderChecks({ tenant, stellr, request: answers({ 'canary.localhost/sign': page({}) }) })
    expect(wrong.ok).toBe(false)
    expect(wrong.lines).toContain('  FAIL  tenant /sign 200: 0 enforcing policies, not exactly one')
    const down = await runHeaderChecks({
      tenant,
      request: async () => {
        throw new Error('refused')
      },
    })
    expect(down.ok).toBe(false)
    expect(down.lines[0]).toBe('  FAIL  tenant /sign: no response')
  })

  it('sends the bypass secret to the dev deployment control, and never to the canary host', async () => {
    const sent: { host: string; headers: Record<string, string> }[] = []
    const request = async ({ url, headers = {} }: { url: string | URL; headers?: Record<string, string> }): Promise<Res> => {
      sent.push({ host: new URL(url).hostname, headers })
      return answers()({ url })
    }
    await runHeaderChecks({
      tenant: new URL('https://canary.dev-zone.example'),
      stellr: new URL('https://stellr-web-dev.vercel.app'),
      env: { VERCEL_AUTOMATION_BYPASS_SECRET: 'placeholder-bypass' },
      request,
    })
    const canary = sent.filter((s) => s.host === 'canary.dev-zone.example')
    const control = sent.filter((s) => s.host === 'stellr-web-dev.vercel.app')
    expect(canary.length).toBe(NONCE_PATHS.length + FIXED_PATHS.length)
    expect(control.length).toBe(FIXED_PATHS.length)
    for (const s of canary) expect(s.headers['x-vercel-protection-bypass']).toBeUndefined()
    for (const s of control) expect(s.headers['x-vercel-protection-bypass']).toBe('placeholder-bypass')
  })
})

describe('rawRequest', () => {
  let server: Server
  let port = 0
  let seen: { host?: string; method?: string; url?: string; body: string; headers?: IncomingHttpHeaders }[] = []

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        seen.push({ host: req.headers.host, method: req.method, url: req.url, body, headers: req.headers })
        res.writeHead(302, { location: '/elsewhere', [ENFORCING]: FIXED_POLICY })
        res.end('moved')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

  it("sends the URL's own Host to the loopback address, and follows nothing", async () => {
    seen = []
    const res = await rawRequest({ url: `http://canary.localhost:${port}/sign?x=1` })
    expect(res.status).toBe(302)
    expect(res.headers[ENFORCING]).toBe(FIXED_POLICY)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ host: `canary.localhost:${port}`, method: 'GET', url: '/sign?x=1' })
    expect(seen[0].headers?.accept).toBe('*/*')
  })

  it('posts JSON with the headers given, to the --connect address', async () => {
    seen = []
    await rawRequest({
      url: `http://canary.dev-zone.example:${port}/api/register/individual`,
      method: 'POST',
      body: { a: 1 },
      headers: { Authorization: 'Bearer placeholder' },
      connect: '127.0.0.1',
    })
    expect(seen[0]).toMatchObject({ host: `canary.dev-zone.example:${port}`, method: 'POST', body: '{"a":1}' })
    expect(seen[0].headers?.authorization).toBe('Bearer placeholder')
    expect(seen[0].headers?.['content-type']).toBe('application/json')
  })
})
