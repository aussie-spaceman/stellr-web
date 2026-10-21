import { webManifest } from '@/lib/web-manifest'

/**
 * The member app's manifest. next.config rewrites /manifest.webmanifest here on
 * the app host, so the root layout's <link rel="manifest"> needs no host check.
 * force-static: built once at deploy, never a function run (lib/web-manifest).
 */
export const dynamic = 'force-static'

export function GET() {
  return new Response(JSON.stringify(webManifest(true)), {
    headers: { 'Content-Type': 'application/manifest+json' },
  })
}
