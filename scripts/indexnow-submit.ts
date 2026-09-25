/**
 * Tell IndexNow engines (Bing and partners) that production URLs have changed.
 *
 *   INDEXNOW_KEY=… npm run indexnow                 # every URL in the live sitemap
 *   INDEXNOW_KEY=… npm run indexnow -- /news/foo    # just these paths
 *
 * Run after a promotion that adds or rewrites public pages. Reads the LIVE
 * sitemap, not the local one, so it only ever announces what is actually
 * deployed. Refuses unless the key it holds is the key production serves —
 * a mismatch would be rejected by the engines anyway, and silently.
 */

export {} // a module, so main() doesn't collide with other scripts' globals

const HOST = 'www.stellreducation.org'
const ORIGIN = `https://${HOST}`
const KEY_LOCATION = `${ORIGIN}/indexnow-key.txt`

async function main() {
  const key = process.env.INDEXNOW_KEY
  if (!key) throw new Error('INDEXNOW_KEY is not set.')

  const served = await fetch(KEY_LOCATION).then((r) => (r.ok ? r.text() : null))
  if (served?.trim() !== key) {
    throw new Error(`${KEY_LOCATION} does not serve this key (got ${served === null ? '404' : 'a different key'}). Set INDEXNOW_KEY on the production project and promote first.`)
  }

  const paths = process.argv.slice(2)
  const urls = paths.length
    ? paths.map((p) => new URL(p, ORIGIN).toString())
    : [...(await fetch(`${ORIGIN}/sitemap.xml`).then((r) => r.text())).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])

  if (urls.length === 0) throw new Error('No URLs to submit.')

  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key, keyLocation: KEY_LOCATION, urlList: urls }),
  })
  // 200 = accepted, 202 = accepted pending key validation. Anything else is a failure.
  if (res.status !== 200 && res.status !== 202) {
    throw new Error(`IndexNow returned ${res.status}: ${await res.text()}`)
  }
  console.log(`IndexNow accepted ${urls.length} URL(s) (HTTP ${res.status}).`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
