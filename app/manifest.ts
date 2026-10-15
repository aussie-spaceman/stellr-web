import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { tokens } from '@/lib/tokens'
import { APP_HOST } from '@/lib/env'

/**
 * Web app manifest, so "Add to Home Screen" gives a named Stellr icon instead
 * of a generic page shortcut. Saved from the member app it opens the member
 * home; saved from the public site it opens the home page. (One deployment
 * serves both hosts, hence the host check.)
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const host = (await headers()).get('host') ?? ''
  const fromApp = host === APP_HOST

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
