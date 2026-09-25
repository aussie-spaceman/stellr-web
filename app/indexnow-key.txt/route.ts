/**
 * IndexNow key file. IndexNow (Bing, Yandex, Seznam, Naver — and through Bing,
 * ChatGPT search) verifies a submission by fetching the key from the host it
 * names. The protocol allows any path via `keyLocation`, so the key lives at a
 * fixed URL rather than /<key>.txt, which would need a catch-all route.
 *
 * Unset (dev, local) → 404, so a non-production host can never validate a ping
 * for the production property. Submitting is scripts/indexnow-submit.ts.
 */

export const dynamic = 'force-static'

export function GET() {
  const key = process.env.INDEXNOW_KEY
  if (!key) return new Response('Not found', { status: 404 })
  return new Response(key, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
