import { describe, expect, it } from 'vitest'
import { LANDING_PAGES, LANDING_PAGE_SLUGS, getLandingPage } from './index'
import { GALLERY_SHOTS } from './shared'
import { PHOTOS } from '@/lib/media-manifest'

const configs = Object.values(LANDING_PAGES)

describe('landing page registry', () => {
  it('registers both audience pages', () => {
    expect(LANDING_PAGE_SLUGS).toEqual(['first-robotics-teachers', 'homeschool-students'])
  })

  it('keys every config by its own slug', () => {
    // A mismatch here means generateStaticParams builds one URL and the page
    // component looks up another — a 404 on a route that exists.
    for (const [key, config] of Object.entries(LANDING_PAGES)) {
      expect(config.slug).toBe(key)
    }
  })

  it('resolves a known slug and refuses an unknown one', () => {
    expect(getLandingPage('homeschool-students')?.audience).toBe('homeschool')
    expect(getLandingPage('not-a-page')).toBeUndefined()
  })
})

describe('landing page content', () => {
  it('gives every page eight FAQ items', () => {
    for (const config of configs) {
      expect(config.faq.items).toHaveLength(8)
    }
  })

  it('does not assume a reason count', () => {
    // Three on the robotics page, two on homeschool — straight from the flyers.
    // The layout must survive both, so the fixture asserts they really differ.
    expect(LANDING_PAGES['first-robotics-teachers'].why.reasons).toHaveLength(3)
    expect(LANDING_PAGES['homeschool-students'].why.reasons).toHaveLength(2)
  })

  it('points every photo id at a real manifest entry', () => {
    for (const config of configs) {
      expect(PHOTOS[config.hero.photoId], config.hero.photoId).toBeDefined()
      for (const shot of config.gallery?.shots ?? []) {
        expect(PHOTOS[shot.photoId], shot.photoId).toBeDefined()
      }
    }
  })

  it('never reuses a hero photo in the gallery', () => {
    // Both pages share one gallery, so a hero that appears in it would show the
    // same photograph twice on the same screen.
    const galleryIds = GALLERY_SHOTS.map((s) => s.photoId)
    for (const config of configs) {
      expect(galleryIds).not.toContain(config.hero.photoId)
    }
  })

  it('keeps the two audiences on distinct analytics sources', () => {
    // The b2b/b2c split in lib/analytics.ts is keyed by source, and it decides
    // which ad tags fire — LinkedIn should not fire on a homeschool parent.
    const sources = configs.map((c) => c.analyticsSource)
    expect(new Set(sources).size).toBe(configs.length)
  })

  it('hard-codes no location counts in approved copy', () => {
    // Every figure comes from lib/locations.ts. A typed number here is the exact
    // drift that left four different versions of these counts in the handoff.
    const banned = /\b(eleven|ten|nine|eight|seven|six|five|four)\b\s+(locations|states)/i
    for (const config of configs) {
      const strings = [
        config.hero.eyebrow,
        config.seo.description,
        ...config.faq.items.map((i) => i.a),
      ]
      for (const s of strings) {
        expect(s, s).not.toMatch(banned)
      }
    }
  })

  it('does not promise a specific call length the calendar cannot honour', () => {
    // Motion offers 15 or 30 minutes. The flyer-era copy promised 20.
    for (const config of configs) {
      const strings = [config.form.reassurance, config.form.callNote, ...config.form.points]
      for (const s of strings) {
        expect(s, s).not.toMatch(/20[- ]minute/i)
      }
    }
  })
})
