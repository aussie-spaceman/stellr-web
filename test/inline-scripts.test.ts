// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Every script the app itself renders or injects, and how the S1
// Content-Security-Policy (Report-Only, lib/csp.ts) allows it. Routes that
// render per request get a nonce policy; prerendered public pages get a host
// policy that allows inline script and names the script hosts.
//
//   components/analytics/ConsentMode.tsx — inline <script> in <head>: consent
//     defaults and the no-ads flag, which must run before GTM. It is in the
//     prerendered root layout, so no nonce: its sha256 hash is in the nonce
//     policy (consentModeScript(); test/csp.test.ts checks the hash).
//   components/analytics/GoogleTagManager.tsx — next/script id="gtm-init",
//     inline. Next stamps the nonce on it; gtm.js and the tags it injects run
//     under 'strict-dynamic' (nonce policy) or the Google hosts (host policy).
//   components/analytics/HubSpotTracking.tsx, HubSpotTrackingConsented.tsx —
//     next/script loading js.hs-scripts.com, which loads further HubSpot
//     scripts. Nonce plus 'strict-dynamic', or the HubSpot hosts.
//   components/video/VideoRoom.tsx — injects the video provider's
//     external_api.js. 'strict-dynamic' from a nonced Next chunk, or the
//     Jitsi hosts.
//   components/seo/JsonLd.tsx — a JSON-LD data block. Never executed, so no
//     nonce.
//
// Outside this tree: Next.js's own inline bootstrap scripts (Next stamps the
// nonce it reads from the policy proxy.ts puts on the request headers), Clerk's
// clerk-js loader and Turnstile (inserted by script, so 'strict-dynamic'; the
// Clerk Frontend API host in the host policy), and Vercel Analytics / Speed
// Insights (same-origin /_vercel scripts).
//
// A new script anywhere in app/, components/, lib/ or packages/ fails this test
// until it is added here, with how lib/csp.ts allows it.

const ROOTS = ['app', 'components', 'lib', 'packages']
const REPO = fileURLToPath(new URL('..', import.meta.url))

// A script element, next/script, or a script built in the browser — on a code
// line, not in a comment.
const SCRIPT = /<script\b|<Script\b|from ['"]next\/script['"]|createElement\(\s*['"]script['"]/g
const COMMENT_LINE = /^\s*(?:\/\/|\/?\*|\{\/\*)/

function sources(): string[] {
  return ROOTS.flatMap((root) =>
    (readdirSync(join(REPO, root), { recursive: true }) as string[])
      .map((p) => `${root}/${p.replace(/\\/g, '/')}`)
      .filter((p) => !p.includes('node_modules/'))
      .filter((p) => /\.(tsx?|jsx?|mjs)$/.test(p) && !/\.(test|stories)\.tsx?$/.test(p)),
  )
}

describe('scripts the app renders (S1 CSP inventory)', () => {
  it('is exactly the list above', () => {
    const found = sources().flatMap((f) => {
      const n = readFileSync(join(REPO, f), 'utf8')
        .split('\n')
        .filter((line) => !COMMENT_LINE.test(line))
        .reduce((sum, line) => sum + (line.match(SCRIPT)?.length ?? 0), 0)
      return n > 0 ? [`${f} (${n})`] : []
    })
    expect(found).toEqual(
      [
        'components/analytics/ConsentMode.tsx (1)',
        'components/analytics/GoogleTagManager.tsx (2)', // the import and the element
        'components/analytics/HubSpotTracking.tsx (2)',
        'components/analytics/HubSpotTrackingConsented.tsx (2)',
        'components/seo/JsonLd.tsx (1)',
        'components/video/VideoRoom.tsx (1)',
      ].sort(),
    )
  })
})
