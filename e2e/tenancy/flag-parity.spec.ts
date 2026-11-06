import { expect, test } from '@playwright/test'
import {
  CANARY_HOST,
  FLAG_OFF_PORT,
  FLAG_ON_PORT,
  HARNESS_APP_HOST,
  STELLR_HOSTS,
  STELLR_ZONE_HOST,
  UNKNOWN_ZONE_HOST,
  mapLimit,
  rawGet,
  settledWrites,
  stubStats,
} from '../fixtures/tenant-hosts'
import { differences, fingerprint } from './body-hash'
import { SAMPLED_PATHS, pageFiles, pagePathForFile } from './page-routes'

/**
 * Check (a), S5 B10a: on the same production build, a Stellr host answers exactly
 * the same with tenant routing on as with it off. Status, headers and normalised
 * body, for every page under app/, cold and then warm. This is the machine proof
 * of "no visible change" from switching routing on, and nothing more. What it does
 * not prove:
 *
 * - A code change that is not tied to the flag. Both servers run one build, so such
 *   a change lands on both and every comparison still passes. It cannot gate B5c's
 *   layout move on its own: see the B5c amendment in docs/TENANCY-S5.md.
 * - Signed-in pages. The harness has no Clerk instance, so a page behind a session
 *   is compared at its redirect, not its body.
 * - Real records. A dynamic page answers as it does for an unknown id.
 * - Prerendered pages with the flag on at build. The flag is set only at run time
 *   here, and on a Vercel project it is set at build too. Those pages are one
 *   artefact on both servers. harness.test.ts holds the flag's readers away from
 *   Stellr's pages instead.
 */

// No serial mode, so a difference on one host does not hide the others. There is one
// worker and tests run in file order, so a warm pass still follows its cold one, on
// the same servers, whatever failed before it.

const PATHS = [...new Set([...pageFiles().map(pagePathForFile), ...SAMPLED_PATHS])]

// Pages that answer 200 on each host's weakest pass. Matching proves little once many
// have stopped rendering. Set just under the measured count, so losing a tenth fails.
// If a real change removes pages, lower it in that PR and say why.
const MIN_RENDERED_PAGES: Record<string, number> = {
  localhost: 54,
  [STELLR_ZONE_HOST]: 54,
  'www.stellreducation.org': 54,
  [HARNESS_APP_HOST]: 40,
}

// The same paths, asked for cold, warm and as a browser asks for a page. The first two
// passes run in order, so the second reads what the first left in the caches.
const PASSES: { name: string; headers: Record<string, string>; rendersPages: boolean }[] = [
  { name: 'cold', headers: {}, rendersPages: true },
  { name: 'warm', headers: {}, rendersPages: true },
  // Draws Clerk's handshake redirect on every route Clerk runs on.
  { name: 'browser page load', headers: { Accept: 'text/html', 'Sec-Fetch-Dest': 'document' }, rendersPages: false },
]

// Without this, two servers with the flag off would pass every comparison below.
test('the two servers really differ on a tenant host', async () => {
  const offCanary = await rawGet(FLAG_OFF_PORT, CANARY_HOST, '/')
  const onCanary = await rawGet(FLAG_ON_PORT, CANARY_HOST, '/')
  expect(offCanary.status).toBe(200)
  expect(onCanary.status).toBe(200)
  expect(differences(fingerprint(offCanary, FLAG_OFF_PORT), fingerprint(onCanary, FLAG_ON_PORT))).toContainEqual(
    expect.stringMatching(/^body/),
  )

  expect((await rawGet(FLAG_OFF_PORT, CANARY_HOST, '/admin')).status).not.toBe(404)
  expect((await rawGet(FLAG_ON_PORT, CANARY_HOST, '/admin')).status).toBe(404)

  expect((await rawGet(FLAG_OFF_PORT, UNKNOWN_ZONE_HOST, '/')).status).toBe(200)
  expect((await rawGet(FLAG_ON_PORT, UNKNOWN_ZONE_HOST, '/')).status).toBe(404)
})

test('a Stellr host in the zone is decided by the host map', async () => {
  const res = await rawGet(FLAG_ON_PORT, STELLR_ZONE_HOST, '/about')
  expect(res.status).toBe(200)
  expect(res.body).toContain('Stellr')
  expect((await stubStats()).hostMapLoads).toBeGreaterThan(0)
})

for (const host of STELLR_HOSTS) {
  for (const pass of PASSES) {
    test(`${host}: routing on changes nothing, ${pass.name}`, async () => {
      const results = await mapLimit(PATHS, 8, async (path) => {
        // Together, so anything that moves with the clock moves for both.
        const [off, on] = await Promise.all([
          rawGet(FLAG_OFF_PORT, host, path, pass.headers),
          rawGet(FLAG_ON_PORT, host, path, pass.headers),
        ])
        return {
          path,
          status: off.status,
          diff: differences(fingerprint(off, FLAG_OFF_PORT), fingerprint(on, FLAG_ON_PORT)),
        }
      })

      const byStatus: Record<number, number> = {}
      for (const { status } of results) byStatus[status] = (byStatus[status] ?? 0) + 1
      console.log(`${host}, ${pass.name}: ${results.length} paths, flag off answered ${JSON.stringify(byStatus)}`)

      expect(results.filter((r) => r.diff.length > 0).map((r) => `${r.path}: ${r.diff.join(', ')}`)).toEqual([])
      // A page that fails on both servers matches, and that is not what this proves.
      expect(results.filter((r) => r.status >= 500).map((r) => r.path)).toEqual([])
      if (pass.rendersPages) expect(byStatus[200] ?? 0).toBeGreaterThanOrEqual(MIN_RENDERED_PAGES[host])
    })
  }

  // A response cannot show a write, and the stub cannot tell the servers apart, since
  // its URL is inlined at build. So each server gets the stub to itself in turn. Both
  // are warm by now, so a difference is routing's and not a first request's.
  test(`${host}: routing on adds no write`, async () => {
    const writesFrom = async (port: number) => {
      const before = (await stubStats()).writes.length
      await mapLimit(PATHS, 8, (path) => rawGet(port, host, path))
      return (await settledWrites()).slice(before).sort()
    }
    const off = await writesFrom(FLAG_OFF_PORT)
    const on = await writesFrom(FLAG_ON_PORT)
    console.log(`${host}: ${off.length} writes with routing off, ${on.length} with it on`)
    expect(on).toEqual(off)
  })
}

test.afterAll(async () => {
  const { hostMapLoads, writes } = await stubStats()
  console.log(`The stub served ${hostMapLoads} host map loads and took ${writes.length} writes: ${[...new Set(writes)].join(', ') || 'none'}`)
})
