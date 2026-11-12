#!/usr/bin/env node
/**
 * tenant-host-headers.mjs: the response headers on a tenant host (S5 wave 7, K8).
 *
 * After the canary zone is attached (K6), and in K9's local rehearsal, this checks
 * what e2e/tenancy/tenant-csp.spec.ts checks on the harness, against a real host:
 *
 *   /sign, /survey/x     exactly one enforcing Content-Security-Policy, whose
 *                        script-src starts 'nonce-; no report-only policy; every
 *                        <script> on the page carries that nonce
 *   /_next/…, /api/img/…, /api/csp-report/…
 *                        the fixed header next.config.mjs sets on what skips the
 *                        proxy on a host that is not Stellr's:
 *                        frame-ancestors 'none'; base-uri 'none'; object-src 'none'
 *   with --stellr-base   the control: Stellr's own host never gets that fixed header
 *
 *   node scripts/canary/tenant-host-headers.mjs --base https://canary.<zone> [--stellr-base https://stellr-web-dev.vercel.app]
 *   node scripts/canary/tenant-host-headers.mjs --base http://canary.localhost:3000 --stellr-base http://localhost:3000
 *
 * --connect <address> sends every request to that address with the URL's Host (a
 * *.localhost host goes to 127.0.0.1 by default). VERCEL_AUTOMATION_BYPASS_SECRET,
 * when set, is sent as x-vercel-protection-bypass for the dev deployment's
 * protection. GET only, no sign-in, nothing written. Prints paths, status codes and
 * pass or fail, never a policy's nonce or a page body. Refuses Stellr's production
 * hosts. Exit 1 when any check fails.
 *
 * rawRequest is shared with scripts/canary-tenant-flow.ts: fetch will not set Host.
 */
import http from 'node:http'
import https from 'node:https'
import { pathToFileURL } from 'node:url'

export const ENFORCING = 'content-security-policy'
export const REPORT_ONLY = 'content-security-policy-report-only'

/** next.config.mjs, the headers() entry for '/_next/:path*', '/api/img/:path*' and '/api/csp-report/:path*'. */
export const FIXED_POLICY = "frame-ancestors 'none'; base-uri 'none'; object-src 'none'"

export const NONCE_PATHS = ['/sign', '/survey/x']
export const FIXED_PATHS = ['/_next/canary-no-such-file', '/api/img/canary-no-such-file', '/api/csp-report/canary-no-such-file']

/** Stellr's production hosts (lib/testing/canary-flow-scenarios.ts PRODUCTION_HOSTS; the test holds them equal). */
export const PRODUCTION_HOSTS = ['stellreducation.org', 'www.stellreducation.org', 'app.stellreducation.org', 'events.stellreducation.org']

/**
 * The policies one header carries. Node joins a repeated header with ", " (or gives
 * an array), and a comma separates policies in one header too.
 *
 * @param {string | string[] | undefined} value
 * @returns {string[]}
 */
export function policies(value) {
  if (value === undefined) return []
  return (Array.isArray(value) ? value : [value]).flatMap((v) => v.split(/,\s*/)).map((v) => v.trim()).filter(Boolean)
}

const nonceOf = (/** @type {string} */ policy) => /'nonce-([^']+)'/.exec(policy)?.[1] ?? ''

/**
 * @typedef {{ status: number, headers: Record<string, string | string[] | undefined>, body: string }} RawResponse
 */

/**
 * /sign and /survey/x on a tenant host. Problems as fixed text; empty when it passes.
 *
 * @param {RawResponse} res
 * @returns {string[]}
 */
export function noncePageProblems(res) {
  const out = []
  const enforcing = policies(res.headers[ENFORCING])
  if (enforcing.length !== 1) out.push(`${enforcing.length} enforcing policies, not exactly one`)
  else if (!/^script-src 'nonce-[^']+'/.test(enforcing[0])) out.push("the enforcing policy does not start with script-src 'nonce-")
  if (policies(res.headers[REPORT_ONLY]).length) out.push('a report-only policy is set as well')
  if (enforcing.length === 1) {
    const nonce = nonceOf(enforcing[0])
    const scripts = [...res.body.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1])
    const bare = scripts.filter((attrs) => !nonce || !attrs.includes(`nonce="${nonce}"`)).length
    if (bare) out.push(`${bare} script tag(s) without the policy's nonce`)
  }
  return out
}

/**
 * /_next, /api/img and /api/csp-report on a tenant host.
 *
 * @param {RawResponse} res
 * @returns {string[]}
 */
export function fixedHeaderProblems(res) {
  const enforcing = policies(res.headers[ENFORCING])
  if (enforcing.length !== 1) return [`${enforcing.length} enforcing policies, not exactly one`]
  // The fixed policy is one header holding three directives, which `policies` keeps whole.
  return enforcing[0] === FIXED_POLICY ? [] : ['the enforcing policy is not the fixed one']
}

/**
 * Stellr's own host: the fixed header is for hosts that are not Stellr's.
 *
 * @param {RawResponse} res
 * @returns {string[]}
 */
