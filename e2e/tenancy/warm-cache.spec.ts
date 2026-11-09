import { expect, test } from '@playwright/test'
import { FLAG_ON_PORT, STELLR_ZONE_HOST, rawGet, stubStats } from '../fixtures/tenant-hosts'
import { differences, fingerprint, type Fingerprint } from './body-hash'
import { documentShape } from './document-shape'
import { OWNER_A, OWNER_B, eventTitle, type RecordOwner } from './harness-records'
import { ownRecordUrls } from './host-cases'

/**
 * Check (b), S5 B10: one server, two non-owner tenants, asked in turn. Each host keeps
 * its own answer, however the two are interleaved. Two non-owner tenants, because Stellr
 * is never rewritten into the tree, so alternating with a Stellr host passes with no
 * check at all.
 *
 * Every tenant page renders per request today (B6), so the per-tenant answer is held by
 * the tenant in the URL, not by a cache that could mix them. These assert no-store and no
 * Next cache state as well, so that a change to ISR fails here and this is run again in
 * that mode. There is no ISR mode to run now: the owner's choice is still open, and a
 * page with a per-request nonce can't be shared.
 *
 * With no CMS, no shared URL here shows a tenant's data: /check-in reads it, then says not
 * open for both. So an answer's hash can only see a page-level cache. A data cache inside
 * the page shows in the stub's reads instead, and the redirect it would send is held by
 * test/tenant-tree-page-records.test.ts. A slice that adds tenant data to a shared page,
 * such as branding, adds its row here.
 */

const sharedPages = ['/', '/sign', '/sign/copy', '/check-in', '/privacy', '/sign-in', '/register/harness-slug', '/no-such-file.png']

function pagesOf(o: RecordOwner): string[] {
  return [...sharedPages, ...ownRecordUrls(o)]
}

const OWNERS = [OWNER_A, OWNER_B]
const ROUNDS = 3

async function answer(o: RecordOwner, path: string) {
  const res = await rawGet(FLAG_ON_PORT, o.host, path)
  return { res, print: fingerprint(res, FLAG_ON_PORT) }
}

const key = (o: RecordOwner, path: string) => `${o.name} ${path}`

/** The tenant segment in Next's flight data, with its JSON escaped inside the script. */
const routeData = (o: RecordOwner) => `\\"n\\":\\"tenant\\",\\"t\\":\\"d\\",\\"k\\":\\"${o.tenantSlug}\\"`

test.describe('two tenants in turn', () => {
  const first = new Map<string, Fingerprint>()

  // Serial so the alternation follows the answers it compares with, on the same server.
  test.describe.configure({ mode: 'serial' })

  test('each page answers, per request, and names only its own tenant', async () => {
    for (const o of OWNERS) {
      const other = o === OWNER_A ? OWNER_B : OWNER_A
      for (const path of pagesOf(o)) {
        // A server's first render of a route can order its chunks differently and carry
        // another Link header. The status and what the page says may not differ.
        const cold = await answer(o, path)
        const { res, print } = await answer(o, path)
        const shape = (r: typeof res) => documentShape(r, FLAG_ON_PORT)
        expect([shape(cold.res).status, shape(cold.res).bodySha], key(o, path)).toEqual([shape(res).status, shape(res).bodySha])
        first.set(key(o, path), print)
        expect(res.status, key(o, path)).toBeLessThan(500)
        expect(String(res.headers['cache-control']), key(o, path)).toContain('no-store')
        expect(res.headers['x-nextjs-cache'], key(o, path)).toBeUndefined()
        expect(res.body, key(o, path)).not.toContain(other.marker)
        expect(res.body, key(o, path)).not.toContain(other.eventSlug)
        expect(res.body, key(o, path)).not.toContain(other.tenantSlug)
      }
    }
    // Pages that read a record: a mix-up here is one tenant's page on the other's host.
    for (const o of OWNERS) {
      const { res } = await answer(o, `/survey/${o.surveyToken}`)
      expect(res.status).toBe(200)
      expect(res.body).toContain(eventTitle(o))
    }
  })

  test('two tenants’ answers to the same URL are told apart', async () => {
    for (const path of ['/', '/sign', '/check-in']) {
      const [a, b] = [await answer(OWNER_A, path), await answer(OWNER_B, path)]
      expect(a.res.status, path).toBe(200)
      expect(b.res.status, path).toBe(200)
      // The route data names the tenant the rewrite chose, on a page with no other sign of it.
      expect(a.res.body, path).toContain(routeData(OWNER_A))
      expect(b.res.body, path).toContain(routeData(OWNER_B))
      expect(differences(a.print, b.print), path).toContainEqual(expect.stringMatching(/^body/))
    }
  })

  test('a shared URL reads its own tenant’s data, on every request, and no other’s', async () => {
    const reads = async (o: RecordOwner) => (await stubStats()).tenantReads[`event_settings ${o.tenantId}`] ?? 0
    for (let round = 0; round < ROUNDS; round++) {
      for (const order of [OWNERS, [...OWNERS].reverse()]) {
        for (const o of order) {
          const other = o === OWNER_A ? OWNER_B : OWNER_A
          const [mine, theirs] = [await reads(o), await reads(other)]
          expect((await answer(o, '/check-in')).res.status).toBe(200)
          expect(await reads(o), `${o.name} round ${round}`).toBe(mine + 1)
          expect(await reads(other), `${o.name} round ${round}`).toBe(theirs)
        }
      }
    }
  })

  test(`alternating ${ROUNDS} times, each keeps its own hash`, async () => {
    const moved: string[] = []
    for (let round = 0; round < ROUNDS; round++) {
      // Each order, so neither tenant is always the first to warm a page.
      for (const order of [OWNERS, [...OWNERS].reverse()]) {
        for (const path of sharedPages) {
          for (const o of order) {
            const diff = differences(first.get(key(o, path)) as Fingerprint, (await answer(o, path)).print)
            if (diff.length) moved.push(`round ${round} ${key(o, path)}: ${diff.join(', ')}`)
          }
        }
        for (const o of order) {
          for (const path of pagesOf(o).slice(sharedPages.length)) {
            const diff = differences(first.get(key(o, path)) as Fingerprint, (await answer(o, path)).print)
            if (diff.length) moved.push(`round ${round} ${key(o, path)}: ${diff.join(', ')}`)
          }
        }
      }
    }
    expect(moved).toEqual([])
  })

  test('asked at once, each still keeps its own hash', async () => {
    const moved: string[] = []
    for (const path of sharedPages) {
      const asks = Array.from({ length: 12 }, (_, i) => OWNERS[i % 2])
      const answers = await Promise.all(asks.map(async (o) => ({ o, print: (await answer(o, path)).print })))
      for (const { o, print } of answers) {
        const diff = differences(first.get(key(o, path)) as Fingerprint, print)
        if (diff.length) moved.push(`${key(o, path)}: ${diff.join(', ')}`)
      }
    }
    expect(moved).toEqual([])
  })
})

// Not the check: it would pass with no tenant page at all. It says the other way round
// holds too, that a Stellr page is not changed by what the tenant hosts just asked for.
test('a Stellr host in the zone keeps its own answer through it', async () => {
  const before = fingerprint(await rawGet(FLAG_ON_PORT, STELLR_ZONE_HOST, '/about'), FLAG_ON_PORT)
  await Promise.all(OWNERS.map((o) => rawGet(FLAG_ON_PORT, o.host, '/')))
  const after = fingerprint(await rawGet(FLAG_ON_PORT, STELLR_ZONE_HOST, '/about'), FLAG_ON_PORT)
  expect(differences(before, after)).toEqual([])
})
