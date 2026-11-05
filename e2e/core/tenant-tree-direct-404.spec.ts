import http from 'node:http'
import { expect, test } from '../fixtures/test'

/**
 * The internal tenant tree answers 404 to a direct request, on the production build.
 *
 * Raw node:http on purpose. A browser and fetch both tidy a URL before sending it,
 * and what matters here is the matcher and the routing against the exact bytes on
 * the wire. The first matcher entry excludes any path with a static extension in
 * it, so the dotted variants below only reach the proxy through its dedicated entry.
 * Flag off: the check is always on, and CI runs with routing off.
 */

const PATHS = [
  '/_t',
  '/_t/stellr',
  '/_t/canary-academy',
  '/%5Ft/stellr',
  '/%5ft/stellr',
  '/_%74/stellr',
  '/%5F%74/stellr',
  '/_t/stellr/x.html',
  '/_t/stellr/x.png',
  '/_t/stellr/x.pngfoo',
  '/%5Ft/stellr/x.html',
  '/%5Ft/stellr/x.png',
  '/%5Ft/stellr/x.pngfoo',
  '/%5ft/stellr/x.css/y',
  '/_%74/stellr/x.png',
]

function rawGet(baseURL: string, path: string): Promise<{ status: number; body: string }> {
  const { hostname, port } = new URL(baseURL)
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname, port, path, method: 'GET' }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end()
  })
}

test.describe('the tenant tree, requested directly', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  for (const path of PATHS) {
    test(`${path} is a 404`, async ({ baseURL }) => {
      test.skip(!baseURL?.startsWith('http://'), 'raw http only reaches a local server')
      const res = await rawGet(baseURL as string, path)
      expect(res.status).toBe(404)
      // Not the tree's own page behind a 200-then-404, and not its not-found either.
      expect(res.body).not.toContain('Follow the link you were sent')
      expect(res.body).not.toContain('We can’t find that page')
    })
  }
})
