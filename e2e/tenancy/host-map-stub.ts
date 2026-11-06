import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { planTwoTenantSeed } from '../../lib/testing/two-tenant-seed'
import { STATS_PATH, STUB_PORT } from './harness-env.mjs'

/**
 * A stand-in for PostgREST, on this machine, for the tenant-host harness (S5, B10a).
 *
 * It serves the two-tenant seed's host map and answers every other read with no
 * rows, so nothing in the harness can reach the shared dev database. Writes
 * succeed and go nowhere: a page may record an error while it renders, and the
 * count is exposed so a run can say how many there were.
 */

export type StubStats = { hostMapLoads: number; writes: string[] }

function hostMapRows() {
  const plan = planTwoTenantSeed()
  return plan.tenant_domains.map((domain) => {
    const tenant = plan.tenants.find((t) => t.id === domain.tenant_id)
    return {
      host: domain.host,
      tenant_id: domain.tenant_id,
      tenants: { slug: tenant?.slug, status: tenant?.status },
    }
  })
}

export function createHostMapStub(): http.Server {
  const stats: StubStats = { hostMapLoads: 0, writes: [] }

  return http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
      res.end(body === undefined ? undefined : JSON.stringify(body))
    }
    req.resume()

    if (path === STATS_PATH) return send(200, stats)

    if (req.method === 'GET' && path === '/rest/v1/tenant_domains') {
      stats.hostMapLoads++
      return send(200, hostMapRows())
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      // `.single()` asks for one object, and PostgREST refuses when there is none.
      if (req.headers.accept?.includes('vnd.pgrst.object')) {
        return send(406, { code: 'PGRST116', details: 'The result contains 0 rows', hint: null, message: 'No rows' })
      }
      return send(200, req.method === 'HEAD' ? undefined : [], { 'Content-Range': '*/0' })
    }

    // Never the query string: it can carry a fixture's filter values.
    stats.writes.push(`${req.method} ${path}`)
    return send(req.headers.accept?.includes('vnd.pgrst.object') ? 406 : 201, [])
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createHostMapStub().listen(STUB_PORT, '127.0.0.1')
}
