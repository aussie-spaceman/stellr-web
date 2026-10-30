import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// Default artwork (30 Oct 2026): every certificate and badge slot falls back to
// its theme's default, an event's own upload wins, and replacing a default
// never changes a certificate an event has already issued.

vi.mock('@/lib/supabase', () => ({ supabaseServer: vi.fn() }))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: vi.fn(async () => null) }))

const { artworkTheme } = await import('./artwork-theme')
const { effectiveTemplates, pinDefaultCertificate } = await import('./event-certificates')
const { effectiveBadgeTemplates } = await import('./event-badges')
const { eventArtworkTheme } = await import('./artwork-defaults')
import type { CertificateTemplate, TemplateSet } from './event-certificates'
import type { BadgeTemplate } from './event-badges'

const cert = (award_type: CertificateTemplate['award_type'], source: CertificateTemplate['source'], artwork_path = `${source}/${award_type}.png`): CertificateTemplate => ({
  award_type, artwork_path, name_y: 0.545, name_max_width: 0.5, name_size: 40, updated_at: '', source,
})
const set = (...ts: CertificateTemplate[]): TemplateSet => {
  const out = { participation: null, overall_champion: null, norm_chaffee: null, anita_gale: null, dick_edwards: null, mentor: null } as TemplateSet
  for (const t of ts) out[t.award_type] = t
  return out
}

describe('artworkTheme', () => {
  it('reads a Sanity type, a credential theme or a slug the same way as themeFromType', () => {
    expect(artworkTheme('Environmental Design Challenge')).toBe('environmental')
    expect(artworkTheme('environmental')).toBe('environmental')
    expect(artworkTheme('minnesota-environmental-design-challenge')).toBe('environmental')
    expect(artworkTheme('colorado-space-design-challenge')).toBe('space')
    expect(artworkTheme(null)).toBe('space')
  })

  it('falls back to the slug when Sanity has no event (CI)', async () => {
    expect(await eventArtworkTheme('uruguay-environmental-design-challenge')).toBe('environmental')
    expect(await eventArtworkTheme('nevada-space-design-challenge')).toBe('space')
  })
})

describe('effectiveTemplates', () => {
  it("prints the event's own artwork, else the default, else nothing", () => {
    const own = set(cert('participation', 'event'))
    const defaults = set(cert('participation', 'default'), cert('mentor', 'default'))
    const out = effectiveTemplates(own, defaults)
    expect(out.participation?.source).toBe('event')
    expect(out.mentor?.source).toBe('default')
    expect(out.anita_gale).toBeNull()
  })
})

const badge = (id: string, format: BadgeTemplate['format'], audience: BadgeTemplate['audience'], source: BadgeTemplate['source'], company_id: string | null = null): BadgeTemplate => ({
  id, format, audience, company_id, artwork_path: `${id}.png`, name_x: null, name_y: null, name_max_width: null, name_size: null, updated_at: '', source,
})

describe('effectiveBadgeTemplates', () => {
  const defaults = [
    badge('d-everyone-5392', 'avery_5392', 'everyone', 'default'),
    badge('d-mentors-5392', 'avery_5392', 'mentors', 'default'),
    badge('d-everyone-8395', 'avery_8395', 'everyone', 'default'),
  ]

  it('fills only the everyone/mentors slots the event has not uploaded, per format', () => {
    const own = [badge('e-everyone-5392', 'avery_5392', 'everyone', 'event'), badge('e-co1', 'avery_5392', 'company', 'event', 'co1')]
    const ids = effectiveBadgeTemplates(own, defaults).map((t) => t.id).sort()
    expect(ids).toEqual(['d-everyone-8395', 'd-mentors-5392', 'e-co1', 'e-everyone-5392'])
  })

  it('a company background does not count as the event filling the everyone slot', () => {
    const own = [badge('e-co1', 'avery_8395', 'company', 'event', 'co1')]
    expect(effectiveBadgeTemplates(own, defaults).map((t) => t.id)).toContain('d-everyone-8395')
  })

  it('an event with nothing of its own prints the defaults', () => {
    expect(effectiveBadgeTemplates([], defaults)).toEqual(defaults)
  })
})

/** A db that answers the two reads pinDefaultCertificate makes and records the upsert. */
function pinDb(issued: string[], own: string[]) {
  const upserts: Record<string, unknown>[][] = []
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'not', 'order', 'in']) c[m] = () => c
    c.range = () => c
    c.then = (onF: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(onF)
    return c
  }
  const db = {
    from: (table: string) => {
      if (table === 'credentials') return chain(issued.map((event_slug) => ({ event_slug })))
      return {
        ...chain(own.map((event_slug) => ({ event_slug }))),
        upsert: async (rows: Record<string, unknown>[]) => (upserts.push(rows), { error: null }),
      }
    },
  } as unknown as SupabaseClient
  return { db, upserts }
}

describe('pinDefaultCertificate', () => {
  const outgoing = cert('participation', 'default', 'event-artwork/colorado-space-design-challenge/certificate-1.png')

  it('copies the outgoing default to each event that issued on it and has none of its own', async () => {
    const { db, upserts } = pinDb(['nevada-space-design-challenge', 'north-carolina-space-design-challenge'], ['north-carolina-space-design-challenge'])
    expect(await pinDefaultCertificate(db, 'space', outgoing)).toBe(1)
    expect(upserts).toHaveLength(1)
    expect(upserts[0]).toEqual([
      {
        event_slug: 'nevada-space-design-challenge',
        award_type: 'participation',
        artwork_path: outgoing.artwork_path,
        name_y: 0.545,
        name_max_width: 0.5,
        name_size: 40,
      },
    ])
  })

  it('pins nothing when no event has issued the award', async () => {
    const { db, upserts } = pinDb([], [])
    expect(await pinDefaultCertificate(db, 'space', outgoing)).toBe(0)
    expect(upserts).toHaveLength(0)
  })
})
