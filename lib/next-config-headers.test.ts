import { describe, expect, it } from 'vitest'
import nextConfig, { VIDEO_PERMISSIONS_POLICY, VIDEO_ROUTES } from '../next.config.mjs'

// next.config.mjs `headers()`: Next applies every matching rule in order and a
// later rule overrides the same key. These tests resolve the effective value of
// a header for a path the same way.

type Rule = { source: string; has?: unknown[]; headers: { key: string; value: string }[] }

function toRegExp(source: string): RegExp {
  const pattern = source
    .split('/')
    .map((seg) => {
      if (seg === ':path*') return '(?:/.*)?'
      if (seg.startsWith(':')) return '/[^/]+'
      return seg ? `/${seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` : ''
    })
    .join('')
  return new RegExp(`^${pattern || '/'}$`)
}

async function effective(path: string, key: string): Promise<string | undefined> {
  const rules = (await nextConfig.headers!()) as Rule[]
  let value: string | undefined
  for (const rule of rules) {
    if (rule.has) continue
    if (!toRegExp(rule.source).test(path)) continue
    for (const h of rule.headers) if (h.key === key) value = h.value
  }
  return value
}

describe('Permissions-Policy', () => {
  it('keeps camera and microphone off on ordinary pages', async () => {
    for (const path of ['/', '/events', '/community', '/admin/members', '/sign']) {
      expect(await effective(path, 'Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=(), payment=(self)')
    }
  })

  it('lets the Jitsi origins use camera and microphone on video routes', async () => {
    const paths = [
      '/community/sessions/abc/room',
      '/community/training',
      '/community/training/mod-1',
      '/community/training/mod-1/item-2',
      '/admin/academy/training',
    ]
    for (const path of paths) {
      const value = await effective(path, 'Permissions-Policy')
      expect(value).toBe(VIDEO_PERMISSIONS_POLICY)
      expect(value).toContain('camera=(self "https://8x8.vc"')
      expect(value).toContain('microphone=(self "https://8x8.vc"')
      expect(value).toContain('geolocation=()')
    }
    expect(VIDEO_ROUTES.length).toBeGreaterThan(0)
  })

  it('lets the check-in desk use its own camera for the scanner, and nothing else', async () => {
    expect(await effective('/admin/competitions/nevada-space-design-challenge/check-in', 'Permissions-Policy')).toBe(
      'camera=(self), microphone=(), geolocation=(), payment=(self)'
    )
    for (const path of ['/admin/competitions/nevada-space-design-challenge', '/admin/competitions/nevada-space-design-challenge/check-in/poster']) {
      expect(await effective(path, 'Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=(), payment=(self)')
    }
  })
})

describe('check-in private-link headers', () => {
  it('never caches or indexes the check-in page or its API', async () => {
    for (const path of ['/check-in', '/check-in/nevada-space-design-challenge', '/api/check-in']) {
      expect(await effective(path, 'Cache-Control')).toBe('private, no-store')
      expect(await effective(path, 'Referrer-Policy')).toBe('no-referrer')
      expect(await effective(path, 'X-Robots-Tag')).toBe('noindex, nofollow')
    }
  })
})
