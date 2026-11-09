import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { planTwoTenantSeed } from '../../lib/testing/two-tenant-seed'
import { SECOND_TENANT, isRecordTable, matchRecords } from './harness-records'
import { STATS_PATH, STUB_PORT } from './harness-env.mjs'

/**
 * A stand-in for PostgREST, on this machine, for the tenant-host harness (S5, B10a).
 *
 * It serves the two-tenant seed's host map, the second non-owner tenant from
 * harness-records.ts, and that file's records to a read that names one by its key. Every
 * other read gets no rows, so nothing in the harness can reach the shared dev database.
 * Writes succeed and go nowhere: a page may record an error while it renders, and the
 * count is exposed so a run can say how many there were.
 */

export type StubStats = {
  hostMapLoads: number
  writes: string[]
  recordReads: Record<string, number>
  /** Reads narrowed to one tenant, as `table tenant-id`, so a shared cache in front of one shows. */
  tenantReads: Record<string, number>
}

function hostMapRows() {
  const plan = planTwoTenantSeed()
  const seeded = plan.tenant_domains.map((domain) => {
    const tenant = plan.tenants.find((t) => t.id === domain.tenant_id)
    return {
      host: domain.host,
      tenant_id: domain.tenant_id,
      tenants: { slug: tenant?.slug, status: tenant?.status },
    }
  })
  return [...seeded, { host: SECOND_TENANT.host, tenant_id: SECOND_TENANT.id, tenants: { slug: SECOND_TENANT.slug, status: 'active' } }]
}

export function createHostMapStub(): http.Server {
  const stats: StubStats = { hostMapLoads: 0, writes: [], recordReads: {}, tenantReads: {} }

  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://stub')
    const path = url.pathname
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
      const table = path.replace('/rest/v1/', '')
      const rows = matchRecords(table, url.searchParams)
      if (isRecordTable(table)) stats.recordReads[table] = (stats.recordReads[table] ?? 0) + 1
      const tenantFilter = url.searchParams.get('tenant_id')
      if (tenantFilter?.startsWith('eq.')) {
        const key = `${table} ${tenantFilter.slice(3)}`
        stats.tenantReads[key] = (stats.tenantReads[key] ?? 0) + 1
      }
      // `.single()` asks for one object, and PostgREST refuses when there is none.
      if (req.headers.accept?.includes('vnd.pgrst.object')) {
        if (rows.length === 1) return send(200, rows[0])
        return send(406, { code: 'PGRST116', details: 'The result contains 0 rows', hint: null, message: 'No rows' })
      }
      return send(200, req.method === 'HEAD' ? undefined : rows, { 'Content-Range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' })
    }

    // Never the query string: it can carry a fixture's filter values.
    stats.writes.push(`${req.method} ${path}`)
    return send(req.headers.accept?.includes('vnd.pgrst.object') ? 406 : 201, [])
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createHostMapStub().listen(STUB_PORT, '127.0.0.1')
}
