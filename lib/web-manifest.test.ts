import { describe, expect, it } from 'vitest'
import { webManifest } from '@/lib/web-manifest'
import nextConfig from '../next.config.mjs'
import wwwManifest from '../app/manifest'
import { GET as appManifest, dynamic as appManifestDynamic } from '../app/app.webmanifest/route'

// Both manifests are static files (no function run per fetch); the app host
// gets its own through a next.config rewrite rather than a Host-header check.

describe('web manifest', () => {
  it('opens the home page from www and the member home from the app', () => {
    expect(webManifest(false)).toMatchObject({ name: 'Stellr Education', start_url: '/' })
    expect(webManifest(true)).toMatchObject({ name: 'My Stellr', start_url: '/home' })
  })

  it('serves the www variant at /manifest.webmanifest and the app variant as a static route', async () => {
    expect(wwwManifest()).toEqual(webManifest(false))
    expect(appManifestDynamic).toBe('force-static')
    const res = appManifest()
    expect(res.headers.get('content-type')).toBe('application/manifest+json')
    expect(await res.json()).toEqual(webManifest(true))
  })

  it('rewrites /manifest.webmanifest to the app variant on the app host only', async () => {
    const rewrites = (await nextConfig.rewrites!()) as { beforeFiles: unknown[] }
    expect(rewrites.beforeFiles).toContainEqual({
      source: '/manifest.webmanifest',
      has: [{ type: 'host', value: new URL(process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org').host }],
      destination: '/app.webmanifest',
    })
  })
})
