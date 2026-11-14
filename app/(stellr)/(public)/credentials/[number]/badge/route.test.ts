// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { STELLR_TENANT_ID as STELLR } from '@/lib/tenancy/constants'

// S5 A10a, decision W7-10: the badge PNG is Stellr's. Another tenant's public, valid
// credential gets the generic badge, as a number nobody holds does, so the URL never
// confirms it. A NULL tenant is a Stellr row the backfill has not reached.

const CANARY = 'c0000000-0000-4000-8000-0000000000aa'

const h = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  element: null as ReactElement<{ children: ReactElement<{ accent: string }> }> | null,
}))

// Capture the element ImageResponse is given, without rendering it.
vi.mock('next/og', () => ({
  ImageResponse: class {
    constructor(el: ReactElement<{ children: ReactElement<{ accent: string }> }>) {
      h.element = el
    }
  },
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.row, error: null }) }) }),
    }),
  }),
}))

const { GET } = await import('./route')
const { badgeAccent } = await import('./glyph')

const publicValid = (tenant: string | null) => ({
  theme: 'environmental', status: 'issued', expires_at: null, tombstoned_at: null, visibility: 'public', tenant_id: tenant,
})

async function accentFor(row: Record<string, unknown> | null): Promise<string> {
  h.row = row
  h.element = null
  await GET(new Request('https://www.example.test/credentials/STL-2026-AAAAAAAA/badge'), { params: Promise.resolve({ number: 'STL-2026-AAAAAAAA' }) })
  return h.element!.props.children.props.accent
}

beforeEach(() => {
  h.row = null
})

describe('GET /credentials/[number]/badge (W7-10)', () => {
  it("draws Stellr's public credential in its theme, a NULL tenant included", async () => {
    expect(await accentFor(publicValid(STELLR))).toBe(badgeAccent('environmental'))
    expect(await accentFor(publicValid(null))).toBe(badgeAccent('environmental'))
  })

  it("gives another tenant's public, valid credential the generic badge, as for a missing number", async () => {
    const generic = await accentFor(null)
    expect(generic).toBe(badgeAccent(null))
    expect(generic).not.toBe(badgeAccent('environmental'))
    expect(await accentFor(publicValid(CANARY))).toBe(generic)
  })

  it('a row whose select lost the tenant column is not taken for Stellr', async () => {
    const { tenant_id: _tenantId, ...noTenant } = publicValid(STELLR)
    expect(await accentFor(noTenant)).toBe(badgeAccent(null))
  })
})
