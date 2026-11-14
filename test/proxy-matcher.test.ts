import { describe, expect, it } from 'vitest'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { config } from '@/proxy'

// Every request the proxy matches is a run on Vercel's metered CPU, so its
// matcher decides cost as well as auth. These pin both halves.

// On a Stellr host: any other host also takes the tenant routing entry (S5, B5,
// test/proxy-tenant-routing.test.ts).
const matches = (url: string) =>
  unstable_doesMiddlewareMatch({ config, url: `http://localhost:3000${url}`, headers: { host: 'localhost:3000' } })

describe('proxy matcher', () => {
  it('skips the image watermarker, which reads no session', () => {
    expect(matches('/api/img?src=https%3A%2F%2Fcdn.sanity.io%2Fimages%2Fx%2Fproduction%2Fa-10x10.jpg')).toBe(false)
    expect(matches('/api/img')).toBe(false)
  })

  it('still runs on every other API route, admin page and page', () => {
    expect(matches('/api/images')).toBe(true)
    expect(matches('/api/admin/events/slug-guard?id=x&slug=y')).toBe(true)
    expect(matches('/api/register/group')).toBe(true)
    expect(matches('/admin/members')).toBe(true)
    expect(matches('/admin/competitions/nevada-space-design-challenge/check-in')).toBe(true)
    expect(matches('/api/check-in-desk/manifest?slug=nevada')).toBe(true)
    expect(matches('/account')).toBe(true)
    expect(matches('/')).toBe(true)
    expect(matches('/events/nevada-space-design-challenge')).toBe(true)
  })

  // proxy-matcher-gated-prefixes.7: `_next` is skipped as a whole segment only.
  it('skips _next as a whole segment, and runs on a path that only starts with it', () => {
    expect(matches('/_next')).toBe(false)
    expect(matches('/_next/static/chunks/main.js')).toBe(false)
    expect(matches('/_next/static/media/font.woff2')).toBe(false)
    expect(matches('/_nextfoo')).toBe(true)
    expect(matches('/_next-admin')).toBe(true)
    expect(matches('/_nextx/y')).toBe(true)
  })

  it('skips Vercel beacons by exact path', () => {
    expect(matches('/_vercel/insights/view')).toBe(false)
    expect(matches('/_vercel/speed-insights/vitals')).toBe(false)
  })

  it('still runs on gated and look-alike paths ending in .txt, .xml or .php', () => {
    for (const path of [
      '/admin/x.txt',
      '/admin/members/x.xml',
      '/account/x.txt',
      '/community/x.xml',
      '/credentials/ABC.txt',
      '/team-profile/token.txt',
      '/survey/token.xml',
      '/check-in/x.txt',
      '/register/slug/join/token.xml',
      '/api/admin/members/x.txt',
      '/wp-admin/install.php',
      '/robots.txt',
      '/sitemap.xml',
      '/_vercel',
      '/_vercelx',
    ]) {
      expect(matches(path), path).toBe(true)
    }
  })

  it('skips static files and the manifests', () => {
    expect(matches('/manifest.webmanifest')).toBe(false)
    expect(matches('/app.webmanifest')).toBe(false)
    expect(matches('/images/logo-icon.svg')).toBe(false)
    // The check-in desk's service worker and scanner reader.
    expect(matches('/check-in-desk-sw.js')).toBe(false)
    expect(matches('/vendor/zxing_reader.wasm')).toBe(false)
  })

  // A skipped path never reaches the admin role gate, so a gated path must run
  // the proxy however it ends. The first matcher entry would skip all of these.
  it.each([
    '/admin/members/abc.css',
    '/admin/members/abc.png/view-as',
    '/admin/x.js/y',
    '/admin/members/abc.jsfoo',
    '/account/x.jpg',
    '/community/x.png',
    '/community/x.png/members',
    '/home/x.png',
    '/campaigns/x.css/submit',
    '/credentials/ABC.png',
    '/credentials/ABC.png/badge',
    '/team-profile/tok.png',
    '/survey/tok.js',
    '/survey/event/x.css',
    '/register/x.css',
    '/register/x.css/join/tok',
    '/register/slug/pay/tok.png',
    '/sign/x.js',
    '/check-in/x.css',
    '/check-in/x.css/code',
    '/scholarship/offer/tok.css',
    '/privacy/request/x.css',
    '/privacy/request/confirm/x.png',
  ])('runs on %s, a gated path with a file extension', (path) => {
    expect(matches(path)).toBe(true)
  })

  // Each of these only shares its first letters with a gated prefix, or is a
  // real file, so running the proxy here would be a metered run for nothing.
  it.each([
    '/check-in-desk-sw.js',
    '/sign.js',
    '/signature-logo.png',
    '/email/signature-logo.png',
    '/homepage.png',
    '/registered.css',
    '/accounts.css',
    '/scholarship/x.png',
    '/scholarship/offers.png',
    '/privacy/x.png',
    '/privacy/requests.png',
    '/team/headshot.jpg',
    '/images/logo-icon.svg',
    '/fonts/x.woff2',
    '/icons/x.svg',
    '/icon.png',
    '/favicon.ico',
    '/_next/static/chunks/main.js',
    '/_next/image?url=%2Fimages%2Fx.png&w=64&q=75',
  ])('skips %s, which is not under a gated prefix', (path) => {
    expect(matches(path)).toBe(false)
  })
})
