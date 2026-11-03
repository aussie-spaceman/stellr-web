// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Every script the app itself renders or injects, pinned for the S1
// Content-Security-Policy. S0 adds no CSP; when S1 does, each of these needs a
// per-request nonce (inline code) or its host allowed (external code):
//
//   components/analytics/ConsentMode.tsx — inline <script> in <head>: consent
//     defaults and the no-ads flag, which must run before GTM. Nonce.
//   components/analytics/GoogleTagManager.tsx — next/script id="gtm-init",
//     inline. Nonce; the tags GTM then injects need 'strict-dynamic' or the
//     Google tag hosts.
//   components/analytics/HubSpotTracking.tsx, HubSpotTrackingConsented.tsx —
//     next/script loading js.hs-scripts.com, which loads further HubSpot
//     scripts. Nonce with 'strict-dynamic', or the HubSpot hosts.
//   components/video/VideoRoom.tsx — injects the video provider's
//     external_api.js. Its host, or 'strict-dynamic' from a nonced parent.
//   components/seo/JsonLd.tsx — a JSON-LD data block. Never executed, so no
//     nonce.
//
// Outside this tree, S1 also has Next.js's own inline bootstrap scripts (it
// stamps the nonce itself when middleware sets one), Clerk's clerk-js loader
// (ClerkProvider takes a `nonce`), and Vercel Analytics / Speed Insights
// (same-origin /_vercel scripts).
//
// A new script anywhere in app/, components/, lib/ or packages/ fails this test
// until it is added here, with what S1 must do for it.

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
