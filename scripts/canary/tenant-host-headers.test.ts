// @vitest-environment node
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  bypassHeaders,
  ENFORCING,
  FIXED_PATHS,
  FIXED_POLICY,
  fixedHeaderProblems,
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
import { PRODUCTION_HOSTS as SCENARIO_PRODUCTION_HOSTS } from '../../lib/testing/canary-flow-scenarios'

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

  it("refuse Stellr's production hosts, and send the bypass header only when it is set", () => {
    for (const host of PRODUCTION_HOSTS) expect(() => originOf(`https://${host}`, '--base')).toThrow(/production host/)
    expect(originOf('https://canary.dev-zone.example/x?y=1', '--base').href).toBe('https://canary.dev-zone.example/')
    expect(() => originOf(undefined, '--base')).toThrow(/required/)
    expect(() => originOf('ftp://x', '--base')).toThrow(/http or https/)
    expect(bypassHeaders({})).toEqual({})
    expect(bypassHeaders({ VERCEL_AUTOMATION_BYPASS_SECRET: 'placeholder-bypass' })).toEqual({ 'x-vercel-protection-bypass': 'placeholder-bypass' })
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
