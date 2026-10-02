// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Guards the provider seam. Anything that CALLS DocuSign must go through
// lib/esign, so that the in-app engine can take an agreement without every
// caller learning which engine it is talking to. This test reads the source
// tree and fails if a DocuSign API function is imported anywhere else.

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** Files allowed to import anything from lib/docusign. */
const UNRESTRICTED = new Set([
  'lib/esign/providers/docusign.ts',
])

/**
 * What every other file may still import from lib/docusign: types, and helpers
 * that make no API call. The Connect webhook verifies DocuSign's own signature,
 * which is DocuSign-specific by nature.
 */
const PURE_EXPORTS = new Set([
  'AgreementType',
  'EventAgreementType',
  'EnvelopeRecipient',
  'EnvelopeFormField',
  'EnvelopeParams',
  'AdultAgreementParams',
  'MentorAgreementParams',
  'VolunteerAgreementParams',
  'CreatedEnvelope',
  'AccountUsage',
  'classifyAgreement',
  'isMinor',
  'summariseSigners',
  'verifyConnectHmac',
])

const SCAN_DIRS = ['app', 'lib', 'components']
const SKIP_DIRS = new Set(['node_modules', '.next', '.claude'])

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...sourceFiles(join(dir, entry.name)))
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

// `import { a, type B as C } from '@/lib/docusign'` or a relative path to it.
const IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]((?:@\/lib|\.{1,2}(?:\/\.\.)*)\/docusign)['"]/g

function importedNames(source: string): string[] {
  const names: string[] = []
  for (const match of source.matchAll(IMPORT)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
      if (name) names.push(name)
    }
  }
  return names
}

describe('provider seam', () => {
  it('finds the adapter, so a moved file cannot make this test pass vacuously', () => {
    const adapter = readFileSync(join(ROOT, 'lib/esign/providers/docusign.ts'), 'utf8')
    expect(importedNames(adapter)).toContain('createConsentEnvelope')
  })

  it('lets only the DocuSign adapter import DocuSign API functions', () => {
    const offenders: string[] = []
    for (const dir of SCAN_DIRS) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        const rel = relative(ROOT, file)
        if (UNRESTRICTED.has(rel)) continue
        const banned = importedNames(readFileSync(file, 'utf8')).filter((n) => !PURE_EXPORTS.has(n))
        if (banned.length) offenders.push(`${rel}: ${banned.join(', ')}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
