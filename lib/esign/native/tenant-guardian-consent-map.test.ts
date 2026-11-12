// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { planTenantGuardianConsent, TENANT_GUARDIAN_CONSENT_TEMPLATE } from '@/lib/esign/tenant-guardian-consent'
import { initialValues, parseFieldMap, signerFields, validateSignerValues } from './template'
import { checkClean, checkPlacement } from './template-check'
import { extractPages } from './pdf-text'
import {
  buildDevPlaceholderPdf,
  DEV_PLACEHOLDER_MAPS,
  DEV_PLACEHOLDER_MARK,
  DEV_PLACEHOLDER_TITLE,
  devPlaceholderTargetRefusal,
  devPlaceholderTextHtml,
  isDevPlaceholderTitle,
} from './dev-placeholder'

// S5 wave 7, K5: the field map for the tenant guardian-consent document, and
// the dev placeholder that stands in for its wording on dev.

const MAP_FILE = 'lib/esign/native/templates/tenant-guardian-consent-v1.fields.json'
const map = parseFieldMap(JSON.parse(readFileSync(MAP_FILE, 'utf8')))

// Synthetic people only.
const plan = planTenantGuardianConsent({
  tenantId: '00000000-0000-4000-8000-0000000000c1',
  participantId: '00000000-0000-4000-8000-0000000000a1',
  eventSlug: 'canary-showcase',
  eventTitle: 'Canary Showcase',
  organiserName: 'Dev Canary',
  minorFirstName: 'Robin',
  minorLastName: 'Example',
  minorDateOfBirth: '2010-05-06',
  guardianFirstName: 'Sam',
  guardianLastName: 'Example',
  guardianEmail: 'Guardian@Example.test',
  relationship: 'Parent',
})

describe('tenant-guardian-consent-v1.fields.json', () => {
  it('is the map the dev placeholder uses for the platform-locked document key', () => {
    expect(DEV_PLACEHOLDER_MAPS[TENANT_GUARDIAN_CONSENT_TEMPLATE]).toBe(MAP_FILE)
    expect(plan.templateKey).toBe(TENANT_GUARDIAN_CONSENT_TEMPLATE)
  })

  it('has one signer, the guardian, who signs the document', () => {
    expect(map.roles).toEqual([{ role: 'guardian', order: 1, optional: false }])
    expect(plan.signers.map((s) => s.role)).toEqual(['guardian'])
    expect(new Set(map.fields.map((f) => f.role))).toEqual(new Set(['guardian']))
    const signatures = map.fields.filter((f) => f.type === 'signature')
    expect(signatures).toHaveLength(1)
    expect(signatures[0]).toMatchObject({ source: 'signer', required: true })
  })

  it('reads exactly the prefill keys planTenantGuardianConsent supplies, no more and no fewer', () => {
    const mapKeys = map.fields.filter((f) => f.source === 'prefill').map((f) => f.prefillKey as string)
    expect(new Set(mapKeys).size).toBe(mapKeys.length)
    expect([...mapKeys].sort()).toEqual(Object.keys(plan.prefill).sort())
  })

  it('does not print the birth-year check value: that gates the link, not the page', () => {
    expect(map.fields.some((f) => f.prefillKey === 'SubjectBirthYear')).toBe(false)
  })

  it('locks the organiser, the event, the child and the relationship; the guardian may correct only their own name and email', () => {
    const editable = signerFields(map, 'guardian').filter((f) => f.type !== 'signature').map((f) => f.name)
    expect(editable.sort()).toEqual(['GuardianEmail', 'GuardianName'])
    const values = initialValues(map, 'guardian', plan.prefill)
    expect(values).toEqual({ GuardianName: 'Sam Example', GuardianEmail: 'guardian@example.test' })
  })

  it('accepts the guardian’s submission and keeps the locked values as issued', () => {
    const result = validateSignerValues(map, 'guardian', plan.prefill, { GuardianName: 'Sam Example', GuardianEmail: 'guardian@example.test' })
    expect(result.ok).toBe(true)
    const tampered = validateSignerValues(map, 'guardian', plan.prefill, { GuardianName: 'Sam Example', GuardianEmail: 'guardian@example.test', EventTitle: 'Another event' })
    expect(tampered.ok).toBe(false)
  })
})

describe('dev placeholder document', () => {
  it('is titled as a placeholder', () => {
    expect(DEV_PLACEHOLDER_TITLE).toBe('DEV PLACEHOLDER – NOT A CONSENT FORM')
    expect(isDevPlaceholderTitle(DEV_PLACEHOLDER_TITLE)).toBe(true)
    expect(isDevPlaceholderTitle('Parent or Guardian Consent')).toBe(false)
    expect(isDevPlaceholderTitle(null)).toBe(false)
  })

  it('carries the mark on every page, is clean, and prints every field where the map says', async () => {
    const pdf = await buildDevPlaceholderPdf(map)
    const pages = await extractPages(pdf)
    expect(pages).toHaveLength(Math.max(...map.fields.map((f) => f.page)))
    for (const page of pages) {
      const text = page.items.map((i) => i.str).join(' ')
      expect(text).toContain(DEV_PLACEHOLDER_TITLE)
      expect(text.split(DEV_PLACEHOLDER_MARK).length - 1).toBeGreaterThanOrEqual(2)
    }
    expect(await checkClean(pdf)).toEqual([])
    expect(await checkPlacement(pdf, map)).toEqual([])
  })

  it('marks the text version too', () => {
    const html = devPlaceholderTextHtml(map)
    expect(html).toContain(`<title>${DEV_PLACEHOLDER_TITLE}</title>`)
    expect(html).toContain(`<h1>${DEV_PLACEHOLDER_TITLE}</h1>`)
    expect(html).toContain("<li>Child's full name</li>")
  })
})

describe('devPlaceholderTargetRefusal', () => {
  const dev = 'https://xvxlhbxtiwxpopoqjygm.supabase.co'

  it('allows the dev project and a stack on this machine', () => {
    expect(devPlaceholderTargetRefusal({ supabaseUrl: dev, appEnv: 'dev' })).toBeNull()
    expect(devPlaceholderTargetRefusal({ supabaseUrl: dev })).toBeNull()
    expect(devPlaceholderTargetRefusal({ supabaseUrl: 'http://127.0.0.1:54321' })).toBeNull()
  })

  it('refuses the production project', () => {
    expect(devPlaceholderTargetRefusal({ supabaseUrl: 'https://hwtzpfrnksksxlwwabqz.supabase.co' })).toMatch(/only to the dev project/)
  })

  it('refuses APP_ENV prod even on the dev URL', () => {
    expect(devPlaceholderTargetRefusal({ supabaseUrl: dev, appEnv: 'prod' })).toMatch(/NEXT_PUBLIC_APP_ENV is prod/)
    expect(devPlaceholderTargetRefusal({ supabaseUrl: dev, appEnv: ' PROD ' })).toMatch(/NEXT_PUBLIC_APP_ENV is prod/)
  })

  it('refuses an unknown, unset or look-alike target', () => {
    expect(devPlaceholderTargetRefusal({ supabaseUrl: 'https://other.supabase.co' })).not.toBeNull()
    expect(devPlaceholderTargetRefusal({ supabaseUrl: `https://evil.example/?x=xvxlhbxtiwxpopoqjygm.supabase.co` })).not.toBeNull()
    expect(devPlaceholderTargetRefusal({ supabaseUrl: 'xvxlhbxtiwxpopoqjygm.supabase.co' })).toMatch(/unset or not a URL/)
    expect(devPlaceholderTargetRefusal({})).toMatch(/unset or not a URL/)
  })
})
