// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { convertDocusignTemplate, positionKey, type DocusignExport } from './convert-docusign'

const tab = (over: Record<string, string>) => ({ pageNumber: '4', xPosition: '100', yPosition: '200', ...over })

const exportFor = (extraGuardianTabs: Record<string, unknown[]> = {}): DocusignExport => ({
  recipients: {
    signers: [
      {
        roleName: 'Guardian',
        tabs: {
          signHereTabs: [tab({ tabLabel: 'Signature 1aada73f' })],
          dateSignedTabs: [tab({ tabLabel: 'Date Signed 217e', xPosition: '374' })],
          textTabs: [tab({ tabLabel: 'GuardianPhone', yPosition: '472', required: 'true', locked: 'false' })],
          tabGroups: [{ tabLabel: '' }],
          ...extraGuardianTabs,
        } as never,
      },
      {
        roleName: 'Minor',
        tabs: { signHereTabs: [tab({ tabLabel: 'Signature 513c', yPosition: '585' })] } as never,
      },
    ],
  },
})

describe('convertDocusignTemplate', () => {
  it('keeps positions and maps roles, prefills and system fields', () => {
    const { map, issues } = convertDocusignTemplate(exportFor())
    expect(issues).toEqual([])
    expect(map?.roles).toEqual([
      { role: 'guardian', order: 1, optional: false },
      { role: 'student', order: 2, optional: true },
    ])
    const phone = map?.fields.find((f) => f.name === 'GuardianPhone')
    expect(phone).toMatchObject({ source: 'prefill', prefillKey: 'GuardianPhone', page: 4, x: 100, y: 472, required: true, locked: false })
    expect(map?.fields.find((f) => f.name === 'guardian_date_signed')?.source).toBe('system')
  })

  it('fails on a field DocuSign never named, until an override names it', () => {
    const exp = exportFor({ checkboxTabs: [tab({ tabLabel: 'Checkbox 4f0e538d', pageNumber: '2', xPosition: '50', yPosition: '454' })] })
    const failed = convertDocusignTemplate(exp)
    expect(failed.map).toBeNull()
    expect(failed.issues[0].reason).toMatch(/never named/)

    const key = positionKey({ pageNumber: '2', xPosition: '50', yPosition: '454' })
    expect(key).toBe('p2@50,454')
    const fixed = convertDocusignTemplate(exp, { fields: { [key]: { name: 'MediaOptOut', label: 'I do NOT consent to photo and media use' } } })
    expect(fixed.issues).toEqual([])
    expect(fixed.map?.fields.find((f) => f.name === 'MediaOptOut')).toMatchObject({ type: 'checkbox', source: 'signer', page: 2 })
  })

  it('recognises the credential opt-out DocuSign already names', () => {
    const exp = exportFor({ checkboxTabs: [tab({ tabLabel: 'CredentialSharingOptOut', pageNumber: '3' })] })
    const { map, issues } = convertDocusignTemplate(exp)
    expect(issues).toEqual([])
    expect(map?.fields.find((f) => f.name === 'CredentialSharingOptOut')?.label).toMatch(/credential/)
  })

  it('refuses an unsupported field kind unless deliberately dropped', () => {
    const exp = exportFor({ listTabs: [tab({ tabLabel: 'com.docusign.extensibility.country', pageNumber: '1' })] })
    expect(convertDocusignTemplate(exp).map).toBeNull()
    const dropped = convertDocusignTemplate(exp, { fields: { 'com.docusign.extensibility.country': { drop: true } } })
    expect(dropped.issues).toEqual([])
    expect(dropped.report.some((r) => r.outcome === 'dropped by override')).toBe(true)
  })

  it('makes the Stellr counter-signature system-applied', () => {
    const exp: DocusignExport = {
      recipients: {
        signers: [
          { roleName: 'Mentor', tabs: { signHereTabs: [tab({ tabLabel: 'Signature a' })] } as never },
          { roleName: 'StellrRepresentative', tabs: { signHereTabs: [tab({ tabLabel: 'Signature b', yPosition: '618' })] } as never },
        ],
      },
    }
    const { map } = convertDocusignTemplate(exp)
    expect(map?.fields.find((f) => f.name === 'stellr_signature')?.source).toBe('system')
    expect(map?.roles.find((r) => r.role === 'stellr')?.order).toBe(3)
  })

  it('names an unknown DocuSign role as an issue rather than guessing', () => {
    const exp: DocusignExport = { recipients: { signers: [{ roleName: 'Witness', tabs: {} }] } }
    expect(convertDocusignTemplate(exp).issues[0].reason).toMatch(/No native role/)
  })
})
