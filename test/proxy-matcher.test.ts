import { describe, expect, it } from 'vitest'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { config } from '@/proxy'

// Every request the proxy matches is a run on Vercel's metered CPU, so its
// matcher decides cost as well as auth. These pin both halves.

const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url })

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
    expect(matches('/account')).toBe(true)
    expect(matches('/')).toBe(true)
    expect(matches('/events/nevada-space-design-challenge')).toBe(true)
  })

  it('skips static files and the manifests', () => {
    expect(matches('/manifest.webmanifest')).toBe(false)
    expect(matches('/app.webmanifest')).toBe(false)
    expect(matches('/images/logo-icon.svg')).toBe(false)
  })
})
