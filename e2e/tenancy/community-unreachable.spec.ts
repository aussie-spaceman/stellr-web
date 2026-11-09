import { expect, test } from '@playwright/test'
import { ROUTE_MANIFEST } from '../../lib/security/route-manifest'
import { CANARY_HOST, FLAG_ON_PORT, UNKNOWN_ZONE_HOST, mapLimit, rawGet } from '../fixtures/tenant-hosts'
import { pagePathForFile } from './page-routes'

/**
 * The S5 gate "0 community routes on tenant hosts" (B9), on the production build: all
 * 80 community and home entries answer 404 on a tenant host and on an unknown host in
 * the zone. test/proxy-tenant-routing.test.ts has the same table with a session.
 *
 * The control is localhost on the same server. These requests have no session and no
 * records, so a member page can answer 404 there too. An API route is the one that
 * shows the difference, because its own guard answers it.
 */

const ENTRIES = Object.keys(ROUTE_MANIFEST).filter((file) =>
  /^app\/(?:\(stellr\)\/\(member\)\/community\/|api\/community\/|\(stellr\)\/\(member\)\/home\/)/.test(file),
)
const PATHS = ENTRIES.map(pagePathForFile)
const API_PATHS = PATHS.filter((path) => path.startsWith('/api/'))

test('the table has all 80 entries', () => {
  expect(ENTRIES).toHaveLength(80)
  expect(new Set(PATHS).size).toBe(80)
  expect(API_PATHS).toHaveLength(40)
})

test('every community and home URL answers 404 on a tenant host', async () => {
  const answers = await mapLimit(PATHS, 8, async (path) => ({ path, status: (await rawGet(FLAG_ON_PORT, CANARY_HOST, path)).status }))
  expect(answers.filter((a) => a.status !== 404)).toEqual([])
})

test('every community and home URL answers 404 on an unknown host in the zone', async () => {
  const answers = await mapLimit(PATHS, 8, async (path) => ({
    path,
    status: (await rawGet(FLAG_ON_PORT, UNKNOWN_ZONE_HOST, path, { 'X-Forwarded-Host': CANARY_HOST })).status,
  }))
  expect(answers.filter((a) => a.status !== 404)).toEqual([])
})

test('the control: the community APIs answer from their own routes on localhost', async () => {
  const answers = await mapLimit(API_PATHS, 8, async (path) => ({ path, status: (await rawGet(FLAG_ON_PORT, 'localhost', path)).status }))
  const reached = answers.filter((a) => a.status !== 404)
  // Most routes refuse a signed-out GET. A route may still answer 404 for no record.
  expect(reached.length, JSON.stringify(answers)).toBeGreaterThanOrEqual(30)
})
