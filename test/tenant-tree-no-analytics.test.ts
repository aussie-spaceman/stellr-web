// @vitest-environment node
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { importClosure, readRepoFile, runtimeImports } from './import-closure'

// Trackers stay off tenant hosts two ways: SiteTracking and pushDataLayer check
// the host at run time, and this test keeps the tracking code out of the tenant
// tree in the first place. It walks the import closure, not only the files under
// app/%5Ft, because a tenant page can reach a tracker through what it reuses.

const TREE = 'app/%5Ft'

const FORBIDDEN_FILES = [/^components\/analytics\//, /^lib\/analytics\.ts$/, /^lib\/gtm\.ts$/]
const FORBIDDEN_PACKAGES = [/^@vercel\/analytics(\/|$)/, /^@vercel\/speed-insights(\/|$)/]

function treeFiles(): string[] {
  return readdirSync(path.join(process.cwd(), TREE), { recursive: true, encoding: 'utf8' })
    .map((rel) => path.posix.join(TREE, rel.split(path.sep).join('/')))
    .filter((rel) => /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel))
}

/** Each closure file or package import the tree may not contain. */
function violations(entries: string[], read: (rel: string) => string | null): string[] {
  const out = new Set<string>()
  for (const entry of entries) {
    for (const file of importClosure(entry, read)) {
      if (FORBIDDEN_FILES.some((re) => re.test(file))) out.add(`${entry} reaches ${file}`)
      for (const spec of runtimeImports(file, read(file) ?? '')) {
        if (FORBIDDEN_PACKAGES.some((re) => re.test(spec))) out.add(`${file} imports ${spec}`)
      }
    }
  }
  return [...out].sort()
}

describe('the tenant tree', () => {
  it('has files, and the walk follows their imports', () => {
    const entries = treeFiles()
    expect(entries.length).toBeGreaterThan(0)
    expect(entries).toContain(`${TREE}/[tenant]/page.tsx`)
    expect(importClosure(`${TREE}/[tenant]/page.tsx`, readRepoFile).has('lib/tenancy/request-tenant.ts')).toBe(true)
  })

  // Walks every page's closure: about 2 s alone, past the 5 s default on a busy CI runner.
  it('imports no tracking code', () => {
    expect(violations(treeFiles(), readRepoFile)).toEqual([])
  }, 60_000)
})

describe('the check itself', () => {
  it('fires on the real tracking mount', () => {
    const found = violations(['components/analytics/SiteTracking.tsx'], readRepoFile)
    expect(found).toContain('components/analytics/SiteTracking.tsx reaches components/analytics/GoogleTagManager.tsx')
    expect(found).toContain('components/analytics/SiteTracking.tsx imports @vercel/analytics/react')
    expect(found).toContain('components/analytics/SiteTracking.tsx imports @vercel/speed-insights/next')
  })

  it('fires on a tracker reached through a reused module', () => {
    const files: Record<string, string> = {
      'app/%5Ft/page.tsx': "import { F } from '@/app/(stellr)/(flow)/page'\nexport default F\n",
      'app/(stellr)/(flow)/page.tsx': "export { TrackEvent as F } from '@/components/analytics/TrackEvent'\n",
      'components/analytics/TrackEvent.tsx': 'export const TrackEvent = 1\n',
    }
    expect(violations(['app/%5Ft/page.tsx'], (rel) => files[rel] ?? null)).toEqual([
      'app/%5Ft/page.tsx reaches components/analytics/TrackEvent.tsx',
    ])
  })
})
