// @vitest-environment node
import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { importClosure, readRepoFile } from './import-closure'

// What loading lib/authz costs, and who can load it.
//
// Operator scripts run under plain tsx, where lib/authz's `server-only` import throws at load,
// and vitest aliases that package away, so no ordinary test can see it. The scripts reach the
// legacy guard modules through lib/community and others, so those load lib/authz only when a
// guard is called, which a script never does.
//
// A guard runs on routes that serve members too, and lib/app-errors brings the mailer, so that
// loads only when there is a row to write.

const AUTHZ = 'lib/authz.ts'

const scriptEntries = readdirSync('scripts', { recursive: true, encoding: 'utf8' })
  .filter((f) => /\.(ts|tsx|mts|mjs)$/.test(f) && !/\.test\./.test(f) && !f.startsWith('codemods'))
  .map((f) => `scripts/${f}`)
const fixtureClis = readdirSync('e2e/fixtures', { encoding: 'utf8' })
  .filter((f) => /-cli\.ts$/.test(f))
  .map((f) => `e2e/fixtures/${f}`)

/** Files that bring lib/authz in as they load, anywhere the entries can reach. */
function staticImportersOfAuthz(entries: string[], read: (rel: string) => string | null = readRepoFile): string[] {
  const ROOT = '__entries__.ts'
  const rootSrc = entries.map((e) => `import '@/${e}'`).join('\n')
  // Follows dynamic imports too: a script can hit one of those at run time. lib/authz itself is
  // hidden, because a dynamic import of it is the allowed shape: only a guard call reaches it.
  const reached = importClosure(ROOT, (rel) => (rel === ROOT ? rootSrc : rel === AUTHZ ? null : read(rel)))
  reached.delete(ROOT)
  return [...reached].filter((file) =>
    importClosure(file, (rel) => (rel === file || rel === AUTHZ ? read(rel) : null), { staticOnly: true }).has(AUTHZ),
  )
}

describe('operator scripts can still load under plain tsx', () => {
  it('finds the scripts', () => {
    expect(scriptEntries).toContain('scripts/seed-welcome-drips.ts')
    expect(scriptEntries).toContain('scripts/docusign-resend-outstanding.ts')
    expect(fixtureClis).toContain('e2e/fixtures/esign-cli.ts')
  })

  it('no script reaches a file that imports lib/authz as it loads', () => {
    expect(staticImportersOfAuthz([...scriptEntries, ...fixtureClis])).toEqual([])
  })

  it('walks through to the modules that used to bring it in', () => {
    const closure = importClosure('scripts/seed-welcome-drips.ts', (rel) => (rel === AUTHZ ? null : readRepoFile(rel)))
    expect(closure.has('lib/admin-auth.ts')).toBe(true)
  })

  it('the check can fail: a static import through a reached module is caught', () => {
    const files: Record<string, string> = {
      'scripts/a.ts': "import '@/lib/b'\n",
      'lib/b.ts': "export const f = () => import('@/lib/c')\n",
      'lib/c.ts': "import { isStellrAdmin } from '@/lib/authz'\nexport const g = isStellrAdmin\n",
      'lib/authz.ts': 'export const isStellrAdmin = 1\n',
    }
    expect(staticImportersOfAuthz(['scripts/a.ts'], (rel) => files[rel] ?? null)).toEqual(['lib/c.ts'])
  })

  it('a dynamic import of lib/authz is the allowed shape', () => {
    const files: Record<string, string> = {
      'scripts/a.ts': "export const f = () => import('@/lib/authz')\n",
      'lib/authz.ts': 'export const isStellrAdmin = 1\n',
    }
    expect(staticImportersOfAuthz(['scripts/a.ts'], (rel) => files[rel] ?? null)).toEqual([])
  })
})

describe('the guards do not load the mailer', () => {
  it.each([AUTHZ, 'lib/admin-auth.ts', 'lib/impersonation.ts'])('%s', (entry) => {
    const closure = importClosure(entry, readRepoFile, { staticOnly: true })
    expect(closure.has(entry)).toBe(true)
    expect([...closure].filter((f) => f === 'lib/app-errors.ts' || /^lib\/email(\.|\/)/.test(f))).toEqual([])
  })

  it('lib/authz does still write its rows through lib/app-errors, loaded when needed', () => {
    expect(importClosure(AUTHZ, readRepoFile).has('lib/app-errors.ts')).toBe(true)
  })
})
