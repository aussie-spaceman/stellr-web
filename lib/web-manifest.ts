import type { MetadataRoute } from 'next'
import { tokens } from '@/lib/tokens'

/**
 * Web app manifest, so "Add to Home Screen" gives a named Stellr icon instead
 * of a generic page shortcut. Saved from the member app it opens the member
 * home; saved from the public site it opens the home page.
 *
 * Both variants are static files built once: app/manifest.ts (www) and
 * app/app.webmanifest (the member app, which next.config rewrites
 * /manifest.webmanifest to on the app host). It used to read the Host header
 * per request, which made every manifest fetch a function run on Vercel
 * (21 Oct 2026).
 */
export function webManifest(fromApp: boolean): MetadataRoute.Manifest {
  return {
    name: fromApp ? 'My Stellr' : 'Stellr Education',
    short_name: 'Stellr',
    description: 'Design competitions, mentoring and training for middle and high school students.',
    start_url: fromApp ? '/home' : '/',
    scope: '/',
    display: 'standalone',
    background_color: tokens.color.white,
    theme_color: tokens.color.midnight,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
