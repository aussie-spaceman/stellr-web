// @vitest-environment node
//
// docs/THREAT-MODEL.md (multi-tenancy plan S2) cites the files that implement
// each control. A threat model whose citations rot is worse than none: it says
// a control exists when the file that held it was renamed or deleted. These
// tests keep it honest:
//   1. every repo path it cites exists, unless §10 lists it as planned;
//   2. a planned path that has landed is moved out of §10;
//   3. every trust boundary has a STRIDE table with all six letters, and every
//      row names a residual rating;
//   4. every planned control names a plan stage;
//   5. the AI-agent section and the assets the lane must cover are present.
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const DOC = readFileSync(join(ROOT, 'docs/THREAT-MODEL.md'), 'utf8')

const ROOTS = ['app', 'lib', 'components', 'packages', 'scripts', 'supabase', 'docs', 'test', 'e2e', 'ops', '.github', '.claude']
const ROOT_FILES = new Set(['proxy.ts', 'proxy.test.ts', 'instrumentation.ts', 'next.config.mjs', 'vercel.json', 'CLAUDE.md', 'VOICE.md', 'package.json'])

/** Backticked spans that name a file or folder in this repo. */
function citedPaths(markdown: string): string[] {
  const out = new Set<string>()
  for (const m of markdown.matchAll(/`([^`\s]+)`/g)) {
    const span = m[1]
    if (ROOT_FILES.has(span)) { out.add(span); continue }
    const first = span.split('/')[0]
    if (span.includes('/') && ROOTS.includes(first)) out.add(span)
  }
  return [...out].sort()
}

/** The bullet list under "## 10. Planned paths". */
function plannedPaths(markdown: string): string[] {
  const section = markdown.split(/^## 10\. Planned paths.*$/m)[1]?.split(/^## /m)[0] ?? ''
  return [...section.matchAll(/^- `([^`]+)`/gm)].map((m) => m[1])
}

/** A glob or folder citation exists when the part before the first wildcard does. */
function exists(path: string): boolean {
  const star = path.indexOf('*')
  const base = star === -1 ? path : path.slice(0, star).replace(/\/$/, '')
  return existsSync(join(ROOT, base))
}

/** Rows of the markdown table that follows a "### 6.x" heading. */
function strideSections(markdown: string): { heading: string; rows: string[][] }[] {
  const parts = markdown.split(/^### /m).slice(1)
  return parts
    .filter((p) => /^(6\.\d+|7\.2) /.test(p))
    .map((p) => {
      const heading = p.split('\n')[0]
      const rows = p
        .split('\n')
        .filter((l) => l.startsWith('|') && !/^\|\s*-/.test(l) && !/^\|\s*\|\s*Threat/.test(l))
        .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
      return { heading, rows }
    })
}

describe('docs/THREAT-MODEL.md citations', () => {
  const planned = plannedPaths(DOC)
  const cited = citedPaths(DOC)

  it('finds a meaningful number of citations (the extractor works)', () => {
    expect(cited.length).toBeGreaterThan(60)
    expect(planned.length).toBeGreaterThan(0)
  })

  it('cites only paths that exist, or that §10 lists as planned', () => {
    const missing = cited.filter((p) => !exists(p) && !planned.includes(p))
    expect(missing).toEqual([])
  })

  it('moves a planned path out of §10 once it lands', () => {
    const landed = planned.filter((p) => exists(p))
    expect(landed).toEqual([])
  })

  it('names a plan stage for every planned path', () => {
    const section = DOC.split(/^## 10\. Planned paths.*$/m)[1].split(/^## /m)[0]
    for (const p of planned) {
      const line = section.split('\n').find((l) => l.includes(`\`${p}\``)) ?? ''
      expect(line, p).toMatch(/\(S\d+\)/)
    }
  })

  it('the extractor ignores non-path spans and keeps globs', () => {
    expect(citedPaths('`tenant_id` `/_t/[tenant]` `lib/age.ts` `app/api/register/**` `proxy.ts` `GRANT ALL`')).toEqual([
      'app/api/register/**',
      'lib/age.ts',
      'proxy.ts',
    ])
  })
})

describe('docs/THREAT-MODEL.md coverage', () => {
  const sections = strideSections(DOC)

  it.each([
    'Browser',
    'proxy.ts',
    'route handlers',
    'service-role client',
    'RLS',
    'Clerk',
    'Stripe',
    'Resend',
    'Vercel',
    'GitHub',
  ])('has a STRIDE table for the %s boundary', (name) => {
    expect(sections.some((s) => s.heading.includes(name))).toBe(true)
  })

  it('covers all six STRIDE letters at every boundary TB1–TB10 and for the agent', () => {
    const full = sections.filter((s) => /^(6\.(\d|10) |7\.2 )/.test(s.heading) && !s.heading.startsWith('6.11'))
    expect(full.length).toBe(11)
    for (const s of full) {
      expect(s.rows.map((r) => r[0]).sort(), s.heading).toEqual(['D', 'E', 'I', 'R', 'S', 'T'])
    }
  })

  it('gives every STRIDE row a residual rating and a stage for any planned control', () => {
    for (const s of sections) {
      for (const r of s.rows) {
        expect(r.length, `${s.heading}: ${r[1]}`).toBe(5)
        expect(r[4], `${s.heading}: ${r[1]}`).toMatch(/\*\*[HML]\*\*/)
        const plannedCell = r[3]
        if (plannedCell !== '—') expect(plannedCell, `${s.heading}: ${r[1]}`).toMatch(/\bS\d+\b|runbook|target|security standard|cost policy|WISP/i)
      }
    }
  })

  it.each([
    'Minors',
    'Health and emergency',
    'Money',
    'Consent ledger',
    'Audit logs',
    'Secrets and keys',
  ])('lists the %s asset', (asset) => {
    const assets = DOC.split(/^## 2\. Assets$/m)[1].split(/^## /m)[0]
    expect(assets.toLowerCase()).toContain(asset.toLowerCase())
  })

  it('covers prompt injection via tenant-authored content and agent token scope', () => {
    expect(DOC).toMatch(/## 7\. The AI agent as developer/)
    expect(DOC).toMatch(/Tenant-authored event copy/)
    expect(DOC).toMatch(/Agent token scope/)
  })
})
