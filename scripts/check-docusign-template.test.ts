// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

// TRACKER 22.8: the sandbox allows DocuSign Extensions; the production plan
// rejects every envelope whose template uses one. The template check fails on
// any extensionData, so the drift shows before a template edit ships.

const SCRIPT = path.join(__dirname, 'check-docusign-template.mjs')
const dir = mkdtempSync(path.join(tmpdir(), 'ds-template-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const text = (tabLabel: string, extra: Record<string, unknown> = {}) => ({ tabLabel, pageNumber: '1', value: '', ...extra })
const box = (tabLabel: string) => ({ tabLabel, pageNumber: '1', selected: 'false' })

/** An adult template that meets the contract in full. */
function adultTemplate(extra: { tab?: Record<string, unknown>; root?: Record<string, unknown> } = {}) {
  return {
    name: 'Adult agreement (test fixture)',
    templateId: 'template-placeholder',
    ...extra.root,
    recipients: {
      signers: [
        {
          roleName: 'Adult',
          tabs: {
            textTabs: [text('TeacherPhone', extra.tab), text('SchoolName')],
            checkboxTabs: [box('MediaOptOut')],
            signHereTabs: [{ tabLabel: 'Signature', pageNumber: '1' }],
          },
        },
      ],
    },
  }
}

function check(template: object) {
  const file = path.join(dir, `t-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(file, JSON.stringify(template))
  const r = spawnSync(process.execPath, [SCRIPT, 'adult', file], { encoding: 'utf8' })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

describe('check-docusign-template: extensionData', () => {
  it('passes a template with no extension', () => {
    const r = check(adultTemplate())
    expect(r.out).toContain('✓ every field the app fills or reads is present and correctly typed')
    expect(r.status).toBe(0)
  })

  it('fails, naming the field, when a tab carries extensionData', () => {
    const r = check(adultTemplate({ tab: { extensionData: { extensionGroupId: 'ext-placeholder', publisherName: 'Example' } } }))
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/✗ extensionData at \$\.recipients\.signers\[0\]\.tabs\.textTabs\[0\]\.extensionData \(tab "TeacherPhone"\)/)
    expect(r.out).toContain('not on the production plan')
  })

  it('fails on extensionData anywhere in the template, not only on a tab', () => {
    const r = check(adultTemplate({ root: { envelopeMetadata: { extensionData: {} } } }))
    expect(r.status).toBe(1)
    expect(r.out).toContain('extensionData at $.envelopeMetadata.extensionData')
  })

  it('treats a null extensionData as absent', () => {
    const r = check(adultTemplate({ tab: { extensionData: null } }))
    expect(r.status).toBe(0)
  })
})