export function stellrControlProblems(res) {
  return policies(res.headers[ENFORCING]).includes(FIXED_POLICY) ? ["Stellr's host carries the tenant-host fixed header"] : []
}

/**
 * The origin a flag names, or a throw. Stellr's production hosts are refused.
 *
 * @param {string | undefined} raw
 * @param {string} flag
 */
export function originOf(raw, flag) {
  if (!raw) throw new Error(`${flag} is required`)
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${flag} is not a URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${flag} must be http or https`)
  if (PRODUCTION_HOSTS.includes(url.hostname.toLowerCase())) throw new Error(`refusing: ${flag} is a Stellr production host; the canary runs on dev only`)
  return new URL(url.origin)
}

/**
 * x-vercel-protection-bypass for the dev deployment, when the env carries it.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {Record<string, string>}
 */
export function bypassHeaders(env = process.env) {
  const secret = env.VERCEL_AUTOMATION_BYPASS_SECRET
  /** @type {Record<string, string>} */
  const out = {}
  if (secret) out['x-vercel-protection-bypass'] = secret
  return out
}

/**
 * One request with the URL's own Host, following nothing. Sent to `connect` when
 * given, to 127.0.0.1 for a *.localhost host, and otherwise to the host itself.
 * `Accept: *\/*` so a page load does not draw Clerk's handshake redirect.
 *
 * @param {{ url: string | URL, method?: string, headers?: Record<string, string>, body?: unknown, connect?: string, timeoutMs?: number }} opts
 * @returns {Promise<RawResponse>}
 */
export function rawRequest({ url, method = 'GET', headers = {}, body, connect, timeoutMs = 60_000 }) {
  const u = new URL(url)
  const transport = u.protocol === 'https:' ? https : http
  const payload = body === undefined ? undefined : JSON.stringify(body)
  const address = connect || (u.hostname.endsWith('.localhost') ? '127.0.0.1' : u.hostname.replace(/^\[|\]$/g, ''))
  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        host: address,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method,
        agent: false,
        servername: u.protocol === 'https:' ? u.hostname : undefined,
        timeout: timeoutMs,
        headers: {
          Host: u.host,
          Accept: '*/*',
          'User-Agent': 'stellr-canary-runner',
          ...(payload === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) }),
          ...headers,
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('error', reject)
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
      },
    )
    req.on('timeout', () => req.destroy(new Error(`timed out: ${method} ${u.pathname}`)))
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

/**
 * Every check, as printable lines (paths, statuses, pass or fail) and a verdict.
 *
 * @param {{ tenant: URL, stellr?: URL | null, connect?: string, headers?: Record<string, string>, request?: typeof rawRequest }} opts
 * @returns {Promise<{ ok: boolean, lines: string[] }>}
 */
export async function runHeaderChecks({ tenant, stellr = null, connect, headers = {}, request = rawRequest }) {
  const lines = []
  let ok = true
  const check = async (/** @type {URL} */ base, /** @type {string} */ path, /** @type {(r: RawResponse) => string[]} */ judge, /** @type {string} */ label) => {
    let res
    try {
      res = await request({ url: new URL(path, base), headers, connect })
    } catch {
      ok = false
      lines.push(`  FAIL  ${label} ${path}: no response`)
      return
    }
    const problems = judge(res)
    if (problems.length) ok = false
    lines.push(`  ${problems.length ? 'FAIL' : 'PASS'}  ${label} ${path} ${res.status}${problems.length ? `: ${problems.join('; ')}` : ''}`)
  }
  for (const path of NONCE_PATHS) await check(tenant, path, noncePageProblems, 'tenant')
  for (const path of FIXED_PATHS) await check(tenant, path, fixedHeaderProblems, 'tenant')
  if (stellr) for (const path of FIXED_PATHS) await check(stellr, path, stellrControlProblems, 'stellr')
  lines.push(ok ? '  Result: pass' : '  Result: fail')
  return { ok, lines }
}

/** `--name value` or `--name=value`. */
function flag(argv, name) {
  const eq = argv.find((a) => a.startsWith(`${name}=`))
  if (eq !== undefined) return eq.slice(name.length + 1)
  const at = argv.indexOf(name)
  return at === -1 ? undefined : argv[at + 1]
}

async function main(argv = process.argv.slice(2)) {
  const tenant = originOf(flag(argv, '--base'), '--base')
  const stellrRaw = flag(argv, '--stellr-base')
  const stellr = stellrRaw ? originOf(stellrRaw, '--stellr-base') : null
  if (stellr && stellr.host === tenant.host) throw new Error('--base and --stellr-base name the same host')
  console.log(`Tenant-host headers: ${tenant.host}${stellr ? ` (control: ${stellr.host})` : ''}`)
  const { ok, lines } = await runHeaderChecks({ tenant, stellr, connect: flag(argv, '--connect'), headers: bypassHeaders() })
  for (const line of lines) console.log(line)
  if (!ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`tenant-host-headers: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  })
}
