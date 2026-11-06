import http from 'node:http'
import { planTwoTenantSeed } from '../../lib/testing/two-tenant-seed'
import { CANARY_TENANT } from '../../lib/testing/honeytokens'
import type { StubStats } from '../tenancy/host-map-stub'
import { HARNESS_APP_HOST, STATS_PATH, STUB_URL } from '../tenancy/harness-env.mjs'
import type { RawResponse } from '../tenancy/body-hash'

export { FLAG_OFF_PORT, FLAG_ON_PORT, HARNESS_APP_HOST } from '../tenancy/harness-env.mjs'

/** Mapped to the canary tenant by the two-tenant seed. */
export const CANARY_HOST = CANARY_TENANT.host
/** Mapped to Stellr by the seed: inside the zone, so it takes the platform-owner path. */
export const STELLR_ZONE_HOST = 'stellr.localhost'
/** Inside the zone and in nobody's map. */
export const UNKNOWN_ZONE_HOST = 'nobody.localhost'

/** Hosts that must stay Stellr's with routing on, one for each way a host resolves. */
export const STELLR_HOSTS = [
  'localhost', // outside the zone
  STELLR_ZONE_HOST, // inside the zone: the host map, then the platform-owner rule
  'www.stellreducation.org', // a known Stellr host
  HARNESS_APP_HOST, // this build's member-app host: the proxy's app branch
]

if (!planTwoTenantSeed().tenant_domains.some((d) => d.host === STELLR_ZONE_HOST)) {
  throw new Error(`The two-tenant seed no longer maps ${STELLR_ZONE_HOST}.`)
}

/**
 * A GET with the exact Host given and exactly the bytes given, following nothing.
 * Raw node:http, because fetch won't set Host and tidies the URL. `Accept: *\/*`
 * because a request that looks like a browser page load draws Clerk's handshake
 * redirect, and this harness has no Clerk instance to send it to.
 */
export function rawGet(
  port: number,
  host: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        agent: false,
        timeout: 60_000,
        headers: { Host: host, Accept: '*/*', 'User-Agent': 'stellr-tenant-host-harness', ...headers },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('error', reject)
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }),
        )
      },
    )
    req.on('timeout', () => req.destroy(new Error(`Timed out: ${host} ${path}`)))
    req.on('error', reject)
    req.end()
  })
}

export async function stubStats(): Promise<StubStats> {
  const res = await fetch(`${STUB_URL}${STATS_PATH}`)
  return (await res.json()) as StubStats
}

/** The stub's writes, once a second has passed with no new one: a page can write after it responds. */
export async function settledWrites(): Promise<string[]> {
  let writes = (await stubStats()).writes
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    const latest = (await stubStats()).writes
    if (latest.length === writes.length) return latest
    writes = latest
  }
}

/** Runs `task` over `items`, at most `limit` at a time. Results keep the input's order. */
export async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await task(items[index])
    }
  }
  await Promise.all(Array.from({ length: limit }, worker))
  return results
}
