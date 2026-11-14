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
 *   node scripts/canary/tenant-host-headers.mjs --zone <zone> --base https://canary.<zone> [--stellr-base https://stellr-web-dev.vercel.app]
 *   node scripts/canary/tenant-host-headers.mjs --zone localhost --base http://canary.localhost:3000 --stellr-base http://localhost:3000
 *
 * Targets, as the runner's (lib/testing/canary-flow-scenarios.ts canaryBases): --base
 * must be canary.<zone>, and --stellr-base this machine or the stellr-web-dev
 * deployment; Stellr's production hosts are refused, and so is every host in the
 * production tenant zone (.events.stellreducation.org, its apex included) and that
 * zone as --zone (W7-27), before any request. There is no override.
 * --connect <address> sends every request to that address with the URL's Host, and
 * must be this machine (127.0.0.1, ::1 or localhost); a *.localhost host goes to
 * 127.0.0.1 by default. VERCEL_AUTOMATION_BYPASS_SECRET, when set, is sent as
 * x-vercel-protection-bypass only on a request to a stellr-web-dev deployment, the
 * only host its protection covers. GET only, no sign-in, nothing written. Prints
 * paths, status codes and pass or fail, never a policy's nonce or a page body. Exit 1
 * when any check fails.
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
 * The production tenant zone (lib/tenancy/host-pure.ts PRODUCTION_TENANT_ZONE, W7-27;
 * this file is plain JavaScript and cannot import it, so the test holds them equal).
 */
export const PRODUCTION_TENANT_ZONE = '.events.stellreducation.org'

/**
 * Is this hostname in the production tenant zone: its apex or any host under it?
 * Read loosely (leading dots, case, a trailing dot), so no spelling slips past.
 *
 * @param {string | undefined} raw
 */
export function isInProductionTenantZone(raw) {
  const host = (raw ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '')
  if (!host) return false
  return `.${host}` === PRODUCTION_TENANT_ZONE || host.endsWith(PRODUCTION_TENANT_ZONE)
}

/** The stellr-web-dev Vercel project's deployments (the runner's DEV_DEPLOYMENT_HOST; the test holds them equal). */
export const DEV_DEPLOYMENT_HOST = /^stellr-web-dev[a-z0-9-]*\.vercel\.app$/

/** lib/testing/canary-flow-seed.ts CANARY_HOST_LABEL. */
export const CANARY_HOST_LABEL = 'canary'

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']
const LOOPBACK_ADDRESSES = ['localhost', '127.0.0.1', '::1', '[::1]']
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * Is this hostname this machine: loopback, or a *.localhost name?
 *
 * @param {string} hostname
 */
export function isThisMachine(hostname) {
  const h = hostname.toLowerCase()
  return LOOPBACK_HOSTS.includes(h) || h.endsWith('.localhost')
}

/**
 * The canary host for a zone, as K3's canaryHosts(zone).mapped (the test holds them equal).
 *
 * @param {string | undefined} raw
 */
export function canaryHostFor(raw) {
  const zone = (raw ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '')
  if (!zone) throw new Error('--zone is required (for example --zone localhost for a local run)')
  if (isInProductionTenantZone(zone)) {
    throw new Error(`refusing: --zone is the production tenant zone (${PRODUCTION_TENANT_ZONE}); the canary runs on dev only`)
  }
  if (!zone.split('.').every((label) => DNS_LABEL.test(label))) throw new Error('--zone must be a DNS name: letters, digits, hyphens and dots')
  return `${CANARY_HOST_LABEL}.${zone}`
}

/**
 * The two origins the checks talk to, or a throw: --base is canary.<zone>, and
 * --stellr-base (optional) this machine or the stellr-web-dev deployment.
 *
 * @param {{ base?: string, stellrBase?: string, zone?: string }} opts
 * @returns {{ tenant: URL, stellr: URL | null }}
 */
export function headerBases({ base, stellrBase, zone }) {
  const tenant = originOf(base, '--base')
  if (tenant.hostname !== canaryHostFor(zone)) throw new Error(`--base must be the canary host for --zone (${canaryHostFor(zone)})`)
  const stellr = stellrBase ? originOf(stellrBase, '--stellr-base') : null
  if (stellr && !(isThisMachine(stellr.hostname) || DEV_DEPLOYMENT_HOST.test(stellr.hostname))) {
    throw new Error('refusing: --stellr-base must be this machine or the stellr-web-dev deployment')
  }
  if (stellr && stellr.host === tenant.host) throw new Error('--base and --stellr-base name the same host')
  return { tenant, stellr }
}

/**
 * The --connect address, which must be this machine, or undefined when not given.
 *
 * @param {string | undefined} raw
 */
export function connectAddress(raw) {
  const a = (raw ?? '').trim().toLowerCase()
  if (!a) return undefined
  if (!LOOPBACK_ADDRESSES.includes(a)) throw new Error('refusing: --connect must be this machine (127.0.0.1, ::1 or localhost)')
  return a.replace(/^\[|\]$/g, '')
}

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
  if (isInProductionTenantZone(url.hostname)) {
    throw new Error(`refusing: ${flag} is in the production tenant zone (${PRODUCTION_TENANT_ZONE}); the canary runs on dev only`)
  }
  return new URL(url.origin)
}

/**
 * x-vercel-protection-bypass for a request, when the env carries the secret and the
 * request goes to a stellr-web-dev deployment. Vercel's protection covers only its
 * own *.vercel.app URLs, so a custom domain or this machine never needs it, and no
 * other host is sent it.
 *
 * @param {string | URL} url
 * @param {Record<string, string | undefined>} [env]
 * @returns {Record<string, string>}
 */
export function bypassHeadersFor(url, env = process.env) {
  const secret = env.VERCEL_AUTOMATION_BYPASS_SECRET
  /** @type {Record<string, string>} */
  const out = {}
  if (secret && DEV_DEPLOYMENT_HOST.test(new URL(url).hostname.toLowerCase())) out['x-vercel-protection-bypass'] = secret
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
 * @param {{ tenant: URL, stellr?: URL | null, connect?: string, env?: Record<string, string | undefined>, request?: typeof rawRequest }} opts
 * @returns {Promise<{ ok: boolean, lines: string[] }>}
 */
export async function runHeaderChecks({ tenant, stellr = null, connect, env = {}, request = rawRequest }) {
  const lines = []
  let ok = true
  const check = async (/** @type {URL} */ base, /** @type {string} */ path, /** @type {(r: RawResponse) => string[]} */ judge, /** @type {string} */ label) => {
    let res
    try {
      const url = new URL(path, base)
      res = await request({ url, headers: bypassHeadersFor(url, env), connect })
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
  const { tenant, stellr } = headerBases({ base: flag(argv, '--base'), stellrBase: flag(argv, '--stellr-base'), zone: flag(argv, '--zone') })
  const connect = connectAddress(flag(argv, '--connect'))
  console.log(`Tenant-host headers: ${tenant.host}${stellr ? ` (control: ${stellr.host})` : ''}`)
  const { ok, lines } = await runHeaderChecks({ tenant, stellr, connect, env: process.env })
  for (const line of lines) console.log(line)
  if (!ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`tenant-host-headers: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  })
}
