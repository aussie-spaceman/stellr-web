// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { DEV_PLACEHOLDER_TITLE } from './dev-placeholder'
import { loadActiveTemplate, TemplateUnavailableError } from './templates-store'

// S5 wave 7, K5: the production app never issues against the dev placeholder,
// even if one were approved and active there.

const fieldMap = {
  roles: [{ role: 'guardian', order: 1 }],
  fields: [{ name: 'guardian_signature', label: 'Signature', role: 'guardian', type: 'signature', source: 'signer', page: 1, x: 100, y: 300, required: true }],
}

function version(title: string) {
  return {
    id: 'tgc-1', key: 'tenant_guardian_consent', version: 1, title, pdf_path: 'tenant_guardian_consent/v1-000000000000.pdf',
    pdf_sha256: '0'.repeat(64), field_map: fieldMap, text_html: null, disclosure_version: 'd1',
    approved_at: '2026-11-12T00:00:00Z', active: true,
  }
}

describe('loadActiveTemplate and the dev placeholder', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('refuses an active placeholder on the production app', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'prod')
    const db = fakeSupabase({ esign_templates: [version(DEV_PLACEHOLDER_TITLE)] })
    await expect(loadActiveTemplate(db.client, 'tenant_guardian_consent')).rejects.toBeInstanceOf(TemplateUnavailableError)
    await expect(loadActiveTemplate(db.client, 'tenant_guardian_consent')).rejects.toThrow(/dev placeholder/)
  })

  it('uses it on dev, and a real document on production', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'dev')
    const dev = fakeSupabase({ esign_templates: [version(DEV_PLACEHOLDER_TITLE)] })
    expect((await loadActiveTemplate(dev.client, 'tenant_guardian_consent')).title).toBe(DEV_PLACEHOLDER_TITLE)

    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'prod')
    const prod = fakeSupabase({ esign_templates: [version('Parent or Guardian Consent')] })
    expect((await loadActiveTemplate(prod.client, 'tenant_guardian_consent')).title).toBe('Parent or Guardian Consent')
  })
})
